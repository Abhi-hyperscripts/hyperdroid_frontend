/**
 * HRMS Statutory Compliance JavaScript
 * Handles company info, ECR, ESI, and Form 16 generation
 */

let currentUser = null;
let offices = [];
let departments = [];
let employees = [];
let companyInfo = null;
let countries = [];
let indiaCountryId = null;
let contributionTypes = [];
let contributionRules = [];
let financialYears = [];
let pfTypeId = null;
let esiTypeId = null;

// Returns Types and Statements Types
let returnsTypes = [];
let statementsTypes = [];
let currentReturnTypeId = null;
let currentStatementTypeId = null;

// ==================== Utility Functions ====================

function formatCurrency(amount) {
    if (amount === null || amount === undefined) return '₹0';
    return new Intl.NumberFormat('en-IN', {
        style: 'currency',
        currency: 'INR',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
    }).format(amount);
}

function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// Month picker instances
let ecrMonthPicker = null;
let esiMonthPicker = null;

// Searchable dropdown instances for Financial Year
const complianceSearchableDropdowns = new Map();

// ==================== MonthPicker Component ====================

/**
 * MonthPicker - A calendar-style month/year picker component
 * Shows a dropdown with year navigation and month grid
 */
class ComplianceMonthPicker {
    constructor(containerId, options = {}) {
        this.container = document.getElementById(containerId);
        if (!this.container) return;

        this.id = containerId;
        this.yearsBack = options.yearsBack ?? 5;
        this.yearsForward = options.yearsForward ?? 1;
        this.allowAllMonths = options.allowAllMonths !== false;
        this.onChange = options.onChange || (() => {});

        const now = new Date();
        this.currentYear = now.getFullYear();
        this.currentMonth = now.getMonth() + 1; // 1-12

        // Selected values (null month means "All Months")
        this.selectedYear = options.year ?? this.currentYear;
        this.selectedMonth = options.month ?? this.currentMonth;

        // View year for navigation
        this.viewYear = this.selectedYear;

        this.isOpen = false;
        this.monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        this.fullMonthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

        this.render();
        this.bindEvents();
    }

    getDisplayText() {
        if (this.selectedMonth === null) {
            return `All Months ${this.selectedYear}`;
        }
        return `${this.fullMonthNames[this.selectedMonth - 1]} ${this.selectedYear}`;
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
        if (this.isOpen) {
            this.close();
        } else {
            this.open();
        }
    }

    open() {
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

// ==================== SearchableDropdown Component ====================

/**
 * SearchableDropdown - A searchable dropdown with virtual scroll for Financial Year selection
 */
class ComplianceSearchableDropdown {
    constructor(container, options = {}) {
        this.container = typeof container === 'string' ? document.getElementById(container) : container;
        if (!this.container) return;

        this.options = options.options || [];
        this.placeholder = options.placeholder || 'Select an option';
        this.searchPlaceholder = options.searchPlaceholder || 'Search...';
        this.onChange = options.onChange || (() => {});
        this.virtualScroll = options.virtualScroll !== false;
        this.itemHeight = options.itemHeight || 36;
        this.selectedValue = options.value || null;
        this.filteredOptions = [...this.options];
        this.highlightedIndex = -1;
        this.isOpen = false;
        this.id = options.id || `csd-${Date.now()}`;
        this.visibleCount = 10;
        this.scrollTop = 0;

        this.render();
        this.bindEvents();

        complianceSearchableDropdowns.set(this.id, this);
    }

    render() {
        const selectedOption = this.options.find(o => o.value === this.selectedValue);
        const displayText = selectedOption ? selectedOption.label : '';

        this.container.innerHTML = `
            <div class="searchable-dropdown" id="${this.id}">
                <div class="searchable-dropdown-trigger" tabindex="0">
                    <span class="selected-text ${!displayText ? 'placeholder' : ''}">${displayText || this.placeholder}</span>
                    <svg class="dropdown-arrow" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="6 9 12 15 18 9"></polyline>
                    </svg>
                </div>
                <div class="searchable-dropdown-panel">
                    <div class="searchable-dropdown-search">
                        <svg class="search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <circle cx="11" cy="11" r="8"/>
                            <path d="m21 21-4.35-4.35"/>
                        </svg>
                        <input type="text" placeholder="${this.searchPlaceholder}" autocomplete="off">
                    </div>
                    <div class="searchable-dropdown-list">
                        ${this.renderOptions()}
                    </div>
                </div>
            </div>
        `;

        this.dropdownEl = this.container.querySelector('.searchable-dropdown');
        this.triggerEl = this.container.querySelector('.searchable-dropdown-trigger');
        this.menuEl = this.container.querySelector('.searchable-dropdown-panel');
        this.searchInput = this.container.querySelector('.searchable-dropdown-search input');
        this.optionsEl = this.container.querySelector('.searchable-dropdown-list');
        this.selectedTextEl = this.container.querySelector('.selected-text');
    }

    renderOptions() {
        if (this.filteredOptions.length === 0) {
            return '<div class="searchable-dropdown-empty">No options found</div>';
        }

        if (this.virtualScroll && this.filteredOptions.length > 20) {
            return this.renderVirtualOptions();
        }

        return this.filteredOptions.map((option, index) => `
            <div class="searchable-dropdown-item ${option.value === this.selectedValue ? 'selected' : ''} ${index === this.highlightedIndex ? 'highlighted' : ''}"
                 data-value="${this.escapeHtml(String(option.value))}"
                 data-index="${index}">
                <div class="item-content">
                    <span class="item-name">${this.escapeHtml(option.label)}</span>
                    ${option.description ? `<span class="item-detail">${this.escapeHtml(option.description)}</span>` : ''}
                </div>
            </div>
        `).join('');
    }

    renderVirtualOptions() {
        const totalHeight = this.filteredOptions.length * this.itemHeight;
        const startIndex = Math.floor(this.scrollTop / this.itemHeight);
        const endIndex = Math.min(startIndex + this.visibleCount + 2, this.filteredOptions.length);
        const offsetY = startIndex * this.itemHeight;

        return `
            <div class="virtual-scroll-container" style="height: ${totalHeight}px; position: relative;">
                <div class="virtual-scroll-viewport" style="position: absolute; top: ${offsetY}px; left: 0; right: 0;">
                    ${this.filteredOptions.slice(startIndex, endIndex).map((option, i) => `
                        <div class="searchable-dropdown-item ${option.value === this.selectedValue ? 'selected' : ''}"
                             data-value="${this.escapeHtml(String(option.value))}"
                             data-index="${startIndex + i}"
                             style="height: ${this.itemHeight}px;">
                            <div class="item-content">
                                <span class="item-name">${this.escapeHtml(option.label)}</span>
                                ${option.description ? `<span class="item-detail">${this.escapeHtml(option.description)}</span>` : ''}
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
    }

    escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    bindEvents() {
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

        this.searchInput.addEventListener('input', (e) => this.filter(e.target.value));
        this.searchInput.addEventListener('keydown', (e) => this.handleKeydown(e));

        this.optionsEl.addEventListener('click', (e) => {
            const optionEl = e.target.closest('.searchable-dropdown-item');
            if (optionEl) {
                this.select(optionEl.dataset.value);
            }
        });

        this.optionsEl.addEventListener('scroll', () => this.handleVirtualScroll());

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

        const viewport = this.optionsEl.querySelector('.virtual-scroll-viewport');
        if (viewport) {
            viewport.style.top = `${offsetY}px`;
            viewport.innerHTML = this.filteredOptions.slice(startIndex, endIndex).map((option, i) => `
                <div class="searchable-dropdown-item ${option.value === this.selectedValue ? 'selected' : ''}"
                     data-value="${this.escapeHtml(String(option.value))}"
                     data-index="${startIndex + i}"
                     style="height: ${this.itemHeight}px;">
                    <div class="item-content">
                        <span class="item-name">${this.escapeHtml(option.label)}</span>
                        ${option.description ? `<span class="item-detail">${this.escapeHtml(option.description)}</span>` : ''}
                    </div>
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
        const options = this.optionsEl.querySelectorAll('.searchable-dropdown-item');
        options.forEach((el) => {
            const dataIndex = parseInt(el.dataset.index);
            el.classList.toggle('highlighted', dataIndex === this.highlightedIndex);
        });

        const highlighted = this.optionsEl.querySelector('.searchable-dropdown-item.highlighted');
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
        complianceSearchableDropdowns.delete(this.id);
        this.container.innerHTML = '';
    }
}

// FY Dropdown instances
let pfFYDropdown = null;
let esiFYDropdown = null;
let slabFYDropdown = null;
let surchargeFYDropdown = null;
let cessFYDropdown = null;
let form16FYDropdown = null;
let bulkForm16FYDropdown = null;

// ==================== Select to Searchable Dropdown Utility ====================

/**
 * Converts a standard <select> element to a searchable dropdown
 * @param {HTMLSelectElement|string} selectElement - The select element or its ID
 * @param {Object} options - Optional configuration
 * @returns {ComplianceSearchableDropdown} - The created dropdown instance
 */
function convertSelectToSearchable(selectElement, options = {}) {
    const select = typeof selectElement === 'string'
        ? document.getElementById(selectElement)
        : selectElement;

    if (!select || select.tagName !== 'SELECT') {
        console.warn('convertSelectToSearchable: Invalid select element', selectElement);
        return null;
    }

    // Extract options from select
    const selectOptions = [];
    for (const opt of select.options) {
        selectOptions.push({
            value: opt.value,
            label: opt.textContent,
            disabled: opt.disabled
        });
    }

    // Get current value
    const currentValue = select.value;

    // Get select attributes
    const selectId = select.id;
    const isRequired = select.required;
    const isDisabled = select.disabled;

    // Create wrapper div
    const wrapper = document.createElement('div');
    wrapper.id = `${selectId}-wrapper`;
    wrapper.className = 'searchable-dropdown-wrapper';
    if (isDisabled) wrapper.classList.add('disabled');

    // Insert wrapper where select was
    select.parentNode.insertBefore(wrapper, select);

    // Hide original select but keep it for form submission
    select.style.display = 'none';
    wrapper.appendChild(select);

    // Create container for searchable dropdown
    const container = document.createElement('div');
    container.id = `${selectId}-searchable`;
    container.className = 'searchable-dropdown-container';
    wrapper.insertBefore(container, select);

    // Determine placeholder
    const firstOption = selectOptions[0];
    const placeholder = options.placeholder ||
        (firstOption && (firstOption.value === '' || firstOption.value === 'all')
            ? firstOption.label
            : 'Select...');

    // Filter out placeholder option if it exists
    const dropdownOptions = selectOptions.filter(opt => opt.value !== '' || options.includeEmptyOption);

    // Create searchable dropdown
    const dropdown = new ComplianceSearchableDropdown(container, {
        id: `${selectId}-sd`,
        options: dropdownOptions.length > 0 ? dropdownOptions : selectOptions,
        placeholder: placeholder,
        searchPlaceholder: options.searchPlaceholder || 'Search...',
        value: currentValue || null,
        virtualScroll: options.virtualScroll !== false,
        onChange: (value, option) => {
            // Update hidden select for form submission
            select.value = value;
            // Trigger change event on original select
            select.dispatchEvent(new Event('change', { bubbles: true }));
            // Call custom onChange if provided
            if (options.onChange) options.onChange(value, option);
        }
    });

    // Store reference
    complianceSearchableDropdowns.set(selectId, dropdown);

    // Handle disabled state
    if (isDisabled) {
        const trigger = wrapper.querySelector('.searchable-dropdown-trigger');
        if (trigger) {
            trigger.style.pointerEvents = 'none';
            trigger.style.opacity = '0.6';
        }
    }

    return dropdown;
}

/**
 * Updates searchable dropdown options (for dynamically populated selects)
 * @param {string} selectId - The original select element's ID
 * @param {Array} options - New options array [{value, label}]
 * @param {string} selectedValue - Optional value to select
 */
function updateSearchableDropdownOptions(selectId, options, selectedValue = null) {
    const dropdown = complianceSearchableDropdowns.get(selectId);
    if (dropdown) {
        dropdown.setOptions(options);
        if (selectedValue !== null) {
            dropdown.setValue(selectedValue);
        }
    }

    // Also update the hidden select
    const select = document.getElementById(selectId);
    if (select) {
        // Preserve first option if it's a placeholder
        const firstOpt = select.options[0];
        const hasPlaceholder = firstOpt && (firstOpt.value === '' || firstOpt.value === 'all');

        // Clear options
        while (select.options.length > (hasPlaceholder ? 1 : 0)) {
            select.remove(hasPlaceholder ? 1 : 0);
        }

        // Add new options
        options.forEach(opt => {
            const option = document.createElement('option');
            option.value = opt.value;
            option.textContent = opt.label;
            select.appendChild(option);
        });

        if (selectedValue !== null) {
            select.value = selectedValue;
        }
    }
}

/**
 * Gets value from searchable dropdown
 * @param {string} selectId - The original select element's ID
 * @returns {string|null} The selected value
 */
function getSearchableDropdownValue(selectId) {
    const dropdown = complianceSearchableDropdowns.get(selectId);
    return dropdown ? dropdown.getValue() : document.getElementById(selectId)?.value || null;
}

/**
 * Sets value on searchable dropdown
 * @param {string} selectId - The original select element's ID
 * @param {string} value - Value to set
 */
function setSearchableDropdownValue(selectId, value) {
    const dropdown = complianceSearchableDropdowns.get(selectId);
    if (dropdown) {
        dropdown.setValue(value);
    }
    const select = document.getElementById(selectId);
    if (select) {
        select.value = value;
    }
}

/**
 * Enables/disables a searchable dropdown
 * @param {string} selectId - The original select element's ID
 * @param {boolean} enabled - Whether to enable or disable
 */
function setSearchableDropdownEnabled(selectId, enabled) {
    const wrapper = document.getElementById(`${selectId}-wrapper`);
    const select = document.getElementById(selectId);

    if (wrapper) {
        wrapper.classList.toggle('disabled', !enabled);
        const trigger = wrapper.querySelector('.searchable-dropdown-trigger');
        if (trigger) {
            trigger.style.pointerEvents = enabled ? '' : 'none';
            trigger.style.opacity = enabled ? '' : '0.6';
        }
    }
    if (select) {
        select.disabled = !enabled;
    }
}

/**
 * Resets a searchable dropdown to its placeholder state
 * @param {string} selectId - The original select element's ID
 */
function resetSearchableDropdown(selectId) {
    const dropdown = complianceSearchableDropdowns.get(selectId);
    if (dropdown) {
        dropdown.reset();
    }
    const select = document.getElementById(selectId);
    if (select) {
        select.selectedIndex = 0;
    }
}

// ==================== Checkbox to Toggle Utility ====================

/**
 * Converts a checkbox to a toggle switch
 * @param {HTMLInputElement|string} checkboxElement - The checkbox element or its ID
 * @param {Object} options - Optional configuration {label, onChange}
 */
function convertCheckboxToToggle(checkboxElement, options = {}) {
    const checkbox = typeof checkboxElement === 'string'
        ? document.getElementById(checkboxElement)
        : checkboxElement;

    if (!checkbox || checkbox.type !== 'checkbox') {
        console.warn('convertCheckboxToToggle: Invalid checkbox element', checkboxElement);
        return;
    }

    // Find the label container
    let labelContainer = checkbox.closest('label') || checkbox.parentElement;

    // Get label text
    let labelText = options.label || '';
    if (!labelText && labelContainer) {
        // Extract text content excluding the checkbox
        const clone = labelContainer.cloneNode(true);
        const cloneCheckbox = clone.querySelector('input[type="checkbox"]');
        if (cloneCheckbox) cloneCheckbox.remove();
        labelText = clone.textContent.trim();
    }

    // Create toggle structure
    const toggleWrapper = document.createElement('label');
    toggleWrapper.className = 'compliance-toggle';
    toggleWrapper.innerHTML = `
        <input type="checkbox" id="${checkbox.id}" ${checkbox.checked ? 'checked' : ''} ${checkbox.required ? 'required' : ''} ${checkbox.disabled ? 'disabled' : ''}>
        <span class="toggle-track">
            <span class="toggle-thumb"></span>
        </span>
        ${labelText ? `<span class="toggle-label">${escapeHtml(labelText)}</span>` : ''}
    `;

    // Replace the old structure
    if (labelContainer && labelContainer.tagName === 'LABEL') {
        labelContainer.parentNode.replaceChild(toggleWrapper, labelContainer);
    } else {
        checkbox.parentNode.insertBefore(toggleWrapper, checkbox);
        checkbox.remove();
    }

    // Get new checkbox reference and add change handler if provided
    const newCheckbox = toggleWrapper.querySelector('input[type="checkbox"]');
    if (options.onChange && newCheckbox) {
        newCheckbox.addEventListener('change', (e) => options.onChange(e.target.checked, e));
    }

    return newCheckbox;
}

/**
 * Initialize all searchable dropdowns and toggles
 */
function initializeSearchableDropdownsAndToggles() {
    // List of select IDs that should NOT be converted (already handled or special cases)
    const excludeSelectIds = [
        // Already handled as searchable dropdowns via containers
        'form16Employee', 'bulkForm16Office', 'bulkForm16Dept',
        'calcRegimeId', 'tdsEmployeeId', 'contribTypeId',
        'taxValidationEmployeeId', 'contribValidationEmployeeId'
    ];

    // Convert all select elements with .form-select or .form-control class
    const selects = document.querySelectorAll('select.form-select, select.form-control');
    selects.forEach(select => {
        if (select.id && !excludeSelectIds.includes(select.id) && !complianceSearchableDropdowns.has(select.id)) {
            convertSelectToSearchable(select);
        }
    });

    // Convert checkboxes to toggles - exclude month checkboxes (handled separately)
    const checkboxesToConvert = [
        'ptConfigShowInactive',
        'lwfConfigShowInactive',
        'regimeIsDefault',
        'fyIsCurrent',
        'deductionRequiresProof',
        'returnIsActive',
        'statementIsActive',
        'stateIsUT',
        'stateHasPT',
        'ptConfigIsActive',
        'lwfConfigIsActive',
        'ptExemptionRequiresDoc',
        'ptExemptionIsActive'
    ];

    checkboxesToConvert.forEach(id => {
        const checkbox = document.getElementById(id);
        if (checkbox) {
            convertCheckboxToToggle(checkbox);
        }
    });
}

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

        // Load initial data - countries first as other data depends on it
        await Promise.all([
            loadCompanyInfo(),
            loadOffices(),
            loadDepartments(),
            loadEmployees(),
            loadCountries()
        ]);

        // Load country-dependent data (contribution types, financial years)
        if (indiaCountryId) {
            await Promise.all([
                loadContributionTypes(),
                loadFinancialYears()
            ]);
            // Load existing contribution rules after types are loaded
            await loadExistingRules();
        } else {
            console.warn('India country not found - contribution rules will not be loaded');
        }

        // Setup form handlers
        setupFormHandlers();

        // Check and display compliance status
        await checkAndDisplayComplianceStatus();

        // Initialize searchable dropdowns and toggle switches
        initializeSearchableDropdownsAndToggles();

        hideLoading();
    } catch (error) {
        console.error('Error initializing page:', error);
        showToast('Failed to load page data', 'error');
        hideLoading();
    }
}

// ==================== Compliance Status Check ====================

/**
 * Check compliance status and display the status banner
 */
async function checkAndDisplayComplianceStatus() {
    try {
        const response = await api.request('/hrms/dashboard/setup-status');
        if (!response) return;

        const banner = document.getElementById('complianceStatusBanner');
        const statusIcon = document.getElementById('complianceStatusIcon');
        const statusTitle = document.getElementById('complianceStatusTitle');
        const statusDesc = document.getElementById('complianceStatusDesc');
        const checklist = document.getElementById('complianceChecklist');

        if (!banner) return;

        // Build checklist items
        const items = [
            {
                title: 'Company Information',
                complete: response.has_company_info,
                tab: 'company-info',
                status: response.has_company_info ? 'Configured' : 'Required'
            },
            {
                title: 'Country Configuration (India)',
                complete: response.has_country_config,
                tab: 'company-info',
                status: response.has_country_config ? 'Configured' : 'Click "Re-initialize Statutory Config"'
            },
            {
                title: 'Financial Year',
                complete: response.has_financial_year,
                tab: 'financial-years',
                status: response.has_financial_year ? 'Configured' : 'At least one required'
            },
            {
                title: 'PF & ESI Contribution Rules',
                complete: response.has_contribution_rules,
                tab: 'contribution-rules',
                status: response.has_contribution_rules ? 'Configured' : 'Both PF and ESI rules required'
            }
        ];

        // Render checklist
        checklist.innerHTML = items.map(item => `
            <div class="compliance-checklist-item ${item.complete ? 'complete' : 'incomplete'}" onclick="switchToTab('${item.tab}')">
                <div class="check-icon">
                    ${item.complete ? `
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
                            <polyline points="20 6 9 17 4 12"></polyline>
                        </svg>
                    ` : `
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <circle cx="12" cy="12" r="1"></circle>
                        </svg>
                    `}
                </div>
                <div class="item-content">
                    <div class="item-title">${item.title}</div>
                    <div class="item-status">${item.status}</div>
                </div>
                <svg class="arrow-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="9 18 15 12 9 6"></polyline>
                </svg>
            </div>
        `).join('');

        // Update banner state
        if (response.is_compliance_complete) {
            banner.classList.remove('incomplete');
            banner.classList.add('complete');
            statusTitle.textContent = 'Compliance Setup Complete';
            statusDesc.textContent = response.compliance_message || 'All required compliance items are configured. You can now proceed to Organization setup.';
            statusIcon.innerHTML = `
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
                    <polyline points="22 4 12 14.01 9 11.01"></polyline>
                </svg>
            `;
        } else {
            banner.classList.remove('complete');
            banner.classList.add('incomplete');
            statusTitle.textContent = 'Compliance Setup Required';
            statusDesc.textContent = response.compliance_message || 'Complete the following items to enable Organization setup.';
            statusIcon.innerHTML = `
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <circle cx="12" cy="12" r="10"></circle>
                    <path d="M12 8v4"></path>
                    <path d="M12 16h.01"></path>
                </svg>
            `;
        }

        // Show the banner
        banner.style.display = 'block';
    } catch (error) {
        console.error('Error checking compliance status:', error);
    }
}

/**
 * Switch to a specific tab (for checklist item clicks)
 */
function switchToTab(tabId) {
    const tabBtn = document.querySelector(`[data-tab="${tabId}"]`);
    if (tabBtn) {
        tabBtn.click();
    }
}

// ==================== Data Loading ====================

async function loadCompanyInfo() {
    try {
        const response = await api.request('/hrms/statutory/company-info');
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

async function loadCountries() {
    try {
        const response = await api.request('/hrms/statutory/countries');
        countries = response || [];

        // Find India country ID (code: IN or IND)
        const india = countries.find(c =>
            c.country_code === 'IN' ||
            c.country_code === 'IND' ||
            c.country_name?.toLowerCase() === 'india'
        );

        if (india) {
            indiaCountryId = india.id;
            console.log('India country found:', { id: indiaCountryId, name: india.country_name });
            updateCountryStatus(true);
        } else {
            // No India country exists - auto-create it
            console.log('India country not found. Auto-creating...');
            await createIndiaCountry();
        }
    } catch (error) {
        console.error('Error loading countries:', error);
        updateCountryStatus(false, 'Error loading');
    }
}

// Auto-create India country configuration with all India-specific contribution types
async function createIndiaCountry() {
    const payload = {
        country_code: 'IND',  // ISO 3166-1 alpha-3
        country_name: 'India',
        currency_code: 'INR',
        currency_symbol: '₹',
        fiscal_year_start_month: 4, // April
        date_format: 'dd/MM/yyyy'
    };

    try {
        updateCountryStatus(false, 'Setting up India...');

        const response = await api.request('/hrms/statutory/countries', {
            method: 'POST',
            body: JSON.stringify(payload)
        });

        if (response && response.id) {
            indiaCountryId = response.id;
            console.log('India country created successfully:', indiaCountryId);

            // Now create all India-specific contribution categories and types
            await createIndiaContributionTypes();

            updateCountryStatus(true);
            showToast('India configuration with PF, ESIC, PT created successfully.', 'success');
        }
    } catch (error) {
        console.error('Error creating India country:', error);
        updateCountryStatus(false, 'Setup failed');
        showToast('Failed to create India configuration: ' + (error.message || 'Unknown error'), 'error');
    }
}

// Create India-specific contribution categories and types (PF, ESIC, PT, TDS)
async function createIndiaContributionTypes() {
    if (!indiaCountryId) {
        console.error('Cannot create contribution types - India country ID not available');
        return;
    }

    try {
        console.log('Creating India contribution categories and types...');

        // Step 1: Create contribution categories
        // Social Security category (for PF)
        const socialSecurityResponse = await api.request('/hrms/statutory/contribution-categories', {
            method: 'POST',
            body: JSON.stringify({
                category_code: 'SOCIAL_SECURITY',
                category_name: 'Social Security',
                description: 'Social security contributions including Provident Fund'
            })
        });
        const socialSecurityCategoryId = socialSecurityResponse.id || socialSecurityResponse;
        console.log('Social Security category created:', socialSecurityCategoryId);

        // Insurance category (for ESI)
        const insuranceResponse = await api.request('/hrms/statutory/contribution-categories', {
            method: 'POST',
            body: JSON.stringify({
                category_code: 'INSURANCE',
                category_name: 'Health Insurance',
                description: 'Health insurance contributions including ESIC'
            })
        });
        const insuranceCategoryId = insuranceResponse.id || insuranceResponse;
        console.log('Insurance category created:', insuranceCategoryId);

        // Tax category (for Professional Tax, TDS)
        const taxResponse = await api.request('/hrms/statutory/contribution-categories', {
            method: 'POST',
            body: JSON.stringify({
                category_code: 'TAX',
                category_name: 'Tax Deductions',
                description: 'Tax deductions including Professional Tax and TDS'
            })
        });
        const taxCategoryId = taxResponse.id || taxResponse;
        console.log('Tax category created:', taxCategoryId);

        // Step 2: Create contribution types
        // PF - Provident Fund
        const pfResponse = await api.request('/hrms/statutory/contribution-types', {
            method: 'POST',
            body: JSON.stringify({
                country_id: indiaCountryId,
                category_id: socialSecurityCategoryId,
                type_code: 'PF',
                type_name: 'Provident Fund (EPF)',
                description: 'Employee Provident Fund - 12% employee + 12% employer contribution',
                is_employer_contribution: true,
                is_employee_contribution: true
            })
        });
        pfTypeId = pfResponse.id || pfResponse;
        console.log('PF contribution type created:', pfTypeId);

        // ESIC - Employee State Insurance
        const esiResponse = await api.request('/hrms/statutory/contribution-types', {
            method: 'POST',
            body: JSON.stringify({
                country_id: indiaCountryId,
                category_id: insuranceCategoryId,
                type_code: 'ESI',
                type_name: 'Employee State Insurance (ESIC)',
                description: 'ESIC - 0.75% employee + 3.25% employer for salary up to ₹21,000',
                is_employer_contribution: true,
                is_employee_contribution: true
            })
        });
        esiTypeId = esiResponse.id || esiResponse;
        console.log('ESI contribution type created:', esiTypeId);

        // PT - Professional Tax
        const ptResponse = await api.request('/hrms/statutory/contribution-types', {
            method: 'POST',
            body: JSON.stringify({
                country_id: indiaCountryId,
                category_id: taxCategoryId,
                type_code: 'PT',
                type_name: 'Professional Tax',
                description: 'State-level Professional Tax (varies by state)',
                is_employer_contribution: false,
                is_employee_contribution: true
            })
        });
        console.log('PT contribution type created:', ptResponse.id || ptResponse);

        // TDS - Tax Deducted at Source (Income Tax)
        const tdsResponse = await api.request('/hrms/statutory/contribution-types', {
            method: 'POST',
            body: JSON.stringify({
                country_id: indiaCountryId,
                category_id: taxCategoryId,
                type_code: 'TDS',
                type_name: 'Tax Deducted at Source (TDS)',
                description: 'Income Tax deducted at source as per tax slabs',
                is_employer_contribution: false,
                is_employee_contribution: true
            })
        });
        console.log('TDS contribution type created:', tdsResponse.id || tdsResponse);

        // LWF - Labour Welfare Fund (optional, varies by state)
        const lwfResponse = await api.request('/hrms/statutory/contribution-types', {
            method: 'POST',
            body: JSON.stringify({
                country_id: indiaCountryId,
                category_id: socialSecurityCategoryId,
                type_code: 'LWF',
                type_name: 'Labour Welfare Fund',
                description: 'State Labour Welfare Fund contribution (varies by state)',
                is_employer_contribution: true,
                is_employee_contribution: true
            })
        });
        console.log('LWF contribution type created:', lwfResponse.id || lwfResponse);

        console.log('All India contribution types created successfully!');

    } catch (error) {
        console.error('Error creating India contribution types:', error);
        // Don't throw - country is already created, types can be created later
        showToast('Warning: Some contribution types may not have been created. Please refresh.', 'warning');
    }
}

// Update the country status badge
function updateCountryStatus(configured, customText = '') {
    const statusEl = document.getElementById('countryStatus');
    if (!statusEl) return;

    if (configured) {
        statusEl.className = 'status-badge configured';
        statusEl.textContent = '✓ Configured';
    } else {
        statusEl.className = 'status-badge pending';
        statusEl.textContent = customText || '⚠ Setting up...';
    }
}

async function seedIndiaConfiguration() {
    try {
        showToast('Setting up India statutory configuration...', 'info');
        const response = await api.request('/hrms/statutory/seed/india', {
            method: 'POST'
        });
        console.log('Seed response:', response);
        showToast('India statutory configuration created successfully!', 'success');

        // Reload countries after seeding
        const countriesResponse = await api.request('/hrms/statutory/countries');
        countries = countriesResponse || [];

        const india = countries.find(c =>
            c.country_code === 'IN' ||
            c.country_code === 'IND' ||
            c.country_name?.toLowerCase() === 'india'
        );

        if (india) {
            indiaCountryId = india.id;
            console.log('India country ID after seeding:', indiaCountryId);
        }
    } catch (error) {
        console.error('Error seeding India configuration:', error);
        showToast('Failed to seed India configuration: ' + (error.message || 'Unknown error'), 'error');
    }
}

// Re-initialize statutory configuration (callable from UI button)
async function reinitializeStatutoryConfig() {
    if (!confirm('This will REPLACE the India statutory configuration (PF, ESI, Professional Tax, Income Tax). Any custom rules will be lost. Continue?')) {
        return;
    }

    try {
        showLoading();
        showToast('Re-initializing statutory configuration...', 'info');

        // Use force=true to delete existing config and re-seed
        const response = await api.request('/hrms/statutory/seed/india?force=true', {
            method: 'POST'
        });
        console.log('Re-seed response:', response);

        // Reload all statutory data
        await loadCountries();

        if (indiaCountryId) {
            await Promise.all([
                loadContributionTypes(),
                loadFinancialYears()
            ]);
            await loadExistingRules();
        }

        showToast('Statutory configuration re-initialized successfully!', 'success');

        // Refresh compliance status banner
        await checkAndDisplayComplianceStatus();

        hideLoading();
    } catch (error) {
        console.error('Error re-initializing statutory configuration:', error);
        showToast('Failed to re-initialize: ' + (error.message || 'Unknown error'), 'error');
        hideLoading();
    }
}

async function loadContributionTypes() {
    if (!indiaCountryId) {
        console.warn('Cannot load contribution types - India country ID not available');
        return;
    }

    try {
        const response = await api.request(`/hrms/statutory/contribution-types?countryId=${indiaCountryId}`);
        contributionTypes = response || [];

        // Find PF and ESI type IDs (check both 'code' and 'type_code' properties)
        const pfType = contributionTypes.find(t =>
            t.code === 'PF' ||
            t.type_code === 'PF' ||
            t.name?.toLowerCase().includes('provident') ||
            t.type_name?.toLowerCase().includes('provident')
        );
        const esiType = contributionTypes.find(t =>
            t.code === 'ESI' ||
            t.type_code === 'ESI' ||
            t.name?.toLowerCase().includes('state insurance') ||
            t.type_name?.toLowerCase().includes('state insurance')
        );

        if (pfType) pfTypeId = pfType.id;
        if (esiType) esiTypeId = esiType.id;

        console.log('Contribution types loaded:', contributionTypes);
        console.log('Type IDs found:', { pfTypeId, esiTypeId });

        // If types don't exist, they should be created when India is initialized
        // No auto-creation here - handled by createIndiaCountry()
    } catch (error) {
        console.error('Error loading contribution types:', error);
    }
}

async function loadFinancialYears() {
    if (!indiaCountryId) {
        console.warn('Cannot load financial years - India country ID not available');
        return;
    }

    try {
        const response = await api.request(`/hrms/statutory/countries/${indiaCountryId}/financial-years`);
        financialYears = response || [];
        console.log('Financial years loaded:', financialYears);
        populateContributionRulesFYDropdowns();
    } catch (error) {
        console.error('Error loading financial years:', error);
    }
}

async function loadExistingRules() {
    try {
        contributionRules = []; // Reset global array

        // Load PF rules
        if (pfTypeId) {
            const pfRules = await api.request(`/hrms/statutory/contribution-types/${pfTypeId}/rules`);
            if (pfRules && pfRules.length > 0) {
                pfRules.forEach(r => {
                    r.contribution_type = { type_name: 'Provident Fund', type_code: 'PF' };
                    r.contribution_type_id = pfTypeId;
                    contributionRules.push(r);
                });
            }
            displayExistingPfRule(pfRules);
        }

        // Load ESI rules
        if (esiTypeId) {
            const esiRules = await api.request(`/hrms/statutory/contribution-types/${esiTypeId}/rules`);
            if (esiRules && esiRules.length > 0) {
                esiRules.forEach(r => {
                    r.contribution_type = { type_name: 'Employee State Insurance', type_code: 'ESI' };
                    r.contribution_type_id = esiTypeId;
                    contributionRules.push(r);
                });
            }
            displayExistingEsiRule(esiRules);
        }
    } catch (error) {
        console.error('Error loading existing rules:', error);
    }
}

async function loadContributionRules() {
    await loadExistingRules();
}

function displayExistingPfRule(rules) {
    const detailsContainer = document.getElementById('pfRuleDetails');
    const statusEl = document.getElementById('pfRuleStatus');
    const rulesDisplay = document.getElementById('currentRulesDisplay');
    const statusMessage = document.getElementById('rulesStatusMessage');

    if (!detailsContainer) return;

    // Show the rules display container
    if (rulesDisplay) rulesDisplay.style.display = 'grid';
    if (statusMessage) statusMessage.textContent = 'Current contribution rules configured for your organization:';

    if (!rules || rules.length === 0) {
        if (statusEl) {
            statusEl.textContent = 'Not Configured';
            statusEl.className = 'rule-status not-configured';
        }
        detailsContainer.innerHTML = `<p class="no-rule-text">No PF contribution rules configured.</p>`;
        return;
    }

    // Get the most recent/active rule
    const rule = rules.find(r => r.is_active) || rules[0];

    if (statusEl) {
        statusEl.textContent = rule.is_active ? 'Active' : 'Inactive';
        statusEl.className = `rule-status ${rule.is_active ? 'active' : 'inactive'}`;
    }

    detailsContainer.innerHTML = `
        <div class="rule-details-grid">
            <div class="rule-item">
                <span class="label">Effective From:</span>
                <span class="value">${formatDate(rule.effective_from)}</span>
            </div>
            <div class="rule-item">
                <span class="label">Employee Rate:</span>
                <span class="value">${rule.employee_rate}% of ${rule.employee_rate_of || 'Basic'}</span>
            </div>
            <div class="rule-item">
                <span class="label">Employer Rate:</span>
                <span class="value">${rule.employer_rate}% of ${rule.employer_rate_of || 'Basic'}</span>
            </div>
            <div class="rule-item">
                <span class="label">Wage Ceiling:</span>
                <span class="value">₹${(rule.wage_ceiling || 0).toLocaleString('en-IN')}</span>
            </div>
            ${rule.admin_charge_rate ? `
            <div class="rule-item">
                <span class="label">Admin Charge:</span>
                <span class="value">${rule.admin_charge_rate}%</span>
            </div>
            ` : ''}
        </div>
        <div class="rule-actions" style="margin-top: 1rem; display: flex; gap: 0.5rem;">
            <button class="btn btn-sm btn-secondary" onclick="showEditContributionRuleModal('${rule.id}')" title="Edit PF Rule">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                Edit
            </button>
            <button class="btn btn-sm btn-danger" onclick="deleteContributionRule('${rule.id}')" title="Delete PF Rule">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                Delete
            </button>
        </div>
    `;
}

function displayExistingEsiRule(rules) {
    const detailsContainer = document.getElementById('esiRuleDetails');
    const statusEl = document.getElementById('esiRuleStatus');
    const rulesDisplay = document.getElementById('currentRulesDisplay');

    if (!detailsContainer) return;

    // Show the rules display container
    if (rulesDisplay) rulesDisplay.style.display = 'grid';

    if (!rules || rules.length === 0) {
        if (statusEl) {
            statusEl.textContent = 'Not Configured';
            statusEl.className = 'rule-status not-configured';
        }
        detailsContainer.innerHTML = `<p class="no-rule-text">No ESI contribution rules configured.</p>`;
        return;
    }

    // Get the most recent/active rule
    const rule = rules.find(r => r.is_active) || rules[0];

    if (statusEl) {
        statusEl.textContent = rule.is_active ? 'Active' : 'Inactive';
        statusEl.className = `rule-status ${rule.is_active ? 'active' : 'inactive'}`;
    }

    detailsContainer.innerHTML = `
        <div class="rule-details-grid">
            <div class="rule-item">
                <span class="label">Effective From:</span>
                <span class="value">${formatDate(rule.effective_from)}</span>
            </div>
            <div class="rule-item">
                <span class="label">Employee Rate:</span>
                <span class="value">${rule.employee_rate}%</span>
            </div>
            <div class="rule-item">
                <span class="label">Employer Rate:</span>
                <span class="value">${rule.employer_rate}%</span>
            </div>
            <div class="rule-item">
                <span class="label">Salary Threshold:</span>
                <span class="value">₹${(rule.wage_ceiling || 21000).toLocaleString('en-IN')}</span>
            </div>
        </div>
        <div class="rule-actions" style="margin-top: 1rem; display: flex; gap: 0.5rem;">
            <button class="btn btn-sm btn-secondary" onclick="showEditContributionRuleModal('${rule.id}')" title="Edit ESI Rule">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                Edit
            </button>
            <button class="btn btn-sm btn-danger" onclick="deleteContributionRule('${rule.id}')" title="Delete ESI Rule">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                Delete
            </button>
        </div>
    `;
}

function formatDate(dateStr) {
    if (!dateStr) return 'N/A';
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function populateContributionRulesFYDropdowns() {
    // Convert financialYears to options format
    const fyOptions = financialYears.map(fy => ({
        value: fy.id,
        label: fy.financial_year,
        isCurrent: fy.is_current
    }));

    // Get current FY id
    const currentFY = financialYears.find(fy => fy.is_current);
    const currentFYId = currentFY ? currentFY.id : null;

    // Initialize PF Financial Year Dropdown
    pfFYDropdown = new ComplianceSearchableDropdown('pfFinancialYearDropdown', {
        id: 'pfFYSearchable',
        options: fyOptions,
        placeholder: 'Select Financial Year',
        searchPlaceholder: 'Search FY...',
        value: currentFYId,
        onChange: () => {}
    });

    // Initialize ESI Financial Year Dropdown
    esiFYDropdown = new ComplianceSearchableDropdown('esiFinancialYearDropdown', {
        id: 'esiFYSearchable',
        options: fyOptions,
        placeholder: 'Select Financial Year',
        searchPlaceholder: 'Search FY...',
        value: currentFYId,
        onChange: () => {}
    });
}

// ==================== Dropdown Population ====================

function populateYearDropdowns() {
    const currentYear = new Date().getFullYear();
    const currentMonth = new Date().getMonth() + 1; // 1-12

    // Initialize ECR Month Picker
    ecrMonthPicker = new ComplianceMonthPicker('ecrMonthPicker', {
        yearsBack: 5,
        yearsForward: 1,
        year: currentYear,
        month: currentMonth,
        allowAllMonths: false,
        onChange: () => {} // Optional callback
    });

    // Initialize ESI Month Picker
    esiMonthPicker = new ComplianceMonthPicker('esiMonthPicker', {
        yearsBack: 5,
        yearsForward: 1,
        year: currentYear,
        month: currentMonth,
        allowAllMonths: false,
        onChange: () => {}
    });
}

function populateFYDropdowns() {
    const currentYear = new Date().getFullYear();
    const currentMonth = new Date().getMonth();
    // Financial year starts in April
    const startFY = currentMonth >= 3 ? currentYear : currentYear - 1;
    const fyOptions = [];

    // Generate 20 years of financial years for virtual scroll
    for (let y = startFY + 5; y >= startFY - 15; y--) {
        fyOptions.push({
            value: `${y}-${(y + 1).toString().slice(-2)}`,
            label: `FY ${y}-${(y + 1).toString().slice(-2)}`
        });
    }

    // Get current FY value
    const currentFY = `${startFY}-${(startFY + 1).toString().slice(-2)}`;

    // Initialize Form 16 FY Dropdown
    form16FYDropdown = new ComplianceSearchableDropdown('form16FYDropdown', {
        id: 'form16FYSearchable',
        options: fyOptions,
        placeholder: 'Select Financial Year',
        searchPlaceholder: 'Search FY...',
        value: currentFY,
        onChange: () => {}
    });

    // Initialize Bulk Form 16 FY Dropdown
    bulkForm16FYDropdown = new ComplianceSearchableDropdown('bulkForm16FYDropdown', {
        id: 'bulkForm16FYSearchable',
        options: fyOptions,
        placeholder: 'Select Financial Year',
        searchPlaceholder: 'Search FY...',
        value: currentFY,
        onChange: () => {}
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
    const container = document.querySelector('.hrms-container');

    // Open sidebar by default on page load
    if (sidebar) {
        sidebar.classList.add('open');
    }
    if (sidebarToggle) {
        sidebarToggle.classList.add('active');
    }
    if (container) {
        container.classList.add('sidebar-open');
    }

    if (sidebarToggle && sidebar) {
        sidebarToggle.addEventListener('click', () => {
            sidebar.classList.toggle('open');
            sidebarToggle.classList.toggle('active');
            container?.classList.toggle('sidebar-open');
            if (overlay) overlay.classList.toggle('active');
        });
    }

    if (overlay) {
        overlay.addEventListener('click', () => {
            sidebar.classList.remove('open');
            sidebarToggle.classList.remove('active');
            container?.classList.remove('sidebar-open');
            overlay.classList.remove('active');
        });
    }

    // Close sidebar on Escape key
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && sidebar?.classList.contains('open')) {
            sidebarToggle?.classList.remove('active');
            sidebar.classList.remove('open');
            container?.classList.remove('sidebar-open');
            if (overlay) overlay.classList.remove('active');
        }
    });

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

    // Load tab-specific data
    if (tabId === 'tax-regimes') {
        loadTaxRegimes();
    } else if (tabId === 'financial-years') {
        displayFinancialYears();
    } else if (tabId === 'tax-rebates') {
        loadTaxRebates();
    } else if (tabId === 'deduction-sections') {
        loadDeductionSections();
    } else if (tabId === 'returns-types') {
        loadReturnsTypes();
    } else if (tabId === 'statements-types') {
        loadStatementsTypes();
    } else if (tabId === 'tax-calculator') {
        initializeTaxCalculator();
    } else if (tabId === 'compliance-validation') {
        initializeComplianceValidation();
    } else if (tabId === 'pt-states') {
        loadPTStates();
    } else if (tabId === 'pt-configs') {
        loadPTConfigs();
    } else if (tabId === 'pt-slabs') {
        initializePTSlabs();
    } else if (tabId === 'pt-exemptions') {
        loadPTExemptions();
    } else if (tabId === 'pt-calculator') {
        initializePTCalculator();
    } else if (tabId === 'lwf-configs') {
        loadLWFConfigs();
    } else if (tabId === 'lwf-calculator') {
        initializeLWFCalculator();
    }

    // Close sidebar only on mobile (< 768px)
    if (window.innerWidth < 768) {
        const sidebar = document.getElementById('organizationSidebar');
        const sidebarToggle = document.getElementById('sidebarToggle');
        const overlay = document.getElementById('sidebarOverlay');
        const container = document.querySelector('.hrms-container');
        if (sidebar) sidebar.classList.remove('open');
        if (sidebarToggle) sidebarToggle.classList.remove('active');
        if (overlay) overlay.classList.remove('active');
        if (container) container.classList.remove('sidebar-open');
    }
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

    // PF Rule Form
    const pfRuleForm = document.getElementById('pfRuleForm');
    if (pfRuleForm) {
        pfRuleForm.addEventListener('submit', handlePfRuleSubmit);
    }

    // ESI Rule Form
    const esiRuleForm = document.getElementById('esiRuleForm');
    if (esiRuleForm) {
        esiRuleForm.addEventListener('submit', handleEsiRuleSubmit);
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

async function handlePfRuleSubmit(e) {
    e.preventDefault();

    if (!pfTypeId) {
        showToast('PF contribution type not found. Please refresh the page.', 'error');
        return;
    }

    const btn = document.getElementById('savePfRuleBtn');
    const btnText = btn.querySelector('.btn-text');
    const btnSpinner = btn.querySelector('.btn-spinner');

    try {
        btn.disabled = true;
        btnText.textContent = 'Saving...';
        btnSpinner.style.display = 'inline-block';

        const data = {
            contribution_type_id: pfTypeId,
            effective_from: document.getElementById('pfEffectiveFrom').value,
            financial_year_id: pfFYDropdown ? pfFYDropdown.getValue() : null,
            employee_rate: parseFloat(document.getElementById('pfEmployeeRate').value),
            employee_rate_of: document.getElementById('pfEmployeeRateOf').value || 'Basic',
            employer_rate: parseFloat(document.getElementById('pfEmployerRate').value),
            employer_rate_of: document.getElementById('pfEmployerRateOf').value || 'Basic',
            wage_ceiling: parseFloat(document.getElementById('pfWageCeiling').value) || 15000,
            wage_ceiling_applies_to: document.getElementById('pfWageCeilingAppliesTo').value || 'Both',
            admin_charge_rate: parseFloat(document.getElementById('pfAdminCharge').value) || 0,
            is_active: true
        };

        await api.request(`/hrms/statutory/contribution-types/${pfTypeId}/rules`, {
            method: 'POST',
            body: JSON.stringify(data)
        });

        showToast('PF contribution rule saved successfully', 'success');

        // Reload existing rules to show the new one
        await loadExistingRules();

        // Refresh compliance status banner
        await checkAndDisplayComplianceStatus();

        // Reset form
        document.getElementById('pfRuleForm').reset();
        setDefaultPfFormValues();

    } catch (error) {
        console.error('Error saving PF rule:', error);
        showToast(error.message || 'Failed to save PF rule', 'error');
    } finally {
        btn.disabled = false;
        btnText.textContent = 'Save PF Rule';
        btnSpinner.style.display = 'none';
    }
}

async function handleEsiRuleSubmit(e) {
    e.preventDefault();

    if (!esiTypeId) {
        showToast('ESI contribution type not found. Please refresh the page.', 'error');
        return;
    }

    const btn = document.getElementById('saveEsiRuleBtn');
    const btnText = btn.querySelector('.btn-text');
    const btnSpinner = btn.querySelector('.btn-spinner');

    try {
        btn.disabled = true;
        btnText.textContent = 'Saving...';
        btnSpinner.style.display = 'inline-block';

        const data = {
            contribution_type_id: esiTypeId,
            effective_from: document.getElementById('esiEffectiveFrom').value,
            financial_year_id: esiFYDropdown ? esiFYDropdown.getValue() : null,
            employee_rate: parseFloat(document.getElementById('esiEmployeeRate').value),
            employee_rate_of: 'Gross',
            employer_rate: parseFloat(document.getElementById('esiEmployerRate').value),
            employer_rate_of: 'Gross',
            wage_ceiling: parseFloat(document.getElementById('esiMaxSalaryThreshold').value) || 21000,
            wage_ceiling_applies_to: null,  // ESI uses wage_ceiling as eligibility threshold, not calculation ceiling
            is_active: true
        };

        await api.request(`/hrms/statutory/contribution-types/${esiTypeId}/rules`, {
            method: 'POST',
            body: JSON.stringify(data)
        });

        showToast('ESI contribution rule saved successfully', 'success');

        // Reload existing rules to show the new one
        await loadExistingRules();

        // Refresh compliance status banner
        await checkAndDisplayComplianceStatus();

        // Reset form
        document.getElementById('esiRuleForm').reset();
        setDefaultEsiFormValues();

    } catch (error) {
        console.error('Error saving ESI rule:', error);
        showToast(error.message || 'Failed to save ESI rule', 'error');
    } finally {
        btn.disabled = false;
        btnText.textContent = 'Save ESI Rule';
        btnSpinner.style.display = 'none';
    }
}

function setDefaultPfFormValues() {
    document.getElementById('pfEmployeeRate').value = '12.00';
    document.getElementById('pfEmployerRate').value = '12.00';
    document.getElementById('pfWageCeiling').value = '15000.00';
    document.getElementById('pfAdminCharge').value = '0.50';
}

function setDefaultEsiFormValues() {
    document.getElementById('esiEmployeeRate').value = '0.75';
    document.getElementById('esiEmployerRate').value = '3.25';
    document.getElementById('esiMaxSalaryThreshold').value = '21000.00';
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

        await api.request('/hrms/statutory/company-info', {
            method: 'PUT',
            body: JSON.stringify(data)
        });

        showToast('Company information saved successfully', 'success');

        // Refresh compliance status banner
        await checkAndDisplayComplianceStatus();
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
    if (!ecrMonthPicker) {
        showToast('Month picker not initialized', 'error');
        return;
    }

    const month = ecrMonthPicker.getMonth();
    const year = ecrMonthPicker.getYear();
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

        const response = await api.request('/hrms/statutory/generate/ecr', {
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
    if (!ecrMonthPicker) {
        showToast('Month picker not initialized', 'error');
        return;
    }

    const month = ecrMonthPicker.getMonth();
    const year = ecrMonthPicker.getYear();
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

        const response = await api.request('/hrms/statutory/generate/ecr/download', {
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
    if (!esiMonthPicker) {
        showToast('Month picker not initialized', 'error');
        return;
    }

    const month = esiMonthPicker.getMonth();
    const year = esiMonthPicker.getYear();
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

        const response = await api.request('/hrms/statutory/generate/esi-challan', {
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
    if (!esiMonthPicker) {
        showToast('Month picker not initialized', 'error');
        return;
    }

    const month = esiMonthPicker.getMonth();
    const year = esiMonthPicker.getYear();
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

        const response = await api.request('/hrms/statutory/generate/esi-challan/download', {
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
    const fy = form16FYDropdown ? form16FYDropdown.getValue() : null;

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

        const response = await api.request('/hrms/statutory/generate/form16', {
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
    const fy = bulkForm16FYDropdown ? bulkForm16FYDropdown.getValue() : null;
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

        const response = await api.request('/hrms/statutory/generate/form16/bulk', {
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

// showToast is provided by toast.js - no local override needed

// ==================== Tax Regime Variables ====================
let taxRegimes = [];
let taxCessList = [];
let currentRegimeId = null;
let currentSlabs = [];
let currentSurcharges = [];

// ==================== Tax Regime Functions ====================

async function loadTaxRegimes() {
    if (!indiaCountryId) {
        console.warn('Cannot load tax regimes - India country ID not available');
        return;
    }

    try {
        const response = await api.request(`/hrms/statutory/tax/regimes?countryId=${indiaCountryId}`);
        taxRegimes = response || [];
        console.log('Tax regimes loaded:', taxRegimes);
        displayTaxRegimes();

        // Also load cess
        await loadTaxCess();
    } catch (error) {
        console.error('Error loading tax regimes:', error);
        showToast('Failed to load tax regimes', 'error');
    }
}

async function loadTaxCess() {
    if (!indiaCountryId) return;

    try {
        const response = await api.request(`/hrms/statutory/tax/cess?countryId=${indiaCountryId}`);
        taxCessList = response || [];
        console.log('Tax cess loaded:', taxCessList);
        displayTaxCess();
    } catch (error) {
        console.error('Error loading tax cess:', error);
    }
}

function displayTaxRegimes() {
    const container = document.getElementById('taxRegimesContainer');
    if (!container) return;

    if (!taxRegimes || taxRegimes.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                    <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2"></path>
                    <rect x="9" y="3" width="6" height="4" rx="1"></rect>
                    <path d="M9 12h6M9 16h6"></path>
                </svg>
                <h3>No Tax Regimes Configured</h3>
                <p>Add income tax regimes (Old and New) for FY 2024-25</p>
                <button class="btn btn-primary" onclick="showCreateRegimeModal()">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <line x1="12" y1="5" x2="12" y2="19"></line>
                        <line x1="5" y1="12" x2="19" y2="12"></line>
                    </svg>
                    Add Tax Regime
                </button>
            </div>
        `;
        return;
    }

    container.innerHTML = taxRegimes.map(regime => `
        <div class="regime-card ${regime.is_default ? 'default' : ''}">
            <div class="regime-header">
                <div class="regime-title">
                    <h4>${regime.regime_name || regime.name}</h4>
                    <span class="regime-code">${regime.regime_code || regime.code}</span>
                    ${regime.is_default ? '<span class="badge badge-primary">Default</span>' : ''}
                </div>
                <div class="regime-actions">
                    <button class="btn btn-sm btn-ghost" onclick="showTaxSlabModal('${regime.id}')" title="Manage Tax Slabs">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <rect x="3" y="3" width="7" height="7"></rect>
                            <rect x="14" y="3" width="7" height="7"></rect>
                            <rect x="14" y="14" width="7" height="7"></rect>
                            <rect x="3" y="14" width="7" height="7"></rect>
                        </svg>
                        Slabs
                    </button>
                    <button class="btn btn-sm btn-ghost" onclick="showSurchargeModal('${regime.id}')" title="Manage Surcharges">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M12 2v20M2 12h20"></path>
                            <circle cx="12" cy="12" r="4"></circle>
                        </svg>
                        Surcharge
                    </button>
                    <button class="btn btn-sm btn-ghost" onclick="editTaxRegime('${regime.id}')" title="Edit">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"></path>
                            <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                        </svg>
                    </button>
                    <button class="btn btn-sm btn-ghost btn-danger" onclick="deleteTaxRegime('${regime.id}')" title="Delete">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="3 6 5 6 21 6"></polyline>
                            <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"></path>
                        </svg>
                    </button>
                </div>
            </div>
            <p class="regime-description">${regime.description || 'No description'}</p>
            <div class="regime-slabs" id="regimeSlabs-${regime.id}">
                <div class="loading-spinner-small"></div>
            </div>
        </div>
    `).join('');

    // Load slabs for each regime
    taxRegimes.forEach(regime => loadRegimeSlabs(regime.id));
}

async function loadRegimeSlabs(regimeId) {
    const container = document.getElementById(`regimeSlabs-${regimeId}`);
    if (!container) return;

    try {
        const response = await api.request(`/hrms/statutory/tax/regimes/${regimeId}/slabs`);
        // Map API field names (slab_from/slab_to) to display names (income_from/income_to)
        const slabs = (response || []).map(slab => ({
            ...slab,
            income_from: slab.slab_from,
            income_to: slab.slab_to
        }));

        if (slabs.length === 0) {
            container.innerHTML = '<p class="no-slabs">No tax slabs configured</p>';
            return;
        }

        container.innerHTML = `
            <table class="mini-table">
                <thead>
                    <tr>
                        <th>Income From</th>
                        <th>Income To</th>
                        <th>Rate</th>
                    </tr>
                </thead>
                <tbody>
                    ${slabs.map(slab => `
                        <tr>
                            <td>₹${(slab.income_from || 0).toLocaleString('en-IN')}</td>
                            <td>${slab.income_to ? '₹' + slab.income_to.toLocaleString('en-IN') : 'No Limit'}</td>
                            <td>${slab.tax_rate}%</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        `;
    } catch (error) {
        console.error('Error loading regime slabs:', error);
        container.innerHTML = '<p class="error-text">Failed to load slabs</p>';
    }
}

function displayTaxCess() {
    const container = document.getElementById('taxCessContainer');
    if (!container) return;

    if (!taxCessList || taxCessList.length === 0) {
        container.innerHTML = `
            <div class="cess-card empty">
                <p>Health & Education Cess not configured</p>
                <button class="btn btn-sm btn-primary" onclick="showTaxCessModal()">Configure Cess</button>
            </div>
        `;
        return;
    }

    container.innerHTML = taxCessList.map(cess => `
        <div class="cess-card">
            <div class="cess-info">
                <span class="cess-name">${cess.cess_name || cess.name}</span>
                <span class="cess-rate">${cess.cess_rate || cess.rate}%</span>
            </div>
            <div class="cess-meta">
                <span>Applies on: ${cess.applies_on || 'Tax + Surcharge'}</span>
            </div>
            <div class="cess-actions">
                <button class="btn btn-sm btn-ghost" onclick="editTaxCess('${cess.id}')">Edit</button>
                <button class="btn btn-sm btn-ghost btn-danger" onclick="deleteTaxCess('${cess.id}')">Delete</button>
            </div>
        </div>
    `).join('');
}

// ==================== Tax Regime Modal Functions ====================

function showCreateRegimeModal() {
    currentRegimeId = null;
    document.getElementById('taxRegimeModalTitle').textContent = 'Add Tax Regime';
    document.getElementById('taxRegimeForm').reset();
    document.getElementById('regimeIsDefault').checked = false;
    openModal('taxRegimeModal');
}

async function editTaxRegime(regimeId) {
    currentRegimeId = regimeId;
    const regime = taxRegimes.find(r => r.id === regimeId);
    if (!regime) {
        showToast('Regime not found', 'error');
        return;
    }

    document.getElementById('taxRegimeModalTitle').textContent = 'Edit Tax Regime';
    document.getElementById('regimeCode').value = regime.regime_code || regime.code || '';
    document.getElementById('regimeName').value = regime.regime_name || regime.name || '';
    document.getElementById('regimeDescription').value = regime.description || '';
    document.getElementById('regimeIsDefault').checked = regime.is_default || false;
    openModal('taxRegimeModal');
}

async function saveTaxRegime(e) {
    if (e) e.preventDefault();

    const code = document.getElementById('regimeCode').value.trim();
    const name = document.getElementById('regimeName').value.trim();
    const description = document.getElementById('regimeDescription').value.trim();
    const isDefault = document.getElementById('regimeIsDefault').checked;

    if (!code || !name) {
        showToast('Please fill in required fields', 'warning');
        return;
    }

    try {
        showLoading();
        const data = {
            country_id: indiaCountryId,
            regime_code: code,
            regime_name: name,
            description: description,
            is_default: isDefault
        };

        if (currentRegimeId) {
            await api.request(`/hrms/statutory/tax/regimes/${currentRegimeId}`, {
                method: 'PUT',
                body: JSON.stringify(data)
            });
            showToast('Tax regime updated successfully', 'success');
        } else {
            await api.request('/hrms/statutory/tax/regimes', {
                method: 'POST',
                body: JSON.stringify(data)
            });
            showToast('Tax regime created successfully', 'success');
        }

        closeTaxRegimeModal();
        await loadTaxRegimes();
        hideLoading();
    } catch (error) {
        console.error('Error saving tax regime:', error);
        showToast(error.message || 'Failed to save tax regime', 'error');
        hideLoading();
    }
}

async function deleteTaxRegime(regimeId) {
    if (!confirm('Are you sure you want to delete this tax regime? All associated slabs and surcharges will also be deleted.')) {
        return;
    }

    try {
        showLoading();
        await api.request(`/hrms/statutory/tax/regimes/${regimeId}`, {
            method: 'DELETE'
        });
        showToast('Tax regime deleted successfully', 'success');
        await loadTaxRegimes();
        hideLoading();
    } catch (error) {
        console.error('Error deleting tax regime:', error);
        showToast(error.message || 'Failed to delete tax regime', 'error');
        hideLoading();
    }
}

function closeTaxRegimeModal() {
    closeModal('taxRegimeModal');
    currentRegimeId = null;
}

// ==================== Tax Slab Modal Functions ====================

async function showTaxSlabModal(regimeId) {
    currentRegimeId = regimeId;
    const regime = taxRegimes.find(r => r.id === regimeId);
    document.getElementById('taxSlabModalTitle').textContent = `Tax Slabs - ${regime?.regime_name || regime?.name || 'Unknown'}`;
    document.getElementById('slabRegimeName').textContent = regime?.regime_name || regime?.name || '-';

    // Populate Financial Year dropdown with SearchableDropdown
    const fyOptions = financialYears.map(fy => ({
        value: fy.id,
        label: fy.financial_year,
        isCurrent: fy.is_current
    }));
    const currentFY = financialYears.find(fy => fy.is_current);

    // Destroy existing dropdown if any
    if (slabFYDropdown) {
        slabFYDropdown.destroy();
    }

    slabFYDropdown = new ComplianceSearchableDropdown('slabFinancialYearDropdown', {
        id: 'slabFYSearchable',
        options: fyOptions,
        placeholder: 'Select Financial Year',
        searchPlaceholder: 'Search FY...',
        value: currentFY ? currentFY.id : null,
        onChange: () => {}
    });

    // Load existing slabs
    try {
        const response = await api.request(`/hrms/statutory/tax/regimes/${regimeId}/slabs`);
        // Map API field names (slab_from/slab_to) to internal names (income_from/income_to)
        currentSlabs = (response || []).map(slab => ({
            ...slab,
            income_from: slab.slab_from,
            income_to: slab.slab_to
        }));
        renderSlabTable();
    } catch (error) {
        console.error('Error loading slabs:', error);
        currentSlabs = [];
        renderSlabTable();
    }

    openModal('taxSlabModal');
}

function renderSlabTable() {
    const tbody = document.getElementById('slabTableBody');
    if (!tbody) return;

    if (currentSlabs.length === 0) {
        tbody.innerHTML = `
            <tr class="empty-row">
                <td colspan="6" style="text-align: center; padding: 20px;">
                    No slabs configured. Click "Add Slab" to add tax slabs.
                </td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = currentSlabs.map((slab, index) => `
        <tr data-slab-id="${slab.id || ''}" data-index="${index}">
            <td>
                <input type="number" class="form-control form-control-sm" value="${slab.slab_order || index + 1}"
                    onchange="updateSlabField(${index}, 'slab_order', this.value)" style="width: 50px;">
            </td>
            <td>
                <input type="number" class="form-control form-control-sm" value="${slab.income_from || 0}"
                    onchange="updateSlabField(${index}, 'income_from', this.value)" placeholder="0">
            </td>
            <td>
                <input type="number" class="form-control form-control-sm" value="${slab.income_to || ''}"
                    onchange="updateSlabField(${index}, 'income_to', this.value)" placeholder="No limit">
            </td>
            <td>
                <input type="number" class="form-control form-control-sm" value="${slab.tax_rate || 0}" step="0.01"
                    onchange="updateSlabField(${index}, 'tax_rate', this.value)" placeholder="0.00">
            </td>
            <td>
                <button class="btn btn-sm btn-ghost btn-danger" onclick="removeSlabRow(${index})">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <line x1="18" y1="6" x2="6" y2="18"></line>
                        <line x1="6" y1="6" x2="18" y2="18"></line>
                    </svg>
                </button>
            </td>
        </tr>
    `).join('');
}

function addSlabRow() {
    const newOrder = currentSlabs.length + 1;
    const lastSlab = currentSlabs[currentSlabs.length - 1];
    const newFrom = lastSlab ? (lastSlab.income_to || 0) + 1 : 0;

    currentSlabs.push({
        slab_order: newOrder,
        income_from: newFrom,
        income_to: null,
        tax_rate: 0,
        is_new: true
    });
    renderSlabTable();
}

function updateSlabField(index, field, value) {
    if (currentSlabs[index]) {
        if (field === 'income_to' && value === '') {
            currentSlabs[index][field] = null;
        } else if (['income_from', 'income_to', 'tax_rate', 'slab_order'].includes(field)) {
            currentSlabs[index][field] = value ? parseFloat(value) : null;
        } else {
            currentSlabs[index][field] = value;
        }
        currentSlabs[index].modified = true;
    }
}

function removeSlabRow(index) {
    const slab = currentSlabs[index];
    if (slab.id && !slab.is_new) {
        slab.deleted = true;
    } else {
        currentSlabs.splice(index, 1);
    }
    renderSlabTable();
}

async function saveAllSlabs() {
    if (!currentRegimeId) {
        showToast('No regime selected', 'error');
        return;
    }

    try {
        showLoading();

        // Process each slab
        for (const slab of currentSlabs) {
            if (slab.deleted && slab.id) {
                // Delete existing slab
                await api.request(`/hrms/statutory/tax/slabs/${slab.id}`, {
                    method: 'DELETE'
                });
            } else if (slab.is_new) {
                // Create new slab
                await api.request('/hrms/statutory/tax/slabs', {
                    method: 'POST',
                    body: JSON.stringify({
                        regime_id: currentRegimeId,
                        display_order: slab.slab_order,
                        slab_from: slab.income_from || 0,
                        slab_to: slab.income_to,
                        tax_rate: slab.tax_rate || 0,
                        fixed_amount: slab.fixed_amount,
                        effective_from: new Date().toISOString().split('T')[0]
                    })
                });
            } else if (slab.modified && slab.id) {
                // Update existing slab
                await api.request(`/hrms/statutory/tax/slabs/${slab.id}`, {
                    method: 'PUT',
                    body: JSON.stringify({
                        display_order: slab.slab_order,
                        slab_from: slab.income_from || 0,
                        slab_to: slab.income_to,
                        tax_rate: slab.tax_rate || 0,
                        fixed_amount: slab.fixed_amount,
                        effective_from: new Date().toISOString().split('T')[0]
                    })
                });
            }
        }

        showToast('Tax slabs saved successfully', 'success');
        closeTaxSlabModal();
        await loadTaxRegimes();
        hideLoading();
    } catch (error) {
        console.error('Error saving slabs:', error);
        showToast(error.message || 'Failed to save tax slabs', 'error');
        hideLoading();
    }
}

function closeTaxSlabModal() {
    closeModal('taxSlabModal');
    currentRegimeId = null;
    currentSlabs = [];
}

// ==================== Surcharge Modal Functions ====================

async function showSurchargeModal(regimeId) {
    currentRegimeId = regimeId;
    const regime = taxRegimes.find(r => r.id === regimeId);
    document.getElementById('surchargeModalTitle').textContent = `Surcharge Slabs - ${regime?.regime_name || regime?.name || 'Unknown'}`;
    document.getElementById('surchargeRegimeName').textContent = regime?.regime_name || regime?.name || '-';

    // Populate Financial Year dropdown with SearchableDropdown
    const fyOptions = financialYears.map(fy => ({
        value: fy.id,
        label: fy.financial_year,
        isCurrent: fy.is_current
    }));
    const currentFY = financialYears.find(fy => fy.is_current);

    // Destroy existing dropdown if any
    if (surchargeFYDropdown) {
        surchargeFYDropdown.destroy();
    }

    surchargeFYDropdown = new ComplianceSearchableDropdown('surchargeFinancialYearDropdown', {
        id: 'surchargeFYSearchable',
        options: fyOptions,
        placeholder: 'Select Financial Year',
        searchPlaceholder: 'Search FY...',
        value: currentFY ? currentFY.id : null,
        onChange: () => {}
    });

    // Load existing surcharges
    try {
        const response = await api.request(`/hrms/statutory/tax/regimes/${regimeId}/surcharge-slabs`);
        currentSurcharges = response || [];
        renderSurchargeTable();
    } catch (error) {
        console.error('Error loading surcharges:', error);
        currentSurcharges = [];
        renderSurchargeTable();
    }

    openModal('surchargeModal');
}

function renderSurchargeTable() {
    const tbody = document.getElementById('surchargeTableBody');
    if (!tbody) return;

    if (currentSurcharges.length === 0) {
        tbody.innerHTML = `
            <tr class="empty-row">
                <td colspan="4" style="text-align: center; padding: 20px;">
                    No surcharge slabs configured. Click "Add Surcharge" to add.
                </td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = currentSurcharges.map((slab, index) => `
        <tr data-surcharge-id="${slab.id || ''}" data-index="${index}">
            <td>
                <input type="number" class="form-control form-control-sm" value="${slab.income_from || 0}"
                    onchange="updateSurchargeField(${index}, 'income_from', this.value)" placeholder="0">
            </td>
            <td>
                <input type="number" class="form-control form-control-sm" value="${slab.income_to || ''}"
                    onchange="updateSurchargeField(${index}, 'income_to', this.value)" placeholder="No limit">
            </td>
            <td>
                <input type="number" class="form-control form-control-sm" value="${slab.surcharge_rate || 0}" step="0.01"
                    onchange="updateSurchargeField(${index}, 'surcharge_rate', this.value)" placeholder="0.00">
            </td>
            <td>
                <button class="btn btn-sm btn-ghost btn-danger" onclick="removeSurchargeRow(${index})">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <line x1="18" y1="6" x2="6" y2="18"></line>
                        <line x1="6" y1="6" x2="18" y2="18"></line>
                    </svg>
                </button>
            </td>
        </tr>
    `).join('');
}

function addSurchargeRow() {
    const lastSurcharge = currentSurcharges[currentSurcharges.length - 1];
    const newFrom = lastSurcharge ? (lastSurcharge.income_to || 0) + 1 : 5000000;

    currentSurcharges.push({
        income_from: newFrom,
        income_to: null,
        surcharge_rate: 0,
        is_new: true
    });
    renderSurchargeTable();
}

function updateSurchargeField(index, field, value) {
    if (currentSurcharges[index]) {
        if (field === 'income_to' && value === '') {
            currentSurcharges[index][field] = null;
        } else if (['income_from', 'income_to', 'surcharge_rate'].includes(field)) {
            currentSurcharges[index][field] = value ? parseFloat(value) : null;
        } else {
            currentSurcharges[index][field] = value;
        }
        currentSurcharges[index].modified = true;
    }
}

function removeSurchargeRow(index) {
    const slab = currentSurcharges[index];
    if (slab.id && !slab.is_new) {
        slab.deleted = true;
    } else {
        currentSurcharges.splice(index, 1);
    }
    renderSurchargeTable();
}

async function saveAllSurcharges() {
    if (!currentRegimeId) {
        showToast('No regime selected', 'error');
        return;
    }

    try {
        showLoading();

        // Process each surcharge
        for (const slab of currentSurcharges) {
            if (slab.deleted && slab.id) {
                await api.request(`/hrms/statutory/tax/surcharge-slabs/${slab.id}`, {
                    method: 'DELETE'
                });
            } else if (slab.is_new) {
                // Get effective_from from modal input
                const effectiveFrom = document.getElementById('surchargeEffectiveFrom')?.value || new Date().toISOString().split('T')[0];
                await api.request('/hrms/statutory/tax/surcharge-slabs', {
                    method: 'POST',
                    body: JSON.stringify({
                        regime_id: currentRegimeId,
                        effective_from: effectiveFrom,
                        income_from: slab.income_from || 0,
                        income_to: slab.income_to,
                        surcharge_rate: slab.surcharge_rate || 0
                    })
                });
            } else if (slab.modified && slab.id) {
                await api.request(`/hrms/statutory/tax/surcharge-slabs/${slab.id}`, {
                    method: 'PUT',
                    body: JSON.stringify({
                        income_from: slab.income_from || 0,
                        income_to: slab.income_to,
                        surcharge_rate: slab.surcharge_rate || 0
                    })
                });
            }
        }

        showToast('Surcharge slabs saved successfully', 'success');
        closeSurchargeModal();
        hideLoading();
    } catch (error) {
        console.error('Error saving surcharges:', error);
        showToast(error.message || 'Failed to save surcharge slabs', 'error');
        hideLoading();
    }
}

function closeSurchargeModal() {
    closeModal('surchargeModal');
    currentSurcharges = [];
}

// ==================== Tax Cess Modal Functions ====================

let currentCessId = null;

function showTaxCessModal() {
    currentCessId = null;
    document.getElementById('taxCessModalTitle').textContent = 'Configure Health & Education Cess';
    document.getElementById('cessCode').value = 'HEC';
    document.getElementById('cessName').value = 'Health & Education Cess';
    document.getElementById('cessRate').value = '4.00';
    document.getElementById('cessAppliesOn').value = 'tax_plus_surcharge';

    // Populate Financial Year dropdown with SearchableDropdown
    const fyOptions = financialYears.map(fy => ({
        value: fy.id,
        label: fy.financial_year,
        isCurrent: fy.is_current
    }));
    const currentFY = financialYears.find(fy => fy.is_current);

    // Destroy existing dropdown if any
    if (cessFYDropdown) {
        cessFYDropdown.destroy();
    }

    cessFYDropdown = new ComplianceSearchableDropdown('cessFinancialYearDropdown', {
        id: 'cessFYSearchable',
        options: fyOptions,
        placeholder: 'Select Financial Year',
        searchPlaceholder: 'Search FY...',
        value: currentFY ? currentFY.id : null,
        onChange: () => {}
    });

    openModal('taxCessModal');
}

async function editTaxCess(cessId) {
    currentCessId = cessId;
    const cess = taxCessList.find(c => c.id === cessId);
    if (!cess) {
        showToast('Cess not found', 'error');
        return;
    }

    document.getElementById('taxCessModalTitle').textContent = 'Edit Tax Cess';
    document.getElementById('cessCode').value = cess.cess_code || cess.code || '';
    document.getElementById('cessName').value = cess.cess_name || cess.name || '';
    document.getElementById('cessRate').value = cess.cess_rate || cess.rate || '4.00';
    document.getElementById('cessAppliesOn').value = cess.applies_on || 'tax_plus_surcharge';
    openModal('taxCessModal');
}

async function saveTaxCess(e) {
    if (e) e.preventDefault();

    const code = document.getElementById('cessCode').value.trim();
    const name = document.getElementById('cessName').value.trim();
    const rate = parseFloat(document.getElementById('cessRate').value);
    const appliesOn = document.getElementById('cessAppliesOn').value.trim();

    if (!code || !name || isNaN(rate)) {
        showToast('Please fill in all required fields', 'warning');
        return;
    }

    try {
        showLoading();
        const data = {
            country_id: indiaCountryId,
            cess_code: code,
            cess_name: name,
            cess_rate: rate,
            applies_on: appliesOn
        };

        if (currentCessId) {
            await api.request(`/hrms/statutory/tax/cess/${currentCessId}`, {
                method: 'PUT',
                body: JSON.stringify(data)
            });
            showToast('Tax cess updated successfully', 'success');
        } else {
            await api.request('/hrms/statutory/tax/cess', {
                method: 'POST',
                body: JSON.stringify(data)
            });
            showToast('Tax cess created successfully', 'success');
        }

        closeTaxCessModal();
        await loadTaxCess();
        hideLoading();
    } catch (error) {
        console.error('Error saving tax cess:', error);
        showToast(error.message || 'Failed to save tax cess', 'error');
        hideLoading();
    }
}

async function deleteTaxCess(cessId) {
    if (!confirm('Are you sure you want to delete this cess configuration?')) {
        return;
    }

    try {
        showLoading();
        await api.request(`/hrms/statutory/tax/cess/${cessId}`, {
            method: 'DELETE'
        });
        showToast('Tax cess deleted successfully', 'success');
        await loadTaxCess();
        hideLoading();
    } catch (error) {
        console.error('Error deleting tax cess:', error);
        showToast(error.message || 'Failed to delete tax cess', 'error');
        hideLoading();
    }
}

function closeTaxCessModal() {
    closeModal('taxCessModal');
    currentCessId = null;
}

// ==================== Modal Utilities ====================

function openModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.classList.add('active');
        document.body.style.overflow = 'hidden';
    }
}

function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.classList.remove('active');
        document.body.style.overflow = '';
    }
}

// Alias function for HTML onclick
function addSlabRowToModal() {
    addSlabRow();
}

// ==================== Financial Years Functions ====================

let currentFYId = null;

function displayFinancialYears() {
    const tbody = document.getElementById('financialYearsBody');
    if (!tbody) return;

    if (!financialYears || financialYears.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="5" class="empty-cell">
                    <div class="empty-state-inline">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                            <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                            <line x1="16" y1="2" x2="16" y2="6"></line>
                            <line x1="8" y1="2" x2="8" y2="6"></line>
                            <line x1="3" y1="10" x2="21" y2="10"></line>
                        </svg>
                        <span>No financial years configured. Click "Add Financial Year" to create one.</span>
                    </div>
                </td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = financialYears.map(fy => `
        <tr>
            <td>
                <span class="fy-name">${fy.financial_year}</span>
            </td>
            <td>${formatDate(fy.start_date)}</td>
            <td>${formatDate(fy.end_date)}</td>
            <td>
                ${fy.is_current
                    ? '<span class="badge badge-success">Current</span>'
                    : '<span class="badge badge-secondary">Inactive</span>'
                }
            </td>
            <td class="actions-cell">
                ${!fy.is_current ? `
                    <button class="btn btn-sm btn-ghost" onclick="setCurrentFinancialYear('${fy.id}')" title="Set as Current">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="20 6 9 17 4 12"></polyline>
                        </svg>
                    </button>
                ` : ''}
                <button class="btn btn-sm btn-ghost" onclick="editFinancialYear('${fy.id}')" title="Edit">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"></path>
                        <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                    </svg>
                </button>
                <button class="btn btn-sm btn-ghost btn-danger" onclick="deleteFinancialYear('${fy.id}')" title="Delete">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="3 6 5 6 21 6"></polyline>
                        <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"></path>
                    </svg>
                </button>
            </td>
        </tr>
    `).join('');
}

function showAddFinancialYearModal() {
    currentFYId = null;
    document.getElementById('financialYearModalTitle').textContent = 'Add Financial Year';
    document.getElementById('financialYearForm').reset();
    document.getElementById('fyId').value = '';
    document.getElementById('fyIsCurrent').checked = financialYears.length === 0; // Default to current if first
    document.getElementById('fyPreviewText').textContent = '';
    document.getElementById('fyStartDate').value = '';
    document.getElementById('fyEndDate').value = '';

    // Suggest next year if there are existing FYs
    if (financialYears.length > 0) {
        const lastFY = financialYears[financialYears.length - 1];
        const lastYear = parseInt(lastFY.financial_year.split('-')[0]);
        document.getElementById('fyStartYear').value = lastYear + 1;
        updateFYPreview();
    }

    openModal('financialYearModal');
}

function editFinancialYear(fyId) {
    currentFYId = fyId;
    const fy = financialYears.find(f => f.id === fyId);
    if (!fy) {
        showToast('Financial year not found', 'error');
        return;
    }

    document.getElementById('financialYearModalTitle').textContent = 'Edit Financial Year';
    document.getElementById('fyId').value = fy.id;

    // Extract year from financial_year (e.g., "2024-25" -> 2024)
    const startYear = parseInt(fy.financial_year.split('-')[0]);
    document.getElementById('fyStartYear').value = startYear;
    document.getElementById('fyStartDate').value = fy.start_date ? fy.start_date.split('T')[0] : '';
    document.getElementById('fyEndDate').value = fy.end_date ? fy.end_date.split('T')[0] : '';
    document.getElementById('fyIsCurrent').checked = fy.is_current || false;
    document.getElementById('fyPreviewText').textContent = `FY ${fy.financial_year}`;

    openModal('financialYearModal');
}

function updateFYPreview() {
    const startYear = parseInt(document.getElementById('fyStartYear').value);
    const previewText = document.getElementById('fyPreviewText');
    const startDateInput = document.getElementById('fyStartDate');
    const endDateInput = document.getElementById('fyEndDate');

    if (isNaN(startYear) || startYear < 2000 || startYear > 2100) {
        previewText.textContent = '';
        startDateInput.value = '';
        endDateInput.value = '';
        return;
    }

    const endYear = startYear + 1;
    const fyName = `${startYear}-${endYear.toString().slice(-2)}`;
    previewText.textContent = `Financial Year: ${fyName}`;

    // Auto-fill dates (April 1 to March 31)
    startDateInput.value = `${startYear}-04-01`;
    endDateInput.value = `${endYear}-03-31`;
}

async function saveFinancialYear(e) {
    if (e) e.preventDefault();

    const startYear = parseInt(document.getElementById('fyStartYear').value);
    if (isNaN(startYear) || startYear < 2000 || startYear > 2100) {
        showToast('Please enter a valid year (2000-2100)', 'warning');
        return;
    }

    const endYear = startYear + 1;
    const financialYear = `${startYear}-${endYear.toString().slice(-2)}`;
    const startDate = document.getElementById('fyStartDate').value || `${startYear}-04-01`;
    const endDate = document.getElementById('fyEndDate').value || `${endYear}-03-31`;
    const isCurrent = document.getElementById('fyIsCurrent').checked;

    if (!indiaCountryId) {
        showToast('Country configuration not found. Please refresh the page.', 'error');
        return;
    }

    // Check for duplicate
    const existing = financialYears.find(fy =>
        fy.financial_year === financialYear && fy.id !== currentFYId
    );
    if (existing) {
        showToast(`Financial year ${financialYear} already exists`, 'warning');
        return;
    }

    try {
        showLoading();
        const data = {
            country_id: indiaCountryId,
            financial_year: financialYear,
            start_date: startDate,
            end_date: endDate,
            is_current: isCurrent
        };

        if (currentFYId) {
            await api.request(`/hrms/statutory/countries/${indiaCountryId}/financial-years/${currentFYId}`, {
                method: 'PUT',
                body: JSON.stringify(data)
            });
            showToast('Financial year updated successfully', 'success');
        } else {
            await api.request(`/hrms/statutory/countries/${indiaCountryId}/financial-years`, {
                method: 'POST',
                body: JSON.stringify(data)
            });
            showToast('Financial year created successfully', 'success');
        }

        closeFinancialYearModal();
        await loadFinancialYears();
        displayFinancialYears();

        // Refresh compliance status banner
        await checkAndDisplayComplianceStatus();

        hideLoading();
    } catch (error) {
        console.error('Error saving financial year:', error);
        showToast(error.message || 'Failed to save financial year', 'error');
        hideLoading();
    }
}

async function deleteFinancialYear(fyId) {
    const fy = financialYears.find(f => f.id === fyId);
    if (!fy) {
        showToast('Financial year not found', 'error');
        return;
    }

    if (fy.is_current) {
        showToast('Cannot delete the current financial year. Set another year as current first.', 'warning');
        return;
    }

    if (!confirm(`Are you sure you want to delete FY ${fy.financial_year}? This may affect associated tax configurations.`)) {
        return;
    }

    try {
        showLoading();
        await api.request(`/hrms/statutory/countries/${indiaCountryId}/financial-years/${fyId}`, {
            method: 'DELETE'
        });
        showToast('Financial year deleted successfully', 'success');
        await loadFinancialYears();
        displayFinancialYears();
        hideLoading();
    } catch (error) {
        console.error('Error deleting financial year:', error);
        showToast(error.message || 'Failed to delete financial year', 'error');
        hideLoading();
    }
}

async function setCurrentFinancialYear(fyId) {
    const fy = financialYears.find(f => f.id === fyId);
    if (!fy) {
        showToast('Financial year not found', 'error');
        return;
    }

    if (!confirm(`Set FY ${fy.financial_year} as the current financial year? This will be used as default for tax calculations.`)) {
        return;
    }

    try {
        showLoading();
        await api.request(`/hrms/statutory/countries/${indiaCountryId}/financial-years/${fyId}/set-current`, {
            method: 'PUT'
        });
        showToast(`FY ${fy.financial_year} is now the current financial year`, 'success');
        await loadFinancialYears();
        displayFinancialYears();
        hideLoading();
    } catch (error) {
        console.error('Error setting current financial year:', error);
        showToast(error.message || 'Failed to set current financial year', 'error');
        hideLoading();
    }
}

function closeFinancialYearModal() {
    closeModal('financialYearModal');
    currentFYId = null;
}

// ==================== Tax Rebates (Section 87A) CRUD ====================

let taxRebates = [];
let currentRebateId = null;

async function loadTaxRebates() {
    if (!indiaCountryId) {
        console.warn('India country ID not loaded yet');
        return;
    }

    try {
        const tbody = document.getElementById('taxRebatesBody');
        if (tbody) {
            tbody.innerHTML = '<tr><td colspan="8" class="loading-cell">Loading tax rebates...</td></tr>';
        }

        const response = await api.request(`/hrms/statutory/rebates?countryId=${indiaCountryId}`);
        taxRebates = Array.isArray(response) ? response : (response.rebates || []);
        displayTaxRebates();
    } catch (error) {
        console.error('Error loading tax rebates:', error);
        const tbody = document.getElementById('taxRebatesBody');
        if (tbody) {
            tbody.innerHTML = '<tr><td colspan="8" class="no-data-cell">Failed to load tax rebates</td></tr>';
        }
    }
}

function displayTaxRebates() {
    const tbody = document.getElementById('taxRebatesBody');
    if (!tbody) return;

    if (!taxRebates || taxRebates.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" class="no-data-cell">No tax rebates configured. Click "Add Tax Rebate" to create one.</td></tr>';
        return;
    }

    const html = taxRebates.map(rebate => {
        const regimeName = taxRegimes.find(r => r.id === rebate.regime_id)?.regime_name || rebate.regime_code || 'Unknown';
        const isActive = rebate.is_active !== false;
        const effectiveTo = rebate.effective_to ? formatDate(rebate.effective_to) : '—';

        return `
            <tr>
                <td><strong>${rebate.section_code || '87A'}</strong><br><small>${rebate.section_name || ''}</small></td>
                <td>${regimeName}</td>
                <td>${formatCurrency(rebate.income_threshold)}</td>
                <td>${formatCurrency(rebate.max_rebate_amount)}</td>
                <td>${formatDate(rebate.effective_from)}</td>
                <td>${effectiveTo}</td>
                <td><span class="status-badge ${isActive ? 'status-active' : 'status-inactive'}">${isActive ? 'Active' : 'Inactive'}</span></td>
                <td class="actions-cell">
                    <button class="btn btn-sm btn-secondary" onclick="showEditRebateModal('${rebate.id}')" title="Edit">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                    </button>
                    <button class="btn btn-sm btn-danger" onclick="deleteTaxRebate('${rebate.id}')" title="Delete">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                    </button>
                </td>
            </tr>
        `;
    }).join('');

    tbody.innerHTML = html;
}

async function showAddRebateModal() {
    currentRebateId = null;
    document.getElementById('taxRebateModalTitle').textContent = 'Add Tax Rebate';
    document.getElementById('taxRebateForm').reset();
    document.getElementById('rebateId').value = '';
    document.getElementById('rebateSectionCode').value = '87A';
    document.getElementById('rebateSectionName').value = 'Section 87A Rebate';

    // Populate regime dropdown
    await populateRebateRegimeDropdown();

    // Populate FY dropdown
    populateRebateFYDropdown();

    // Set default effective date
    const today = new Date().toISOString().split('T')[0];
    document.getElementById('rebateEffectiveFrom').value = today;

    openModal('taxRebateModal');
}

async function showEditRebateModal(rebateId) {
    const rebate = taxRebates.find(r => r.id === rebateId);
    if (!rebate) {
        showToast('Rebate not found', 'error');
        return;
    }

    currentRebateId = rebateId;
    document.getElementById('taxRebateModalTitle').textContent = 'Edit Tax Rebate';
    document.getElementById('rebateId').value = rebateId;
    document.getElementById('rebateSectionCode').value = rebate.section_code || '87A';
    document.getElementById('rebateSectionName').value = rebate.section_name || '';
    document.getElementById('rebateIncomeThreshold').value = rebate.income_threshold ?? '';
    document.getElementById('rebateMaxAmount').value = rebate.max_rebate_amount ?? '';
    document.getElementById('rebatePriority').value = rebate.priority || 0;
    document.getElementById('rebateDescription').value = rebate.description || '';

    // Populate dropdowns
    await populateRebateRegimeDropdown();
    document.getElementById('rebateRegimeId').value = rebate.regime_id || '';

    populateRebateFYDropdown();

    // Set dates
    if (rebate.effective_from) {
        document.getElementById('rebateEffectiveFrom').value = rebate.effective_from.split('T')[0];
    }
    if (rebate.effective_to) {
        document.getElementById('rebateEffectiveTo').value = rebate.effective_to.split('T')[0];
    }

    openModal('taxRebateModal');
}

async function populateRebateRegimeDropdown() {
    const selectId = 'rebateRegimeId';
    const select = document.getElementById(selectId);
    if (!select) return;

    // Load regimes if not already loaded
    if (!taxRegimes || taxRegimes.length === 0) {
        await loadTaxRegimes();
    }

    select.innerHTML = '<option value="">Select Tax Regime</option>';
    taxRegimes.forEach(regime => {
        select.innerHTML += `<option value="${regime.id}">${regime.regime_name} (${regime.regime_code})</option>`;
    });

    // Also update searchable dropdown component if it exists
    const regimeOptions = taxRegimes.map(regime => ({
        value: regime.id,
        label: `${regime.regime_name} (${regime.regime_code})`
    }));
    updateSearchableDropdownOptions(selectId, regimeOptions);
}

function populateRebateFYDropdown() {
    const container = document.getElementById('rebateFinancialYearDropdown');
    if (!container) return;

    const currentFY = financialYears.find(fy => fy.is_current);

    container.innerHTML = `
        <select class="form-select" id="rebateFYId">
            <option value="">Select Financial Year (Optional)</option>
            ${financialYears.map(fy => `
                <option value="${fy.id}" ${fy.is_current ? 'selected' : ''}>${fy.financial_year}${fy.is_current ? ' (Current)' : ''}</option>
            `).join('')}
        </select>
    `;
}

async function saveTaxRebate(event) {
    event.preventDefault();

    const rebateId = document.getElementById('rebateId').value;
    const regimeId = document.getElementById('rebateRegimeId').value;
    const fyId = document.getElementById('rebateFYId')?.value || null;

    if (!regimeId) {
        showToast('Please select a tax regime', 'error');
        return;
    }

    const payload = {
        section_code: document.getElementById('rebateSectionCode').value,
        section_name: document.getElementById('rebateSectionName').value,
        regime_id: regimeId,
        income_threshold: parseFloat(document.getElementById('rebateIncomeThreshold').value) || 0,
        max_rebate_amount: parseFloat(document.getElementById('rebateMaxAmount').value) || 0,
        effective_from: document.getElementById('rebateEffectiveFrom').value,
        effective_to: document.getElementById('rebateEffectiveTo').value || null,
        priority: parseInt(document.getElementById('rebatePriority').value) || 0,
        description: document.getElementById('rebateDescription').value || null,
        financial_year_id: fyId || null
    };

    try {
        showLoading();

        if (rebateId) {
            // Update existing
            await api.request(`/hrms/statutory/rebates/${rebateId}`, {
                method: 'PUT',
                body: JSON.stringify({ ...payload, country_id: indiaCountryId })
            });
            showToast('Tax rebate updated successfully', 'success');
        } else {
            // Create new
            await api.request(`/hrms/statutory/rebates`, {
                method: 'POST',
                body: JSON.stringify({ ...payload, country_id: indiaCountryId })
            });
            showToast('Tax rebate created successfully', 'success');
        }

        closeRebateModal();
        await loadTaxRebates();
        hideLoading();
    } catch (error) {
        console.error('Error saving tax rebate:', error);
        showToast(error.message || 'Failed to save tax rebate', 'error');
        hideLoading();
    }
}

async function deleteTaxRebate(rebateId) {
    const rebate = taxRebates.find(r => r.id === rebateId);
    if (!rebate) {
        showToast('Rebate not found', 'error');
        return;
    }

    if (!confirm(`Are you sure you want to delete the rebate "${rebate.section_name}"?`)) {
        return;
    }

    try {
        showLoading();
        await api.request(`/hrms/statutory/rebates/${rebateId}`, {
            method: 'DELETE'
        });
        showToast('Tax rebate deleted successfully', 'success');
        await loadTaxRebates();
        hideLoading();
    } catch (error) {
        console.error('Error deleting tax rebate:', error);
        showToast(error.message || 'Failed to delete tax rebate', 'error');
        hideLoading();
    }
}

function closeRebateModal() {
    closeModal('taxRebateModal');
    currentRebateId = null;
}

// ==================== Tax Deduction Sections CRUD ====================

let deductionSections = [];
let currentDeductionSectionId = null;

async function loadDeductionSections() {
    if (!indiaCountryId) {
        console.warn('India country ID not loaded yet');
        return;
    }

    try {
        const tbody = document.getElementById('deductionSectionsBody');
        if (tbody) {
            tbody.innerHTML = '<tr><td colspan="8" class="loading-cell">Loading deduction sections...</td></tr>';
        }

        const response = await api.request(`/hrms/statutory/tax/deduction-sections?countryId=${indiaCountryId}`);
        deductionSections = Array.isArray(response) ? response : (response.sections || []);
        displayDeductionSections();
    } catch (error) {
        console.error('Error loading deduction sections:', error);
        const tbody = document.getElementById('deductionSectionsBody');
        if (tbody) {
            tbody.innerHTML = '<tr><td colspan="8" class="no-data-cell">Failed to load deduction sections</td></tr>';
        }
    }
}

function displayDeductionSections() {
    const tbody = document.getElementById('deductionSectionsBody');
    if (!tbody) return;

    if (!deductionSections || deductionSections.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" class="no-data-cell">No deduction sections configured. Click "Add Deduction Section" to create one.</td></tr>';
        return;
    }

    const html = deductionSections.map(section => {
        const isActive = section.is_active !== false;
        const effectiveTo = section.effective_to ? formatDate(section.effective_to) : '—';
        const applicableRegimes = section.applicable_regimes || section.regime_names || 'All';

        return `
            <tr>
                <td><strong>${section.section_code}</strong></td>
                <td>${section.section_name}</td>
                <td>${formatCurrency(section.max_limit || section.maximum_limit)}</td>
                <td>${applicableRegimes}</td>
                <td>${formatDate(section.effective_from)}</td>
                <td>${effectiveTo}</td>
                <td><span class="status-badge ${isActive ? 'status-active' : 'status-inactive'}">${isActive ? 'Active' : 'Inactive'}</span></td>
                <td class="actions-cell">
                    <button class="btn btn-sm btn-secondary" onclick="showEditDeductionSectionModal('${section.id}')" title="Edit">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                    </button>
                    <button class="btn btn-sm btn-danger" onclick="deleteDeductionSection('${section.id}')" title="Delete">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                    </button>
                </td>
            </tr>
        `;
    }).join('');

    tbody.innerHTML = html;
}

async function showAddDeductionSectionModal() {
    currentDeductionSectionId = null;
    document.getElementById('deductionSectionModalTitle').textContent = 'Add Deduction Section';
    document.getElementById('deductionSectionForm').reset();
    document.getElementById('deductionSectionId').value = '';

    // Populate regime checkboxes
    await populateDeductionRegimeCheckboxes();

    // Populate FY dropdown
    populateDeductionFYDropdown();

    // Set default effective date
    const today = new Date().toISOString().split('T')[0];
    document.getElementById('deductionEffectiveFrom').value = today;

    openModal('deductionSectionModal');
}

async function showEditDeductionSectionModal(sectionId) {
    const section = deductionSections.find(s => s.id === sectionId);
    if (!section) {
        showToast('Deduction section not found', 'error');
        return;
    }

    currentDeductionSectionId = sectionId;
    document.getElementById('deductionSectionModalTitle').textContent = 'Edit Deduction Section';
    document.getElementById('deductionSectionId').value = sectionId;
    document.getElementById('deductionSectionCode').value = section.section_code || '';
    document.getElementById('deductionSectionName').value = section.section_name || '';
    document.getElementById('deductionMaxLimit').value = section.max_limit ?? section.maximum_limit ?? '';
    document.getElementById('deductionCategory').value = section.category || '';
    document.getElementById('deductionDescription').value = section.description || '';
    document.getElementById('deductionRequiresProof').checked = section.requires_proof || false;

    // Populate dropdowns and checkboxes
    await populateDeductionRegimeCheckboxes(section.applicable_regime_ids || []);
    populateDeductionFYDropdown();

    // Set dates
    if (section.effective_from) {
        document.getElementById('deductionEffectiveFrom').value = section.effective_from.split('T')[0];
    }
    if (section.effective_to) {
        document.getElementById('deductionEffectiveTo').value = section.effective_to.split('T')[0];
    }

    openModal('deductionSectionModal');
}

async function populateDeductionRegimeCheckboxes(selectedIds = []) {
    const container = document.getElementById('deductionRegimesCheckboxes');
    if (!container) return;

    // Load regimes if not already loaded
    if (!taxRegimes || taxRegimes.length === 0) {
        await loadTaxRegimes();
    }

    container.innerHTML = taxRegimes.map(regime => `
        <label class="checkbox-label">
            <input type="checkbox" name="deductionRegimes" value="${regime.id}" ${selectedIds.includes(regime.id) ? 'checked' : ''}>
            ${regime.regime_name}
        </label>
    `).join('');
}

function populateDeductionFYDropdown() {
    const container = document.getElementById('deductionFinancialYearDropdown');
    if (!container) return;

    container.innerHTML = `
        <select class="form-select" id="deductionFYId">
            <option value="">Select Financial Year (Optional)</option>
            ${financialYears.map(fy => `
                <option value="${fy.id}" ${fy.is_current ? 'selected' : ''}>${fy.financial_year}${fy.is_current ? ' (Current)' : ''}</option>
            `).join('')}
        </select>
    `;
}

async function saveDeductionSection(event) {
    event.preventDefault();

    const sectionId = document.getElementById('deductionSectionId').value;
    const fyId = document.getElementById('deductionFYId')?.value || null;

    // Get selected regime IDs
    const selectedRegimes = Array.from(document.querySelectorAll('input[name="deductionRegimes"]:checked')).map(cb => cb.value);

    if (selectedRegimes.length === 0) {
        showToast('Please select at least one applicable tax regime', 'error');
        return;
    }

    const payload = {
        section_code: document.getElementById('deductionSectionCode').value,
        section_name: document.getElementById('deductionSectionName').value,
        max_limit: parseFloat(document.getElementById('deductionMaxLimit').value) || 0,
        category: document.getElementById('deductionCategory').value,
        applicable_regime_ids: selectedRegimes,
        effective_from: document.getElementById('deductionEffectiveFrom').value,
        effective_to: document.getElementById('deductionEffectiveTo').value || null,
        requires_proof: document.getElementById('deductionRequiresProof').checked,
        description: document.getElementById('deductionDescription').value || null,
        financial_year_id: fyId || null
    };

    try {
        showLoading();

        if (sectionId) {
            // Update existing
            await api.request(`/hrms/statutory/tax/deduction-sections/${sectionId}`, {
                method: 'PUT',
                body: JSON.stringify({ ...payload, id: sectionId, country_id: indiaCountryId })
            });
            showToast('Deduction section updated successfully', 'success');
        } else {
            // Create new
            await api.request(`/hrms/statutory/tax/deduction-sections`, {
                method: 'POST',
                body: JSON.stringify({ ...payload, country_id: indiaCountryId })
            });
            showToast('Deduction section created successfully', 'success');
        }

        closeDeductionSectionModal();
        await loadDeductionSections();
        hideLoading();
    } catch (error) {
        console.error('Error saving deduction section:', error);
        showToast(error.message || 'Failed to save deduction section', 'error');
        hideLoading();
    }
}

async function deleteDeductionSection(sectionId) {
    const section = deductionSections.find(s => s.id === sectionId);
    if (!section) {
        showToast('Deduction section not found', 'error');
        return;
    }

    if (!confirm(`Are you sure you want to delete the deduction section "${section.section_name}"?`)) {
        return;
    }

    try {
        showLoading();
        await api.request(`/hrms/statutory/tax/deduction-sections/${sectionId}`, {
            method: 'DELETE'
        });
        showToast('Deduction section deleted successfully', 'success');
        await loadDeductionSections();
        hideLoading();
    } catch (error) {
        console.error('Error deleting deduction section:', error);
        showToast(error.message || 'Failed to delete deduction section', 'error');
        hideLoading();
    }
}

function closeDeductionSectionModal() {
    closeModal('deductionSectionModal');
    currentDeductionSectionId = null;
}

// ==================== Contribution Rules Edit/Delete ====================

let currentEditRuleId = null;

async function showEditContributionRuleModal(ruleId) {
    const rule = contributionRules.find(r => r.id === ruleId);
    if (!rule) {
        showToast('Contribution rule not found', 'error');
        return;
    }

    currentEditRuleId = ruleId;

    // Get the type name
    const typeName = rule.contribution_type?.type_name ||
                     contributionTypes.find(t => t.id === rule.contribution_type_id)?.type_name ||
                     'Unknown';

    document.getElementById('editRuleTypeName').textContent = typeName;
    document.getElementById('editRuleId').value = ruleId;
    document.getElementById('editEmployeeRate').value = rule.employee_rate || 0;
    document.getElementById('editEmployerRate').value = rule.employer_rate || 0;
    document.getElementById('editWageCeiling').value = rule.wage_ceiling ?? '';
    document.getElementById('editMinWage').value = rule.min_wage ?? '';

    if (rule.effective_from) {
        document.getElementById('editRuleEffectiveFrom').value = rule.effective_from.split('T')[0];
    }
    if (rule.effective_to) {
        document.getElementById('editRuleEffectiveTo').value = rule.effective_to.split('T')[0];
    } else {
        document.getElementById('editRuleEffectiveTo').value = '';
    }

    openModal('contributionRuleEditModal');
}

async function updateContributionRule(event) {
    event.preventDefault();

    const ruleId = document.getElementById('editRuleId').value;
    if (!ruleId) {
        showToast('Rule ID not found', 'error');
        return;
    }

    const payload = {
        employee_rate: parseFloat(document.getElementById('editEmployeeRate').value) || 0,
        employer_rate: parseFloat(document.getElementById('editEmployerRate').value) || 0,
        wage_ceiling: document.getElementById('editWageCeiling').value !== '' ? parseFloat(document.getElementById('editWageCeiling').value) : null,
        min_wage: document.getElementById('editMinWage').value !== '' ? parseFloat(document.getElementById('editMinWage').value) : null,
        effective_from: document.getElementById('editRuleEffectiveFrom').value,
        effective_to: document.getElementById('editRuleEffectiveTo').value || null
    };

    try {
        showLoading();
        await api.request(`/hrms/statutory/contribution-rules/${ruleId}`, {
            method: 'PUT',
            body: JSON.stringify(payload)
        });
        showToast('Contribution rule updated successfully', 'success');
        closeContributionRuleEditModal();
        await loadContributionRules();
        hideLoading();
    } catch (error) {
        console.error('Error updating contribution rule:', error);
        showToast(error.message || 'Failed to update contribution rule', 'error');
        hideLoading();
    }
}

async function deleteContributionRule(ruleId) {
    const rule = contributionRules.find(r => r.id === ruleId);
    if (!rule) {
        showToast('Contribution rule not found', 'error');
        return;
    }

    const typeName = rule.contribution_type?.type_name || 'this rule';

    if (!confirm(`Are you sure you want to delete the contribution rule for "${typeName}"? This action cannot be undone.`)) {
        return;
    }

    try {
        showLoading();
        await api.request(`/hrms/statutory/contribution-rules/${ruleId}`, {
            method: 'DELETE'
        });
        showToast('Contribution rule deleted successfully', 'success');
        await loadContributionRules();
        hideLoading();
    } catch (error) {
        console.error('Error deleting contribution rule:', error);
        showToast(error.message || 'Failed to delete contribution rule', 'error');
        hideLoading();
    }
}

function closeContributionRuleEditModal() {
    closeModal('contributionRuleEditModal');
    currentEditRuleId = null;
}

// ==================== Tax Slabs CRUD ====================

async function createTaxSlab(regimeId, slabData) {
    try {
        await api.request(`/hrms/statutory/tax/regimes/${regimeId}/slabs`, {
            method: 'POST',
            body: JSON.stringify(slabData)
        });
        return true;
    } catch (error) {
        console.error('Error creating tax slab:', error);
        throw error;
    }
}

async function updateTaxSlab(slabId, slabData) {
    try {
        await api.request(`/hrms/statutory/tax/slabs/${slabId}`, {
            method: 'PUT',
            body: JSON.stringify(slabData)
        });
        return true;
    } catch (error) {
        console.error('Error updating tax slab:', error);
        throw error;
    }
}

async function deleteTaxSlab(slabId) {
    try {
        await api.request(`/hrms/statutory/tax/slabs/${slabId}`, {
            method: 'DELETE'
        });
        return true;
    } catch (error) {
        console.error('Error deleting tax slab:', error);
        throw error;
    }
}

// ==================== Surcharge Slabs CRUD ====================

async function createSurchargeSlab(regimeId, slabData) {
    try {
        await api.request(`/hrms/statutory/tax/regimes/${regimeId}/surcharge-slabs`, {
            method: 'POST',
            body: JSON.stringify(slabData)
        });
        return true;
    } catch (error) {
        console.error('Error creating surcharge slab:', error);
        throw error;
    }
}

async function updateSurchargeSlab(slabId, slabData) {
    try {
        await api.request(`/hrms/statutory/tax/surcharge-slabs/${slabId}`, {
            method: 'PUT',
            body: JSON.stringify(slabData)
        });
        return true;
    } catch (error) {
        console.error('Error updating surcharge slab:', error);
        throw error;
    }
}

async function deleteSurchargeSlab(slabId) {
    try {
        await api.request(`/hrms/statutory/tax/surcharge-slabs/${slabId}`, {
            method: 'DELETE'
        });
        return true;
    } catch (error) {
        console.error('Error deleting surcharge slab:', error);
        throw error;
    }
}

// ==================== Tax Cess CRUD ====================

async function createTaxCess(countryId, cessData) {
    try {
        await api.request(`/hrms/statutory/tax/cess`, {
            method: 'POST',
            body: JSON.stringify(cessData)
        });
        return true;
    } catch (error) {
        console.error('Error creating tax cess:', error);
        throw error;
    }
}

async function updateTaxCess(cessId, cessData) {
    try {
        await api.request(`/hrms/statutory/tax/cess/${cessId}`, {
            method: 'PUT',
            body: JSON.stringify(cessData)
        });
        return true;
    } catch (error) {
        console.error('Error updating tax cess:', error);
        throw error;
    }
}

async function deleteTaxCess(cessId) {
    try {
        await api.request(`/hrms/statutory/tax/cess/${cessId}`, {
            method: 'DELETE'
        });
        return true;
    } catch (error) {
        console.error('Error deleting tax cess:', error);
        throw error;
    }
}

// ==================== Returns Types CRUD ====================

async function loadReturnsTypes() {
    try {
        showLoading();
        if (!indiaCountryId) {
            console.warn('Country ID not available yet, skipping returns types load');
            returnsTypes = [];
            displayReturnsTypes();
            hideLoading();
            return;
        }
        const response = await api.request(`/hrms/statutory/returns/types?countryId=${indiaCountryId}`);
        returnsTypes = response || [];
        console.log('Returns types loaded:', returnsTypes);
        displayReturnsTypes();
        hideLoading();
    } catch (error) {
        console.error('Error loading returns types:', error);
        showToast('Failed to load returns types', 'error');
        hideLoading();
    }
}

function displayReturnsTypes() {
    const tbody = document.getElementById('returnsTypesTableBody');
    if (!tbody) return;

    if (!returnsTypes || returnsTypes.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="5" class="text-center">
                    <div class="empty-state-inline">
                        <p>No returns types configured</p>
                        <button class="btn btn-sm btn-primary" onclick="showAddReturnTypeModal()">Add Return Type</button>
                    </div>
                </td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = returnsTypes.map(type => `
        <tr>
            <td><span class="code-badge">${type.return_code || '-'}</span></td>
            <td>${type.return_name || '-'}</td>
            <td>${type.filing_frequency || '-'}</td>
            <td>${type.due_day_of_period || '-'}</td>
            <td>${type.regulatory_portal ? 'Configured' : '-'}</td>
            <td>
                <span class="status-badge ${type.is_active ? 'active' : 'inactive'}">
                    ${type.is_active ? 'Active' : 'Inactive'}
                </span>
            </td>
            <td>
                <div class="action-buttons">
                    <button class="btn btn-sm btn-ghost" onclick="editReturnType('${type.id}')" title="Edit">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"></path>
                            <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                        </svg>
                    </button>
                    <button class="btn btn-sm btn-ghost btn-danger" onclick="deleteReturnType('${type.id}')" title="Delete">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="3 6 5 6 21 6"></polyline>
                            <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"></path>
                        </svg>
                    </button>
                </div>
            </td>
        </tr>
    `).join('');
}

function showAddReturnTypeModal() {
    currentReturnTypeId = null;
    const modal = document.getElementById('returnTypeModal');
    const title = modal.querySelector('.modal-title');
    const form = document.getElementById('returnTypeForm');

    title.textContent = 'Add Return Type';
    form.reset();
    document.getElementById('returnIsActive').checked = true;

    openModal('returnTypeModal');
}

function editReturnType(typeId) {
    const type = returnsTypes.find(t => t.id === typeId);
    if (!type) {
        showToast('Return type not found', 'error');
        return;
    }

    currentReturnTypeId = typeId;
    const modal = document.getElementById('returnTypeModal');
    const title = modal.querySelector('.modal-title');

    title.textContent = 'Edit Return Type';

    document.getElementById('returnTypeCode').value = type.return_code || '';
    document.getElementById('returnTypeName').value = type.return_name || '';
    document.getElementById('returnFrequency').value = type.filing_frequency || 'monthly';
    document.getElementById('returnDueDay').value = type.due_day_of_period ?? '';
    document.getElementById('returnAuthority').value = '';
    document.getElementById('returnPortal').value = type.regulatory_portal || '';
    document.getElementById('returnDescription').value = '';
    document.getElementById('returnIsActive').checked = type.is_active !== false;

    openModal('returnTypeModal');
}

async function saveReturnType() {
    if (!indiaCountryId) {
        showToast('Country not configured. Please refresh the page.', 'error');
        return;
    }

    const payload = {
        country_id: indiaCountryId,
        return_code: document.getElementById('returnTypeCode').value.trim(),
        return_name: document.getElementById('returnTypeName').value.trim(),
        filing_frequency: document.getElementById('returnFrequency').value.toLowerCase(),
        due_day_of_period: document.getElementById('returnDueDay').value !== '' ? parseInt(document.getElementById('returnDueDay').value) : null,
        regulatory_portal: document.getElementById('returnPortal').value.trim(),
        is_active: document.getElementById('returnIsActive').checked
    };

    if (!payload.return_code || !payload.return_name) {
        showToast('Please fill in required fields', 'warning');
        return;
    }

    try {
        showLoading();

        if (currentReturnTypeId) {
            // Update existing
            await api.request(`/hrms/statutory/returns/types/${currentReturnTypeId}`, {
                method: 'PUT',
                body: JSON.stringify(payload)
            });
            showToast('Return type updated successfully', 'success');
        } else {
            // Create new
            await api.request('/hrms/statutory/returns/types', {
                method: 'POST',
                body: JSON.stringify(payload)
            });
            showToast('Return type created successfully', 'success');
        }

        closeReturnTypeModal();
        await loadReturnsTypes();
        hideLoading();
    } catch (error) {
        console.error('Error saving return type:', error);
        showToast(error.message || 'Failed to save return type', 'error');
        hideLoading();
    }
}

async function deleteReturnType(typeId) {
    const type = returnsTypes.find(t => t.id === typeId);
    if (!type) {
        showToast('Return type not found', 'error');
        return;
    }

    if (!confirm(`Are you sure you want to delete "${type.return_name}"? This action cannot be undone.`)) {
        return;
    }

    try {
        showLoading();
        await api.request(`/hrms/statutory/returns/types/${typeId}`, {
            method: 'DELETE'
        });
        showToast('Return type deleted successfully', 'success');
        await loadReturnsTypes();
        hideLoading();
    } catch (error) {
        console.error('Error deleting return type:', error);
        showToast(error.message || 'Failed to delete return type', 'error');
        hideLoading();
    }
}

function closeReturnTypeModal() {
    closeModal('returnTypeModal');
    currentReturnTypeId = null;
}

// ==================== Statements Types CRUD ====================

async function loadStatementsTypes() {
    try {
        showLoading();
        if (!indiaCountryId) {
            console.warn('Country ID not available yet, skipping statements types load');
            statementsTypes = [];
            displayStatementsTypes();
            hideLoading();
            return;
        }
        const response = await api.request(`/hrms/statutory/statements/types?countryId=${indiaCountryId}`);
        statementsTypes = response || [];
        console.log('Statements types loaded:', statementsTypes);
        displayStatementsTypes();
        hideLoading();
    } catch (error) {
        console.error('Error loading statements types:', error);
        showToast('Failed to load statements types', 'error');
        hideLoading();
    }
}

function displayStatementsTypes() {
    const tbody = document.getElementById('statementsTypesTableBody');
    if (!tbody) return;

    if (!statementsTypes || statementsTypes.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="5" class="text-center">
                    <div class="empty-state-inline">
                        <p>No statement types configured</p>
                        <button class="btn btn-sm btn-primary" onclick="showAddStatementTypeModal()">Add Statement Type</button>
                    </div>
                </td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = statementsTypes.map(type => `
        <tr>
            <td><span class="code-badge">${type.statement_code || '-'}</span></td>
            <td>${type.statement_name || '-'}</td>
            <td>${type.template_format || 'pdf'}</td>
            <td>
                <span class="status-badge ${type.is_active ? 'active' : 'inactive'}">
                    ${type.is_active ? 'Active' : 'Inactive'}
                </span>
            </td>
            <td>
                <div class="action-buttons">
                    <button class="btn btn-sm btn-ghost" onclick="editStatementType('${type.id}')" title="Edit">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"></path>
                            <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                        </svg>
                    </button>
                    <button class="btn btn-sm btn-ghost btn-danger" onclick="deleteStatementType('${type.id}')" title="Delete">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="3 6 5 6 21 6"></polyline>
                            <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"></path>
                        </svg>
                    </button>
                </div>
            </td>
        </tr>
    `).join('');
}

function showAddStatementTypeModal() {
    currentStatementTypeId = null;
    const modal = document.getElementById('statementTypeModal');
    const title = modal.querySelector('.modal-title');
    const form = document.getElementById('statementTypeForm');

    title.textContent = 'Add Statement Type';
    form.reset();
    document.getElementById('statementIsActive').checked = true;

    openModal('statementTypeModal');
}

function editStatementType(typeId) {
    const type = statementsTypes.find(t => t.id === typeId);
    if (!type) {
        showToast('Statement type not found', 'error');
        return;
    }

    currentStatementTypeId = typeId;
    const modal = document.getElementById('statementTypeModal');
    const title = modal.querySelector('.modal-title');

    title.textContent = 'Edit Statement Type';

    document.getElementById('statementTypeCode').value = type.statement_code || '';
    document.getElementById('statementTypeName').value = type.statement_name || '';
    document.getElementById('statementFormat').value = type.template_format || 'pdf';
    document.getElementById('statementDescription').value = '';
    document.getElementById('statementIsActive').checked = type.is_active !== false;

    openModal('statementTypeModal');
}

async function saveStatementType(event) {
    if (event) event.preventDefault();

    if (!indiaCountryId) {
        showToast('Country not configured. Please refresh the page.', 'error');
        return;
    }

    const payload = {
        country_id: indiaCountryId,
        statement_code: document.getElementById('statementTypeCode').value.trim(),
        statement_name: document.getElementById('statementTypeName').value.trim(),
        template_format: document.getElementById('statementFormat').value || 'pdf',
        is_active: document.getElementById('statementIsActive').checked
    };

    if (!payload.statement_code || !payload.statement_name) {
        showToast('Please fill in required fields', 'warning');
        return;
    }

    try {
        showLoading();

        if (currentStatementTypeId) {
            // Update existing
            await api.request(`/hrms/statutory/statements/types/${currentStatementTypeId}`, {
                method: 'PUT',
                body: JSON.stringify(payload)
            });
            showToast('Statement type updated successfully', 'success');
        } else {
            // Create new
            await api.request('/hrms/statutory/statements/types', {
                method: 'POST',
                body: JSON.stringify(payload)
            });
            showToast('Statement type created successfully', 'success');
        }

        closeStatementTypeModal();
        await loadStatementsTypes();
        hideLoading();
    } catch (error) {
        console.error('Error saving statement type:', error);
        showToast(error.message || 'Failed to save statement type', 'error');
        hideLoading();
    }
}

async function deleteStatementType(typeId) {
    const type = statementsTypes.find(t => t.id === typeId);
    if (!type) {
        showToast('Statement type not found', 'error');
        return;
    }

    if (!confirm(`Are you sure you want to delete "${type.statement_name}"? This action cannot be undone.`)) {
        return;
    }

    try {
        showLoading();
        await api.request(`/hrms/statutory/statements/types/${typeId}`, {
            method: 'DELETE'
        });
        showToast('Statement type deleted successfully', 'success');
        await loadStatementsTypes();
        hideLoading();
    } catch (error) {
        console.error('Error deleting statement type:', error);
        showToast(error.message || 'Failed to delete statement type', 'error');
        hideLoading();
    }
}

function closeStatementTypeModal() {
    closeModal('statementTypeModal');
    currentStatementTypeId = null;
}

// ==================== Tax Calculator Functions ====================

function initializeTaxCalculator() {
    // Set up form handlers
    const taxCalculatorForm = document.getElementById('taxCalculatorForm');
    if (taxCalculatorForm) {
        taxCalculatorForm.addEventListener('submit', calculateIncomeTax);
    }

    const tdsCalculatorForm = document.getElementById('tdsCalculatorForm');
    if (tdsCalculatorForm) {
        tdsCalculatorForm.addEventListener('submit', calculateMonthlyTDS);
    }

    const contributionCalculatorForm = document.getElementById('contributionCalculatorForm');
    if (contributionCalculatorForm) {
        contributionCalculatorForm.addEventListener('submit', calculateContributions);
    }

    // Populate dropdowns
    populateCalculatorDropdowns();
}

function populateCalculatorDropdowns() {
    // Populate regime dropdown
    const regimeSelect = document.getElementById('calcRegimeId');
    if (regimeSelect) {
        regimeSelect.innerHTML = '<option value="">Select Regime</option>';
        taxRegimes.forEach(regime => {
            const option = document.createElement('option');
            option.value = regime.id;
            option.textContent = regime.regime_name || regime.name;
            regimeSelect.appendChild(option);
        });
    }

    // Populate employee dropdown for TDS
    const tdsEmployeeSelect = document.getElementById('tdsEmployeeId');
    if (tdsEmployeeSelect) {
        tdsEmployeeSelect.innerHTML = '<option value="">Select Employee</option>';
        employees.forEach(emp => {
            const option = document.createElement('option');
            option.value = emp.id;
            option.textContent = `${emp.first_name} ${emp.last_name || ''} (${emp.employee_code})`;
            tdsEmployeeSelect.appendChild(option);
        });
    }

    // Populate contribution type dropdown
    const contribTypeSelect = document.getElementById('contribTypeId');
    if (contribTypeSelect) {
        contribTypeSelect.innerHTML = '<option value="">All Types</option>';
        contributionTypes.forEach(type => {
            const option = document.createElement('option');
            option.value = type.id;
            option.textContent = type.type_name;
            contribTypeSelect.appendChild(option);
        });
    }
}

async function calculateIncomeTax(e) {
    if (e) e.preventDefault();

    const regimeId = document.getElementById('calcRegimeId')?.value;
    const grossIncome = parseFloat(document.getElementById('calcAnnualIncome').value) || 0;
    const calcDate = document.getElementById('calcDate')?.value;

    if (!grossIncome) {
        showToast('Please enter annual income', 'warning');
        return;
    }

    const resultsDiv = document.getElementById('taxCalculationResult');
    const resultGrid = document.getElementById('taxResultGrid');

    try {
        showLoading();

        const payload = {
            annual_gross_income: grossIncome,
            regime_id: regimeId || null,
            effective_date: calcDate || null
        };

        const response = await api.request('/hrms/statutory/calculate/tax', {
            method: 'POST',
            body: JSON.stringify(payload)
        });

        displayTaxCalculationResults(response, resultGrid);
        resultsDiv.style.display = 'block';
        hideLoading();
    } catch (error) {
        console.error('Error calculating tax:', error);
        showToast(error.message || 'Failed to calculate tax', 'error');
        hideLoading();
    }
}

function displayTaxCalculationResults(result, container) {
    if (!container) return;

    container.innerHTML = `
        <div class="calc-results">
            <h4>Tax Calculation Results</h4>
            <div class="result-grid">
                <div class="result-item">
                    <span class="label">Gross Income</span>
                    <span class="value">${formatCurrency(result.gross_income || 0)}</span>
                </div>
                <div class="result-item">
                    <span class="label">Standard Deduction</span>
                    <span class="value">${formatCurrency(result.standard_deduction || 0)}</span>
                </div>
                <div class="result-item">
                    <span class="label">Taxable Income</span>
                    <span class="value">${formatCurrency(result.taxable_income || 0)}</span>
                </div>
                <div class="result-item">
                    <span class="label">Tax (Before Rebate)</span>
                    <span class="value">${formatCurrency(result.tax_before_rebate || 0)}</span>
                </div>
                <div class="result-item">
                    <span class="label">Rebate u/s 87A</span>
                    <span class="value">${formatCurrency(result.rebate_87a || 0)}</span>
                </div>
                <div class="result-item">
                    <span class="label">Tax After Rebate</span>
                    <span class="value">${formatCurrency(result.tax_after_rebate || 0)}</span>
                </div>
                <div class="result-item">
                    <span class="label">Surcharge</span>
                    <span class="value">${formatCurrency(result.surcharge || 0)}</span>
                </div>
                <div class="result-item">
                    <span class="label">Health & Education Cess</span>
                    <span class="value">${formatCurrency(result.cess || 0)}</span>
                </div>
                <div class="result-item total">
                    <span class="label">Total Tax Payable</span>
                    <span class="value">${formatCurrency(result.total_tax || 0)}</span>
                </div>
            </div>
            ${result.config_sources ? `
            <div class="config-sources">
                <h5>Configuration Sources</h5>
                <ul>
                    ${Object.entries(result.config_sources).map(([key, value]) => `
                        <li><strong>${key}:</strong> ${value}</li>
                    `).join('')}
                </ul>
            </div>
            ` : ''}
        </div>
    `;
    container.style.display = 'block';
}

async function calculateMonthlyTDS(e) {
    if (e) e.preventDefault();

    const employeeId = document.getElementById('tdsEmployeeId')?.value;
    const monthlyGross = parseFloat(document.getElementById('tdsMonthlyGross').value) || 0;
    const arrears = parseFloat(document.getElementById('tdsArrears')?.value) || 0;

    if (!employeeId) {
        showToast('Please select an employee', 'warning');
        return;
    }

    if (!monthlyGross) {
        showToast('Please enter monthly gross salary', 'warning');
        return;
    }

    const resultsDiv = document.getElementById('tdsCalculationResult');
    const resultGrid = document.getElementById('tdsResultGrid');

    try {
        showLoading();

        const payload = {
            employee_id: employeeId,
            monthly_gross: monthlyGross,
            arrears: arrears
        };

        const response = await api.request('/hrms/statutory/calculate/monthly-tds', {
            method: 'POST',
            body: JSON.stringify(payload)
        });

        displayTDSCalculationResults(response, resultGrid);
        resultsDiv.style.display = 'block';
        hideLoading();
    } catch (error) {
        console.error('Error calculating monthly TDS:', error);
        showToast(error.message || 'Failed to calculate monthly TDS', 'error');
        hideLoading();
    }
}

function displayTDSCalculationResults(result, container) {
    if (!container) return;

    container.innerHTML = `
        <div class="calc-results">
            <h4>Monthly TDS Calculation</h4>
            <div class="result-grid">
                <div class="result-item">
                    <span class="label">Monthly Gross</span>
                    <span class="value">${formatCurrency(result.monthly_gross || 0)}</span>
                </div>
                <div class="result-item">
                    <span class="label">YTD Gross</span>
                    <span class="value">${formatCurrency(result.ytd_gross || 0)}</span>
                </div>
                <div class="result-item">
                    <span class="label">Projected Annual</span>
                    <span class="value">${formatCurrency(result.projected_annual || 0)}</span>
                </div>
                <div class="result-item">
                    <span class="label">Projected Tax</span>
                    <span class="value">${formatCurrency(result.projected_tax || 0)}</span>
                </div>
                <div class="result-item">
                    <span class="label">YTD TDS Deducted</span>
                    <span class="value">${formatCurrency(result.ytd_tds_deducted || 0)}</span>
                </div>
                <div class="result-item">
                    <span class="label">Remaining Tax</span>
                    <span class="value">${formatCurrency(result.remaining_tax || 0)}</span>
                </div>
                <div class="result-item">
                    <span class="label">Remaining Months</span>
                    <span class="value">${result.remaining_months || 0}</span>
                </div>
                <div class="result-item total">
                    <span class="label">Monthly TDS</span>
                    <span class="value">${formatCurrency(result.monthly_tds || 0)}</span>
                </div>
            </div>
            ${result.is_prorated ? `
            <div class="info-badge">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <circle cx="12" cy="12" r="10"></circle>
                    <line x1="12" y1="8" x2="12" y2="12"></line>
                    <line x1="12" y1="16" x2="12.01" y2="16"></line>
                </svg>
                TDS is prorated based on remaining months in the financial year
            </div>
            ` : ''}
        </div>
    `;
    container.style.display = 'block';
}

async function calculateContributions(e) {
    if (e) e.preventDefault();

    const contributionTypeId = document.getElementById('contribTypeId')?.value;
    const basicSalary = parseFloat(document.getElementById('contribBasic').value) || 0;
    const grossSalary = parseFloat(document.getElementById('contribGross').value) || 0;
    const calcDate = document.getElementById('contribDate')?.value;

    if (!basicSalary && !grossSalary) {
        showToast('Please enter at least basic or gross salary', 'warning');
        return;
    }

    const resultsDiv = document.getElementById('contributionResult');
    const resultGrid = document.getElementById('contribResultGrid');

    try {
        showLoading();

        const payload = {
            contribution_type_id: contributionTypeId || null,
            basic_salary: basicSalary,
            gross_salary: grossSalary,
            effective_date: calcDate || null
        };

        // Calculate contribution(s)
        const endpoint = contributionTypeId
            ? '/hrms/statutory/calculate/contribution'
            : '/hrms/statutory/calculate/all-contributions';

        const response = await api.request(endpoint, {
            method: 'POST',
            body: JSON.stringify(payload)
        });

        displayContributionResults(response, resultGrid);
        resultsDiv.style.display = 'block';
        hideLoading();
    } catch (error) {
        console.error('Error calculating contributions:', error);
        showToast(error.message || 'Failed to calculate contributions', 'error');
        hideLoading();
    }
}

function displayContributionResults(result, container) {
    if (!container) return;

    // Handle both single contribution result and array of contributions
    // Backend returns single object for specific type, or array for all types
    let contributions = [];
    let totalEmployee = 0;
    let totalEmployer = 0;
    let totalAdmin = 0;

    if (result.contributions && Array.isArray(result.contributions)) {
        // Multiple contributions from all-types endpoint
        contributions = result.contributions;
        totalEmployee = result.total_employee_contribution || 0;
        totalEmployer = result.total_employer_contribution || 0;
    } else if (result.contribution_type_id || result.contribution_type_name) {
        // Single contribution result from specific type endpoint
        contributions = [{
            type_name: result.contribution_type_name || result.contribution_type_code || 'Contribution',
            employee_contribution: result.employee_contribution || 0,
            employer_contribution: result.employer_contribution || 0,
            admin_charges: result.admin_charges || 0
        }];
        totalEmployee = result.employee_contribution || 0;
        totalEmployer = result.employer_contribution || 0;
        totalAdmin = result.admin_charges || 0;
    }

    container.innerHTML = `
        <div class="calc-results">
            <h4>Statutory Contributions</h4>
            <table class="results-table">
                <thead>
                    <tr>
                        <th>Type</th>
                        <th>Employee Share</th>
                        <th>Employer Share</th>
                        <th>Total</th>
                    </tr>
                </thead>
                <tbody>
                    ${contributions.map(contrib => `
                        <tr>
                            <td>${contrib.type_name || contrib.contribution_type_name || '-'}</td>
                            <td class="amount">${formatCurrency(contrib.employee_contribution || 0)}</td>
                            <td class="amount">${formatCurrency(contrib.employer_contribution || 0)}</td>
                            <td class="amount">${formatCurrency((contrib.employee_contribution || 0) + (contrib.employer_contribution || 0))}</td>
                        </tr>
                    `).join('')}
                    ${totalAdmin > 0 ? `
                    <tr>
                        <td>Admin Charges (EPFO)</td>
                        <td class="amount">-</td>
                        <td class="amount">${formatCurrency(totalAdmin)}</td>
                        <td class="amount">${formatCurrency(totalAdmin)}</td>
                    </tr>
                    ` : ''}
                </tbody>
                <tfoot>
                    <tr class="total">
                        <td><strong>Total</strong></td>
                        <td class="amount"><strong>${formatCurrency(totalEmployee)}</strong></td>
                        <td class="amount"><strong>${formatCurrency(totalEmployer + totalAdmin)}</strong></td>
                        <td class="amount"><strong>${formatCurrency(totalEmployee + totalEmployer + totalAdmin)}</strong></td>
                    </tr>
                </tfoot>
            </table>
            <div class="result-summary">
                <div class="summary-item">
                    <span class="label">Net Salary Impact (Employee Deductions)</span>
                    <span class="value negative">-${formatCurrency(totalEmployee)}</span>
                </div>
                <div class="summary-item">
                    <span class="label">Employer Cost Above Gross</span>
                    <span class="value">${formatCurrency(totalEmployer + totalAdmin)}</span>
                </div>
            </div>
        </div>
    `;
    container.style.display = 'block';
}

// ==================== Compliance Validation Functions ====================

function initializeComplianceValidation() {
    // Set up form handlers
    const taxValidationForm = document.getElementById('taxValidationForm');
    if (taxValidationForm) {
        taxValidationForm.addEventListener('submit', validateTaxCompliance);
    }

    const contributionValidationForm = document.getElementById('contributionValidationForm');
    if (contributionValidationForm) {
        contributionValidationForm.addEventListener('submit', validateContributionCompliance);
    }

    // Populate employee dropdowns for validation
    populateValidationDropdowns();
}

function populateValidationDropdowns() {
    // Populate employee dropdown for tax validation
    const taxEmployeeSelect = document.getElementById('taxValidationEmployeeId');
    if (taxEmployeeSelect) {
        taxEmployeeSelect.innerHTML = '<option value="">Select Employee</option>';
        employees.forEach(emp => {
            const option = document.createElement('option');
            option.value = emp.id;
            option.textContent = `${emp.first_name} ${emp.last_name || ''} (${emp.employee_code})`;
            taxEmployeeSelect.appendChild(option);
        });
    }

    // Populate employee dropdown for contribution validation
    const contribEmployeeSelect = document.getElementById('contribValidationEmployeeId');
    if (contribEmployeeSelect) {
        contribEmployeeSelect.innerHTML = '<option value="">Select Employee</option>';
        employees.forEach(emp => {
            const option = document.createElement('option');
            option.value = emp.id;
            option.textContent = `${emp.first_name} ${emp.last_name || ''} (${emp.employee_code})`;
            contribEmployeeSelect.appendChild(option);
        });
    }
}

async function validateTaxCompliance(e) {
    if (e) e.preventDefault();

    const employeeId = document.getElementById('taxValidationEmployeeId')?.value;

    if (!employeeId) {
        showToast('Please select an employee', 'warning');
        return;
    }

    const resultsDiv = document.getElementById('taxValidationResult');

    try {
        showLoading();

        const payload = {
            employee_id: employeeId
        };

        const response = await api.request('/hrms/statutory/validate/tax-compliance', {
            method: 'POST',
            body: JSON.stringify(payload)
        });

        displayTaxValidationResults(response, resultsDiv);
        resultsDiv.style.display = 'block';
        hideLoading();
    } catch (error) {
        console.error('Error validating tax compliance:', error);
        showToast(error.message || 'Failed to validate tax compliance', 'error');
        hideLoading();
    }
}

function displayTaxValidationResults(result, container) {
    if (!container) return;

    const isCompliant = result.is_compliant !== false;
    const violations = result.violations || [];
    const employeeViolations = result.employee_violations || [];

    container.innerHTML = `
        <div class="validation-results ${isCompliant ? 'compliant' : 'non-compliant'}">
            <div class="validation-header">
                <div class="validation-status ${isCompliant ? 'success' : 'error'}">
                    ${isCompliant ? `
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M22 11.08V12a10 10 0 11-5.93-9.14"></path>
                            <polyline points="22 4 12 14.01 9 11.01"></polyline>
                        </svg>
                        <span>Tax Compliance Validated</span>
                    ` : `
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <circle cx="12" cy="12" r="10"></circle>
                            <line x1="15" y1="9" x2="9" y2="15"></line>
                            <line x1="9" y1="9" x2="15" y2="15"></line>
                        </svg>
                        <span>Compliance Issues Found</span>
                    `}
                </div>
            </div>

            ${violations.length > 0 ? `
            <div class="violations-section">
                <h5>Run-Level Issues</h5>
                <ul class="violation-list">
                    ${violations.map(v => `
                        <li class="violation-item ${v.severity || 'warning'}">
                            <span class="violation-code">${v.code || 'ISSUE'}</span>
                            <span class="violation-message">${v.message}</span>
                        </li>
                    `).join('')}
                </ul>
            </div>
            ` : ''}

            ${employeeViolations.length > 0 ? `
            <div class="employee-violations-section">
                <h5>Employee-Specific Issues (${employeeViolations.length} employees)</h5>
                <div class="employee-violations-list">
                    ${employeeViolations.slice(0, 10).map(emp => `
                        <div class="employee-violation-card">
                            <div class="emp-header">
                                <span class="emp-name">${emp.employee_name || 'Unknown'}</span>
                                <span class="emp-code">${emp.employee_code || ''}</span>
                                <span class="status-badge ${emp.can_proceed ? 'warning' : 'error'}">
                                    ${emp.can_proceed ? 'Can Proceed' : 'Blocking'}
                                </span>
                            </div>
                            <ul class="emp-violations">
                                ${(emp.violations || []).map(v => `
                                    <li>${v.message}</li>
                                `).join('')}
                            </ul>
                        </div>
                    `).join('')}
                    ${employeeViolations.length > 10 ? `
                        <p class="more-violations">... and ${employeeViolations.length - 10} more employees with issues</p>
                    ` : ''}
                </div>
            </div>
            ` : ''}

            <div class="validation-summary">
                <div class="summary-stat">
                    <span class="stat-value">${result.total_employees || 0}</span>
                    <span class="stat-label">Total Employees</span>
                </div>
                <div class="summary-stat">
                    <span class="stat-value">${result.compliant_employees || 0}</span>
                    <span class="stat-label">Compliant</span>
                </div>
                <div class="summary-stat">
                    <span class="stat-value">${employeeViolations.length}</span>
                    <span class="stat-label">With Issues</span>
                </div>
            </div>
        </div>
    `;
    container.style.display = 'block';
}

async function validateContributionCompliance(e) {
    if (e) e.preventDefault();

    const employeeId = document.getElementById('contribValidationEmployeeId')?.value;

    if (!employeeId) {
        showToast('Please select an employee', 'warning');
        return;
    }

    const resultsDiv = document.getElementById('contributionValidationResult');

    try {
        showLoading();

        const payload = {
            employee_id: employeeId
        };

        const response = await api.request('/hrms/statutory/validate/contribution-compliance', {
            method: 'POST',
            body: JSON.stringify(payload)
        });

        displayContributionValidationResults(response, resultsDiv);
        resultsDiv.style.display = 'block';
        hideLoading();
    } catch (error) {
        console.error('Error validating contribution compliance:', error);
        showToast(error.message || 'Failed to validate contribution compliance', 'error');
        hideLoading();
    }
}

function displayContributionValidationResults(result, container) {
    if (!container) return;

    const isCompliant = result.is_compliant !== false;
    const violations = result.violations || [];
    const pfViolations = result.pf_violations || [];
    const esiViolations = result.esi_violations || [];

    container.innerHTML = `
        <div class="validation-results ${isCompliant ? 'compliant' : 'non-compliant'}">
            <div class="validation-header">
                <div class="validation-status ${isCompliant ? 'success' : 'error'}">
                    ${isCompliant ? `
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M22 11.08V12a10 10 0 11-5.93-9.14"></path>
                            <polyline points="22 4 12 14.01 9 11.01"></polyline>
                        </svg>
                        <span>Contribution Compliance Validated</span>
                    ` : `
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <circle cx="12" cy="12" r="10"></circle>
                            <line x1="15" y1="9" x2="9" y2="15"></line>
                            <line x1="9" y1="9" x2="15" y2="15"></line>
                        </svg>
                        <span>Compliance Issues Found</span>
                    `}
                </div>
            </div>

            ${violations.length > 0 ? `
            <div class="violations-section">
                <h5>General Issues</h5>
                <ul class="violation-list">
                    ${violations.map(v => `
                        <li class="violation-item ${v.severity || 'warning'}">
                            <span class="violation-message">${v.message}</span>
                        </li>
                    `).join('')}
                </ul>
            </div>
            ` : ''}

            <div class="contribution-breakdown">
                <div class="contribution-section">
                    <h5>PF Compliance</h5>
                    ${pfViolations.length === 0 ? `
                        <p class="compliant-message"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg> All PF contributions compliant</p>
                    ` : `
                        <ul class="violation-list">
                            ${pfViolations.map(v => `
                                <li class="violation-item">${v.employee_name}: ${v.message}</li>
                            `).join('')}
                        </ul>
                    `}
                </div>

                <div class="contribution-section">
                    <h5>ESI Compliance</h5>
                    ${esiViolations.length === 0 ? `
                        <p class="compliant-message"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg> All ESI contributions compliant</p>
                    ` : `
                        <ul class="violation-list">
                            ${esiViolations.map(v => `
                                <li class="violation-item">${v.employee_name}: ${v.message}</li>
                            `).join('')}
                        </ul>
                    `}
                </div>
            </div>

            <div class="validation-summary">
                <div class="summary-stat">
                    <span class="stat-value">${formatCurrency(result.total_pf_collected || 0)}</span>
                    <span class="stat-label">Total PF</span>
                </div>
                <div class="summary-stat">
                    <span class="stat-value">${formatCurrency(result.total_esi_collected || 0)}</span>
                    <span class="stat-label">Total ESI</span>
                </div>
                <div class="summary-stat">
                    <span class="stat-value">${result.employees_covered || 0}</span>
                    <span class="stat-label">Employees Covered</span>
                </div>
            </div>
        </div>
    `;
    container.style.display = 'block';
}

// ==================== Professional Tax Functions ====================

// PT Data stores
let ptStates = [];
let ptConfigs = [];
let ptSlabs = [];
let ptExemptions = [];
let currentPTConfigId = null;
let currentPTSlabs = [];
let currentPTExemptionId = null;

// ==================== PT States ====================

async function loadPTStates() {
    const tbody = document.getElementById('ptStatesBody');
    if (!tbody) return;

    tbody.innerHTML = '<tr><td colspan="7" class="loading-cell">Loading Indian states...</td></tr>';

    try {
        // Use summary endpoint to get has_active_config status
        const response = await api.request('/hrms/professional-tax/summary');
        // Map state_id to id for compatibility with existing code
        ptStates = (response || []).map(state => ({
            ...state,
            id: state.state_id || state.id  // Use state_id from summary endpoint
        }));
        renderPTStatesTable();
    } catch (error) {
        console.error('Error loading PT states:', error);
        tbody.innerHTML = '<tr><td colspan="7" class="error-cell">Failed to load states. Please try again.</td></tr>';
    }
}

function renderPTStatesTable() {
    const tbody = document.getElementById('ptStatesBody');
    const searchInput = document.getElementById('ptStateSearch');
    const filterSelect = document.getElementById('ptStateFilter');

    if (!tbody) return;

    const searchTerm = (searchInput?.value || '').toLowerCase();
    const filter = filterSelect?.value || 'all';

    let filteredStates = ptStates.filter(state => {
        const matchesSearch = !searchTerm ||
            state.state_name?.toLowerCase().includes(searchTerm) ||
            state.state_code?.toLowerCase().includes(searchTerm);

        let matchesFilter = true;
        if (filter === 'has_pt') matchesFilter = state.has_professional_tax;
        else if (filter === 'no_pt') matchesFilter = !state.has_professional_tax;
        else if (filter === 'configured') matchesFilter = state.has_professional_tax && state.has_active_config;
        else if (filter === 'not_configured') matchesFilter = state.has_professional_tax && !state.has_active_config;

        return matchesSearch && matchesFilter;
    });

    if (filteredStates.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="empty-cell">No states found matching your criteria</td></tr>';
        return;
    }

    tbody.innerHTML = filteredStates.map(state => `
        <tr>
            <td><strong>${state.state_code || '-'}</strong></td>
            <td>${state.state_name || '-'}</td>
            <td>
                <span class="badge badge-${state.is_union_territory ? 'secondary' : 'primary'}">
                    ${state.is_union_territory ? 'UT' : 'State'}
                </span>
            </td>
            <td>
                ${state.has_professional_tax
                    ? '<span class="status-badge status-active">Yes</span>'
                    : '<span class="status-badge status-inactive">No</span>'}
            </td>
            <td>
                ${state.has_professional_tax
                    ? (state.has_active_config
                        ? '<span class="status-badge status-success">Configured</span>'
                        : '<span class="status-badge status-warning">Not Configured</span>')
                    : '<span class="status-badge status-muted">N/A</span>'}
            </td>
            <td>${state.max_annual_amount ? formatCurrency(state.max_annual_amount) : '₹2,500'}</td>
            <td class="actions-cell">
                <button class="btn btn-sm btn-outline" onclick="showEditStateModal('${state.id}')" title="Edit State">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                    </svg>
                </button>
                ${state.has_professional_tax && !state.has_active_config
                    ? `<button class="btn btn-sm btn-primary" onclick="showCreatePTConfigModalForState('${state.id}', '${state.state_name}')">Configure</button>`
                    : state.has_active_config
                        ? `<button class="btn btn-sm btn-secondary" onclick="viewPTConfig('${state.id}')">View Config</button>`
                        : ''}
                <button class="btn btn-sm btn-danger" onclick="deleteIndianState('${state.id}')" title="Delete State">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="3 6 5 6 21 6"></polyline>
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                    </svg>
                </button>
            </td>
        </tr>
    `).join('');
}

// Setup PT state filters
document.addEventListener('DOMContentLoaded', function() {
    const searchInput = document.getElementById('ptStateSearch');
    const filterSelect = document.getElementById('ptStateFilter');

    if (searchInput) {
        searchInput.addEventListener('input', debounce(renderPTStatesTable, 300));
    }
    if (filterSelect) {
        filterSelect.addEventListener('change', renderPTStatesTable);
    }
});

// ==================== Indian State Modal ====================

let currentStateId = null;

function showCreateStateModal() {
    currentStateId = null;
    document.getElementById('indianStateModalTitle').textContent = 'Add Indian State';

    // Reset form
    const form = document.getElementById('indianStateForm');
    form.reset();

    // Set defaults
    document.getElementById('stateHasPT').checked = true;
    document.getElementById('stateIsUT').checked = false;
    document.getElementById('stateDisplayOrder').value = ptStates.length + 1;

    // Set default effective date to today
    const today = new Date().toISOString().split('T')[0];
    document.getElementById('stateEffectiveFrom').value = today;

    openModal('indianStateModal');
}

function showEditStateModal(stateId) {
    currentStateId = stateId;
    const state = ptStates.find(s => s.id === stateId);
    if (!state) {
        showToast('State not found', 'error');
        return;
    }

    document.getElementById('indianStateModalTitle').textContent = 'Edit Indian State';

    // Populate form
    document.getElementById('stateCode').value = state.state_code || '';
    document.getElementById('stateName').value = state.state_name || '';
    document.getElementById('stateNameLocal').value = state.state_name_local || '';
    document.getElementById('stateIsUT').checked = state.is_union_territory || false;
    document.getElementById('stateHasPT').checked = state.has_professional_tax !== false;
    document.getElementById('stateHasLWF').checked = state.has_lwf || false;
    document.getElementById('statePTRegBody').value = state.pt_regulatory_body || '';
    document.getElementById('statePTRegWebsite').value = state.pt_regulatory_website || '';
    document.getElementById('stateLWFRegBody').value = state.lwf_regulatory_body || '';
    document.getElementById('stateLWFRegWebsite').value = state.lwf_regulatory_website || '';
    document.getElementById('stateDisplayOrder').value = state.display_order || 1;
    document.getElementById('stateEffectiveFrom').value = state.effective_from ? state.effective_from.split('T')[0] : '';
    document.getElementById('stateNotes').value = state.notes || '';

    openModal('indianStateModal');
}

function closeIndianStateModal() {
    closeModal('indianStateModal');
    currentStateId = null;
}

async function saveIndianState(event) {
    event.preventDefault();

    const saveBtn = document.getElementById('saveIndianStateBtn');
    const originalText = saveBtn.textContent;

    // Disable button and show loading state
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';

    try {
        const stateCode = document.getElementById('stateCode').value.toUpperCase().trim();
        const stateName = document.getElementById('stateName').value.trim();

        if (!stateCode || !stateName) {
            showToast('State code and name are required', 'error');
            return;
        }

        if (stateCode.length > 3) {
            showToast('State code must be 1-3 characters', 'error');
            return;
        }

        const data = {
            state_code: stateCode,
            state_name: stateName,
            state_name_local: document.getElementById('stateNameLocal').value.trim() || null,
            is_union_territory: document.getElementById('stateIsUT').checked,
            has_professional_tax: document.getElementById('stateHasPT').checked,
            has_lwf: document.getElementById('stateHasLWF').checked,
            pt_regulatory_body: document.getElementById('statePTRegBody').value.trim() || null,
            pt_regulatory_website: document.getElementById('statePTRegWebsite').value.trim() || null,
            lwf_regulatory_body: document.getElementById('stateLWFRegBody').value.trim() || null,
            lwf_regulatory_website: document.getElementById('stateLWFRegWebsite').value.trim() || null,
            display_order: parseInt(document.getElementById('stateDisplayOrder').value) || 1,
            effective_from: document.getElementById('stateEffectiveFrom').value || new Date().toISOString().split('T')[0],
            notes: document.getElementById('stateNotes').value.trim() || null
        };

        if (currentStateId) {
            // Update existing state
            data.id = currentStateId;
            await api.request(`/hrms/professional-tax/states/${currentStateId}`, {
                method: 'PUT',
                body: JSON.stringify(data)
            });
            showToast('State updated successfully', 'success');
        } else {
            // Create new state
            const response = await api.request('/hrms/professional-tax/states', {
                method: 'POST',
                body: JSON.stringify(data)
            });
            if (!response || !response.id) {
                throw new Error('Failed to create state - no response from server');
            }
            showToast('State created successfully', 'success');
        }

        closeIndianStateModal();
        await loadPTStates();

        // Refresh PT state dropdowns so new state appears in PT Config modal
        await populatePTStateDropdowns();

    } catch (error) {
        console.error('Error saving state:', error);
        showToast(error.message || 'Failed to save state', 'error');
    } finally {
        // Re-enable button
        saveBtn.disabled = false;
        saveBtn.textContent = originalText;
    }
}

async function deleteIndianState(stateId) {
    const state = ptStates.find(s => s.id === stateId);
    if (!state) return;

    if (!confirm(`Are you sure you want to delete "${state.state_name}"? This action cannot be undone.`)) {
        return;
    }

    try {
        await api.request(`/hrms/professional-tax/states/${stateId}`, 'DELETE');
        showToast('State deleted successfully', 'success');
        await loadPTStates();
        await populatePTStateDropdowns();
    } catch (error) {
        console.error('Error deleting state:', error);
        showToast(error.message || 'Failed to delete state', 'error');
    }
}

// ==================== PT Configurations ====================

async function loadPTConfigs() {
    const grid = document.getElementById('ptConfigsGrid');
    if (!grid) return;

    grid.innerHTML = '<div class="loading-cell">Loading PT configurations...</div>';

    try {
        const response = await api.request('/hrms/professional-tax/configs');
        ptConfigs = response || [];
        await populatePTStateDropdowns();
        renderPTConfigsGrid();
    } catch (error) {
        console.error('Error loading PT configs:', error);
        grid.innerHTML = '<div class="error-cell">Failed to load configurations. Please try again.</div>';
    }
}

async function populatePTStateDropdowns() {
    // Populate state dropdowns in various places
    const selectIds = [
        'ptConfigStateFilter',
        'ptSlabStateSelect',
        'ptExemptionStateFilter',
        'ptCalcState',
        'ptConfigState'
    ];

    // Get states with PT if not loaded
    if (ptStates.length === 0) {
        try {
            // Use summary endpoint to get has_active_config status
            const response = await api.request('/hrms/professional-tax/summary');
            // Map state_id to id for compatibility with existing code
            ptStates = (response || []).map(state => ({
                ...state,
                id: state.state_id || state.id
            }));
        } catch (e) {
            console.error('Error loading states:', e);
        }
    }

    const statesWithPT = ptStates.filter(s => s.has_professional_tax);

    // Create options array for searchable dropdowns
    const stateOptions = statesWithPT.map(state => ({
        value: state.id,
        label: `${state.state_name} (${state.state_code})`
    }));

    selectIds.forEach(selectId => {
        const select = document.getElementById(selectId);
        if (!select) return;

        const currentValue = select.value;
        const isFilter = selectId.includes('Filter');

        // Update native select
        select.innerHTML = isFilter
            ? '<option value="">All States</option>'
            : '<option value="">-- Select State --</option>';

        statesWithPT.forEach(state => {
            select.innerHTML += `<option value="${state.id}">${state.state_name} (${state.state_code})</option>`;
        });

        if (currentValue) select.value = currentValue;

        // Also update searchable dropdown component if it exists
        updateSearchableDropdownOptions(selectId, stateOptions, currentValue || null);
    });
}

function renderPTConfigsGrid() {
    const grid = document.getElementById('ptConfigsGrid');
    const stateFilter = document.getElementById('ptConfigStateFilter')?.value || '';
    const typeFilter = document.getElementById('ptConfigTypeFilter')?.value || '';
    const showInactive = document.getElementById('ptConfigShowInactive')?.checked || false;

    if (!grid) return;

    let filteredConfigs = ptConfigs.filter(config => {
        if (stateFilter && config.state_id !== stateFilter) return false;
        if (typeFilter && config.calculation_type !== typeFilter) return false;
        if (!showInactive && !config.is_active) return false;
        return true;
    });

    if (filteredConfigs.length === 0) {
        grid.innerHTML = `
            <div class="empty-state">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                    <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path>
                </svg>
                <p>No PT configurations found</p>
                <button class="btn btn-primary" onclick="showCreatePTConfigModal()">Add Configuration</button>
            </div>
        `;
        return;
    }

    grid.innerHTML = filteredConfigs.map(config => {
        const state = ptStates.find(s => s.id === config.state_id);
        return `
            <div class="pt-config-card ${!config.is_active ? 'inactive' : ''}">
                <div class="config-card-header">
                    <div class="config-state">
                        <strong>${state?.state_name || 'Unknown State'}</strong>
                        <span class="state-code">${state?.state_code || ''}</span>
                    </div>
                    <span class="badge badge-${config.calculation_type === 'slab' ? 'primary' : 'secondary'}">
                        ${config.calculation_type === 'slab' ? 'Slab-based' : 'Fixed'}
                    </span>
                </div>
                <div class="config-card-body">
                    <div class="config-info-row">
                        <span>Financial Year:</span>
                        <strong>${config.financial_year || 'All Years'}</strong>
                    </div>
                    <div class="config-info-row">
                        <span>Effective From:</span>
                        <strong>${config.effective_from ? new Date(config.effective_from).toLocaleDateString() : '-'}</strong>
                    </div>
                    ${config.calculation_type === 'fixed' ? `
                        <div class="config-info-row">
                            <span>Fixed Amount:</span>
                            <strong>${formatCurrency(config.fixed_amount || 0)}</strong>
                        </div>
                    ` : `
                        <div class="config-info-row">
                            <span>Slabs:</span>
                            <strong>${config.slab_count || 0} slabs configured</strong>
                        </div>
                    `}
                    ${config.special_month ? `
                        <div class="config-info-row special-month">
                            <span>Special Month:</span>
                            <strong>${getMonthName(config.special_month)} - ${formatCurrency(config.special_month_amount || 0)}</strong>
                        </div>
                    ` : ''}
                    ${config.exemption_threshold ? `
                        <div class="config-info-row">
                            <span>Exemption Below:</span>
                            <strong>${formatCurrency(config.exemption_threshold)}</strong>
                        </div>
                    ` : ''}
                </div>
                <div class="config-card-footer">
                    <span class="status-badge ${config.is_active ? 'status-active' : 'status-inactive'}">
                        ${config.is_active ? 'Active' : 'Inactive'}
                    </span>
                    <div class="config-actions">
                        ${config.calculation_type === 'slab' ? `
                            <button class="btn btn-sm btn-secondary" onclick="viewPTSlabs('${config.id}')">
                                View Slabs
                            </button>
                        ` : ''}
                        <button class="btn btn-sm btn-ghost" onclick="editPTConfig('${config.id}')">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                            </svg>
                        </button>
                        <button class="btn btn-sm btn-ghost btn-danger" onclick="deletePTConfig('${config.id}')">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <polyline points="3 6 5 6 21 6"></polyline>
                                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                            </svg>
                        </button>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

function getMonthName(monthNum) {
    const months = ['', 'January', 'February', 'March', 'April', 'May', 'June',
                    'July', 'August', 'September', 'October', 'November', 'December'];
    return months[monthNum] || '';
}

// Setup PT config filters
document.addEventListener('DOMContentLoaded', function() {
    const stateFilter = document.getElementById('ptConfigStateFilter');
    const typeFilter = document.getElementById('ptConfigTypeFilter');
    const showInactive = document.getElementById('ptConfigShowInactive');

    if (stateFilter) stateFilter.addEventListener('change', renderPTConfigsGrid);
    if (typeFilter) typeFilter.addEventListener('change', renderPTConfigsGrid);
    if (showInactive) showInactive.addEventListener('change', renderPTConfigsGrid);
});

// ==================== PT Config Modal ====================

function showCreatePTConfigModal() {
    currentPTConfigId = null;
    document.getElementById('ptConfigModalTitle').textContent = 'Add PT Configuration';

    // Reset form
    const form = document.getElementById('ptConfigForm');
    if (form) form.reset();

    // Set default values
    document.getElementById('ptConfigCalcType').value = 'slab';
    document.getElementById('ptConfigIsActive').checked = true;
    togglePTConfigCalcType();

    openModal('ptConfigModal');
}

async function showCreatePTConfigModalForState(stateId, stateName) {
    // First populate the state dropdown
    await populatePTStateDropdowns();

    // Then show the modal
    showCreatePTConfigModal();

    // Now set the state value (dropdown is populated)
    document.getElementById('ptConfigState').value = stateId;
}

function togglePTConfigCalcType() {
    const calcType = document.getElementById('ptConfigCalcType').value;
    const fixedSection = document.getElementById('ptConfigFixedSection');
    const slabNote = document.getElementById('ptConfigSlabNote');

    if (fixedSection) fixedSection.style.display = calcType === 'fixed' ? 'block' : 'none';
    if (slabNote) slabNote.style.display = calcType === 'slab' ? 'block' : 'none';
}

async function savePTConfig() {
    const form = document.getElementById('ptConfigForm');
    if (!form.checkValidity()) {
        form.reportValidity();
        return;
    }

    const payload = {
        state_id: document.getElementById('ptConfigState').value,
        config_name: document.getElementById('ptConfigName').value,
        calculation_type: document.getElementById('ptConfigCalcType').value,
        financial_year: document.getElementById('ptConfigFY').value || null,
        effective_from: document.getElementById('ptConfigEffectiveFrom').value,
        effective_to: document.getElementById('ptConfigEffectiveTo').value || null,
        fixed_amount: document.getElementById('ptConfigFixedAmount')?.value !== '' ? parseFloat(document.getElementById('ptConfigFixedAmount').value) : null,
        exemption_threshold: parseFloat(document.getElementById('ptConfigExemptionThreshold')?.value) || null,
        special_month: parseInt(document.getElementById('ptConfigSpecialMonth')?.value) || null,
        special_month_amount: parseFloat(document.getElementById('ptConfigSpecialMonthAmount')?.value) || null,
        applies_to_gender: document.getElementById('ptConfigGender')?.value || null,
        min_age: parseInt(document.getElementById('ptConfigMinAge')?.value) || null,
        max_age: parseInt(document.getElementById('ptConfigMaxAge')?.value) || null,
        is_active: document.getElementById('ptConfigIsActive').checked
    };

    try {
        showLoading();

        if (currentPTConfigId) {
            await api.request(`/hrms/professional-tax/configs/${currentPTConfigId}`, {
                method: 'PUT',
                body: JSON.stringify(payload)
            });
            showToast('PT configuration updated successfully', 'success');
        } else {
            await api.request('/hrms/professional-tax/configs', {
                method: 'POST',
                body: JSON.stringify(payload)
            });
            showToast('PT configuration created successfully', 'success');
        }

        closePTConfigModal();
        await loadPTConfigs();
        hideLoading();
    } catch (error) {
        console.error('Error saving PT config:', error);
        showToast(error.message || 'Failed to save PT configuration', 'error');
        hideLoading();
    }
}

async function editPTConfig(configId) {
    currentPTConfigId = configId;
    const config = ptConfigs.find(c => c.id === configId);
    if (!config) {
        showToast('Configuration not found', 'error');
        return;
    }

    document.getElementById('ptConfigModalTitle').textContent = 'Edit PT Configuration';
    document.getElementById('ptConfigState').value = config.state_id || '';
    document.getElementById('ptConfigCalcType').value = config.calculation_type || 'slab';
    document.getElementById('ptConfigName').value = config.config_name || '';
    document.getElementById('ptConfigFY').value = config.financial_year || '';
    document.getElementById('ptConfigEffectiveFrom').value = config.effective_from?.split('T')[0] || '';
    document.getElementById('ptConfigEffectiveTo').value = config.effective_to?.split('T')[0] || '';
    document.getElementById('ptConfigFixedAmount').value = config.fixed_amount ?? '';
    document.getElementById('ptConfigExemptionThreshold').value = config.exemption_threshold ?? '';
    document.getElementById('ptConfigSpecialMonth').value = config.special_month ?? '';
    document.getElementById('ptConfigSpecialMonthAmount').value = config.special_month_amount ?? '';
    document.getElementById('ptConfigGender').value = config.applies_to_gender || '';
    document.getElementById('ptConfigMinAge').value = config.min_age ?? '';
    document.getElementById('ptConfigMaxAge').value = config.max_age ?? '';
    document.getElementById('ptConfigIsActive').checked = config.is_active !== false;

    togglePTConfigCalcType();
    openModal('ptConfigModal');
}

async function deletePTConfig(configId) {
    if (!confirm('Are you sure you want to delete this PT configuration? This action cannot be undone.')) {
        return;
    }

    try {
        showLoading();
        await api.request(`/hrms/professional-tax/configs/${configId}`, {
            method: 'DELETE'
        });
        showToast('PT configuration deleted successfully', 'success');
        await loadPTConfigs();
        hideLoading();
    } catch (error) {
        console.error('Error deleting PT config:', error);
        showToast(error.message || 'Failed to delete PT configuration', 'error');
        hideLoading();
    }
}

function closePTConfigModal() {
    closeModal('ptConfigModal');
    currentPTConfigId = null;
}

// ==================== PT Slabs ====================

async function initializePTSlabs() {
    await populatePTStateDropdowns();

    const stateSelect = document.getElementById('ptSlabStateSelect');
    const configSelect = document.getElementById('ptSlabConfigSelect');
    const addSlabBtn = document.getElementById('addSlabBtn');

    if (stateSelect) {
        stateSelect.addEventListener('change', async () => {
            const stateId = stateSelect.value;
            configSelect.disabled = !stateId;
            addSlabBtn.disabled = true;

            if (stateId) {
                await loadConfigsForState(stateId);
            } else {
                configSelect.innerHTML = '<option value="">-- Select Configuration --</option>';
                document.getElementById('ptSlabsContainer').innerHTML = `
                    <div class="empty-state">
                        <p>Select a state and configuration to view PT slabs</p>
                    </div>
                `;
            }
        });
    }

    if (configSelect) {
        configSelect.addEventListener('change', async () => {
            const configId = configSelect.value;
            addSlabBtn.disabled = !configId;

            if (configId) {
                await loadPTSlabsForConfig(configId);
            }
        });
    }
}

async function loadConfigsForState(stateId) {
    const selectId = 'ptSlabConfigSelect';
    const configSelect = document.getElementById(selectId);
    if (!configSelect) return;

    try {
        const configs = ptConfigs.filter(c => c.state_id === stateId && c.calculation_type === 'slab');

        configSelect.innerHTML = '<option value="">-- Select Configuration --</option>';
        configs.forEach(config => {
            configSelect.innerHTML += `<option value="${config.id}">${config.financial_year || 'All Years'} - ${config.effective_from ? new Date(config.effective_from).toLocaleDateString() : 'No Date'}</option>`;
        });

        // Also update searchable dropdown component if it exists
        const configOptions = configs.map(config => ({
            value: config.id,
            label: `${config.financial_year || 'All Years'} - ${config.effective_from ? new Date(config.effective_from).toLocaleDateString() : 'No Date'}`
        }));
        updateSearchableDropdownOptions(selectId, configOptions);

        if (configs.length === 0) {
            document.getElementById('ptSlabsContainer').innerHTML = `
                <div class="empty-state">
                    <p>No slab-based configurations found for this state</p>
                    <button class="btn btn-primary" onclick="showCreatePTConfigModalForState('${stateId}')">Add Configuration</button>
                </div>
            `;
        }
    } catch (error) {
        console.error('Error loading configs for state:', error);
    }
}

async function loadPTSlabsForConfig(configId) {
    currentPTConfigId = configId;
    const container = document.getElementById('ptSlabsContainer');
    if (!container) return;

    container.innerHTML = '<div class="loading-cell">Loading slabs...</div>';

    try {
        const response = await api.request(`/hrms/professional-tax/configs/${configId}/slabs`);
        currentPTSlabs = response || [];
        renderPTSlabsTable();
    } catch (error) {
        console.error('Error loading PT slabs:', error);
        container.innerHTML = '<div class="error-cell">Failed to load slabs. Please try again.</div>';
    }
}

function renderPTSlabsTable() {
    const container = document.getElementById('ptSlabsContainer');
    if (!container) return;

    if (currentPTSlabs.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <p>No slabs configured yet</p>
                <button class="btn btn-primary" onclick="showAddPTSlabModal()">Add First Slab</button>
            </div>
        `;
        return;
    }

    container.innerHTML = `
        <div class="data-table-container">
            <table class="data-table" id="ptSlabsTable">
                <thead>
                    <tr>
                        <th style="width: 60px;">Order</th>
                        <th>Salary From</th>
                        <th>Salary To</th>
                        <th>Tax Amount</th>
                        <th>Type</th>
                        <th style="width: 100px;">Actions</th>
                    </tr>
                </thead>
                <tbody>
                    ${currentPTSlabs.map((slab, index) => `
                        <tr data-slab-id="${slab.id || ''}" data-index="${index}">
                            <td>
                                <input type="number" class="form-control form-control-sm" value="${slab.slab_order || index + 1}"
                                    onchange="updatePTSlabField(${index}, 'slab_order', this.value)" style="width: 50px;">
                            </td>
                            <td>
                                <input type="number" class="form-control form-control-sm" value="${slab.salary_from || 0}"
                                    onchange="updatePTSlabField(${index}, 'salary_from', this.value)" placeholder="0">
                            </td>
                            <td>
                                <input type="number" class="form-control form-control-sm" value="${slab.salary_to || ''}"
                                    onchange="updatePTSlabField(${index}, 'salary_to', this.value)" placeholder="No limit">
                            </td>
                            <td>
                                <input type="number" class="form-control form-control-sm" value="${slab.tax_amount || 0}" step="1"
                                    onchange="updatePTSlabField(${index}, 'tax_amount', this.value)" placeholder="0">
                            </td>
                            <td>
                                <select class="form-control form-control-sm" onchange="updatePTSlabField(${index}, 'is_percentage', this.value === 'true')">
                                    <option value="false" ${!slab.is_percentage ? 'selected' : ''}>Fixed ₹</option>
                                    <option value="true" ${slab.is_percentage ? 'selected' : ''}>Percentage %</option>
                                </select>
                            </td>
                            <td>
                                <button class="btn btn-sm btn-ghost btn-danger" onclick="removePTSlabRow(${index})">
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                        <line x1="18" y1="6" x2="6" y2="18"></line>
                                        <line x1="6" y1="6" x2="18" y2="18"></line>
                                    </svg>
                                </button>
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
        <div class="form-actions" style="margin-top: 16px;">
            <button type="button" class="btn btn-secondary" onclick="addPTSlabRow()">
                <span class="btn-icon">+</span> Add Slab
            </button>
            <button type="button" class="btn btn-primary" onclick="saveAllPTSlabs()">
                Save All Slabs
            </button>
        </div>
    `;
}

function addPTSlabRow() {
    const newOrder = currentPTSlabs.length + 1;
    const lastSlab = currentPTSlabs[currentPTSlabs.length - 1];
    const newFrom = lastSlab ? (lastSlab.salary_to || 0) + 1 : 0;

    currentPTSlabs.push({
        slab_order: newOrder,
        salary_from: newFrom,
        salary_to: null,
        tax_amount: 0,
        is_percentage: false,
        is_new: true
    });
    renderPTSlabsTable();
}

function updatePTSlabField(index, field, value) {
    if (currentPTSlabs[index]) {
        if (field === 'salary_to' && value === '') {
            currentPTSlabs[index][field] = null;
        } else if (['salary_from', 'salary_to', 'tax_amount', 'slab_order'].includes(field)) {
            currentPTSlabs[index][field] = value ? parseFloat(value) : null;
        } else if (field === 'is_percentage') {
            currentPTSlabs[index][field] = value;
        } else {
            currentPTSlabs[index][field] = value;
        }
        currentPTSlabs[index].modified = true;
    }
}

function removePTSlabRow(index) {
    const slab = currentPTSlabs[index];
    if (slab.id && !slab.is_new) {
        slab.deleted = true;
    } else {
        currentPTSlabs.splice(index, 1);
    }
    renderPTSlabsTable();
}

async function saveAllPTSlabs() {
    if (!currentPTConfigId) {
        showToast('No configuration selected', 'error');
        return;
    }

    try {
        showLoading();

        // Process each slab
        for (const slab of currentPTSlabs) {
            if (slab.deleted && slab.id) {
                await api.request(`/hrms/professional-tax/slabs/${slab.id}`, {
                    method: 'DELETE'
                });
            } else if (slab.is_new) {
                await api.request(`/hrms/professional-tax/configs/${currentPTConfigId}/slabs`, {
                    method: 'POST',
                    body: JSON.stringify({
                        slab_order: slab.slab_order,
                        salary_from: slab.salary_from || 0,
                        salary_to: slab.salary_to,
                        tax_amount: slab.tax_amount || 0,
                        is_percentage: slab.is_percentage || false
                    })
                });
            } else if (slab.modified && slab.id) {
                await api.request(`/hrms/professional-tax/slabs/${slab.id}`, {
                    method: 'PUT',
                    body: JSON.stringify({
                        id: slab.id,  // Backend requires id in body to match URL
                        slab_order: slab.slab_order,
                        salary_from: slab.salary_from || 0,
                        salary_to: slab.salary_to,
                        tax_amount: slab.tax_amount || 0,
                        is_percentage: slab.is_percentage || false
                    })
                });
            }
        }

        showToast('PT slabs saved successfully', 'success');
        await loadPTSlabsForConfig(currentPTConfigId);
        hideLoading();
    } catch (error) {
        console.error('Error saving PT slabs:', error);
        showToast(error.message || 'Failed to save PT slabs', 'error');
        hideLoading();
    }
}

function viewPTSlabs(configId) {
    // Switch to PT Slabs tab and select the config
    const tabBtn = document.querySelector('[data-tab="pt-slabs"]');
    if (tabBtn) {
        tabBtn.click();

        // After tab loads, select the config
        setTimeout(async () => {
            const config = ptConfigs.find(c => c.id === configId);
            if (config) {
                document.getElementById('ptSlabStateSelect').value = config.state_id;
                await loadConfigsForState(config.state_id);
                document.getElementById('ptSlabConfigSelect').value = configId;
                document.getElementById('ptSlabConfigSelect').disabled = false;
                document.getElementById('addSlabBtn').disabled = false;
                await loadPTSlabsForConfig(configId);
            }
        }, 100);
    }
}

function viewPTConfig(stateId) {
    // Switch to PT Configurations tab and filter by state
    const tabBtn = document.querySelector('[data-tab="pt-configs"]');
    if (tabBtn) {
        tabBtn.click();

        // After tab loads, filter by state
        setTimeout(() => {
            const stateFilter = document.getElementById('ptConfigStateFilter');
            if (stateFilter) {
                stateFilter.value = stateId;
                renderPTConfigsGrid();
            }
        }, 100);
    }
}

// ==================== PT Exemptions ====================

async function loadPTExemptions() {
    const tbody = document.getElementById('ptExemptionsBody');
    if (!tbody) return;

    tbody.innerHTML = '<tr><td colspan="8" class="loading-cell">Loading exemption rules...</td></tr>';

    try {
        await populatePTStateDropdowns();
        const response = await api.request('/hrms/professional-tax/exemptions');
        ptExemptions = response || [];
        renderPTExemptionsTable();
    } catch (error) {
        console.error('Error loading PT exemptions:', error);
        tbody.innerHTML = '<tr><td colspan="8" class="error-cell">Failed to load exemptions. Please try again.</td></tr>';
    }
}

function renderPTExemptionsTable() {
    const tbody = document.getElementById('ptExemptionsBody');
    const stateFilter = document.getElementById('ptExemptionStateFilter')?.value || '';
    const typeFilter = document.getElementById('ptExemptionTypeFilter')?.value || '';

    if (!tbody) return;

    let filtered = ptExemptions.filter(ex => {
        if (stateFilter && ex.state_id !== stateFilter) return false;
        if (typeFilter && ex.exemption_type !== typeFilter) return false;
        return true;
    });

    if (filtered.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" class="empty-cell">No exemption rules found</td></tr>';
        return;
    }

    tbody.innerHTML = filtered.map(exemption => {
        const state = ptStates.find(s => s.id === exemption.state_id);
        const criteria = buildExemptionCriteria(exemption);

        return `
            <tr>
                <td>${state?.state_name || 'All States'}</td>
                <td><code>${exemption.exemption_code || '-'}</code></td>
                <td>${exemption.exemption_name || '-'}</td>
                <td>
                    <span class="badge badge-${getExemptionTypeBadge(exemption.exemption_type)}">
                        ${formatExemptionType(exemption.exemption_type)}
                    </span>
                </td>
                <td>${criteria}</td>
                <td>${exemption.requires_document ? 'Yes' : 'No'}</td>
                <td>
                    <span class="status-badge ${exemption.is_active ? 'status-active' : 'status-inactive'}">
                        ${exemption.is_active ? 'Active' : 'Inactive'}
                    </span>
                </td>
                <td>
                    <button class="btn btn-sm btn-ghost" onclick="editPTExemption('${exemption.id}')">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                        </svg>
                    </button>
                    <button class="btn btn-sm btn-ghost btn-danger" onclick="deletePTExemption('${exemption.id}')">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="3 6 5 6 21 6"></polyline>
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                        </svg>
                    </button>
                </td>
            </tr>
        `;
    }).join('');
}

function buildExemptionCriteria(exemption) {
    const parts = [];
    if (exemption.applicable_gender) parts.push(`Gender: ${exemption.applicable_gender}`);
    if (exemption.min_age || exemption.max_age) {
        parts.push(`Age: ${exemption.min_age || 0} - ${exemption.max_age || '∞'}`);
    }
    if (exemption.disability_percentage) {
        parts.push(`Disability: ≥${exemption.disability_percentage}%`);
    }
    if (exemption.income_threshold) {
        parts.push(`Income: ≤${formatCurrency(exemption.income_threshold)}`);
    }
    if (exemption.category_name) {
        parts.push(`Category: ${exemption.category_name}`);
    }
    return parts.length > 0 ? parts.join('<br>') : '-';
}

function formatExemptionType(type) {
    const types = {
        'gender': 'Gender',
        'age': 'Age/Senior',
        'disability': 'Disability',
        'income': 'Income',
        'category': 'Category'
    };
    return types[type] || type;
}

function getExemptionTypeBadge(type) {
    const badges = {
        'gender': 'info',
        'age': 'warning',
        'disability': 'primary',
        'income': 'success',
        'category': 'secondary'
    };
    return badges[type] || 'secondary';
}

// Setup PT exemption filters
document.addEventListener('DOMContentLoaded', function() {
    const stateFilter = document.getElementById('ptExemptionStateFilter');
    const typeFilter = document.getElementById('ptExemptionTypeFilter');

    if (stateFilter) stateFilter.addEventListener('change', renderPTExemptionsTable);
    if (typeFilter) typeFilter.addEventListener('change', renderPTExemptionsTable);
});

function showCreatePTExemptionModal() {
    currentPTExemptionId = null;
    document.getElementById('ptExemptionModalTitle').textContent = 'Add Exemption Rule';
    const form = document.getElementById('ptExemptionForm');
    if (form) form.reset();
    openModal('ptExemptionModal');
}

async function editPTExemption(exemptionId) {
    const exemption = ptExemptions.find(e => e.id === exemptionId);
    if (!exemption) {
        showToast('Exemption not found', 'error');
        return;
    }

    currentPTExemptionId = exemptionId;
    document.getElementById('ptExemptionModalTitle').textContent = 'Edit Exemption Rule';

    // Populate form fields with nullish coalescing to handle 0 values
    document.getElementById('ptExemptionState').value = exemption.state_id || '';
    document.getElementById('ptExemptionCode').value = exemption.exemption_code || '';
    document.getElementById('ptExemptionName').value = exemption.exemption_name || '';
    document.getElementById('ptExemptionType').value = exemption.exemption_type || '';
    document.getElementById('ptExemptionGender').value = exemption.applicable_gender || '';
    document.getElementById('ptExemptionMinAge').value = exemption.min_age ?? '';
    document.getElementById('ptExemptionMaxAge').value = exemption.max_age ?? '';
    document.getElementById('ptExemptionDisabilityPct').value = exemption.disability_percentage ?? '';
    document.getElementById('ptExemptionIncomeThreshold').value = exemption.income_threshold ?? '';
    document.getElementById('ptExemptionCategory').value = exemption.category_name || '';
    document.getElementById('ptExemptionRequiresDoc').checked = exemption.requires_document || false;
    document.getElementById('ptExemptionIsActive').checked = exemption.is_active !== false;

    openModal('ptExemptionModal');
}

async function savePTExemption() {
    const form = document.getElementById('ptExemptionForm');
    if (!form.checkValidity()) {
        form.reportValidity();
        return;
    }

    const payload = {
        state_id: document.getElementById('ptExemptionState')?.value || null,
        exemption_code: document.getElementById('ptExemptionCode').value,
        exemption_name: document.getElementById('ptExemptionName').value,
        exemption_type: document.getElementById('ptExemptionType').value,
        applicable_gender: document.getElementById('ptExemptionGender')?.value || null,
        min_age: document.getElementById('ptExemptionMinAge')?.value !== '' ? parseInt(document.getElementById('ptExemptionMinAge').value) : null,
        max_age: document.getElementById('ptExemptionMaxAge')?.value !== '' ? parseInt(document.getElementById('ptExemptionMaxAge').value) : null,
        disability_percentage: document.getElementById('ptExemptionDisabilityPct')?.value !== '' ? parseFloat(document.getElementById('ptExemptionDisabilityPct').value) : null,
        income_threshold: document.getElementById('ptExemptionIncomeThreshold')?.value !== '' ? parseFloat(document.getElementById('ptExemptionIncomeThreshold').value) : null,
        category_name: document.getElementById('ptExemptionCategory')?.value || null,
        requires_document: document.getElementById('ptExemptionRequiresDoc')?.checked || false,
        is_active: document.getElementById('ptExemptionIsActive')?.checked !== false
    };

    try {
        showLoading();

        if (currentPTExemptionId) {
            // Update existing exemption
            await api.request(`/hrms/professional-tax/exemptions/${currentPTExemptionId}`, {
                method: 'PUT',
                body: JSON.stringify(payload)
            });
            showToast('Exemption rule updated successfully', 'success');
        } else {
            // Create new exemption
            await api.request('/hrms/professional-tax/exemptions', {
                method: 'POST',
                body: JSON.stringify(payload)
            });
            showToast('Exemption rule created successfully', 'success');
        }

        closeModal('ptExemptionModal');
        await loadPTExemptions();
        hideLoading();
    } catch (error) {
        console.error('Error saving exemption:', error);
        showToast(error.message || 'Failed to save exemption rule', 'error');
        hideLoading();
    }
}

async function deletePTExemption(exemptionId) {
    if (!confirm('Are you sure you want to delete this exemption rule?')) return;

    try {
        showLoading();
        await api.request(`/hrms/professional-tax/exemptions/${exemptionId}`, {
            method: 'DELETE'
        });
        showToast('Exemption rule deleted successfully', 'success');
        await loadPTExemptions();
        hideLoading();
    } catch (error) {
        console.error('Error deleting exemption:', error);
        showToast(error.message || 'Failed to delete exemption rule', 'error');
        hideLoading();
    }
}

// ==================== PT Calculator ====================

function initializePTCalculator() {
    populatePTStateDropdowns();

    const form = document.getElementById('ptCalculatorForm');
    if (form) {
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            await calculatePT();
        });
    }

    // Set current month/year
    const now = new Date();
    document.getElementById('ptCalcMonth').value = now.getMonth() + 1;
    document.getElementById('ptCalcYear').value = now.getFullYear();
}

async function calculatePT() {
    const stateId = document.getElementById('ptCalcState').value;
    const grossSalary = parseFloat(document.getElementById('ptCalcGrossSalary').value);
    const month = parseInt(document.getElementById('ptCalcMonth').value);
    const year = parseInt(document.getElementById('ptCalcYear').value);
    const gender = document.getElementById('ptCalcGender').value || null;

    if (!stateId || !grossSalary) {
        showToast('Please fill in all required fields', 'error');
        return;
    }

    try {
        showLoading();

        const response = await api.request('/hrms/professional-tax/calculate', {
            method: 'POST',
            body: JSON.stringify({
                state_id: stateId,
                gross_salary: grossSalary,
                month: month,
                year: year,
                gender: gender
            })
        });

        displayPTCalcResult(response);
        hideLoading();
    } catch (error) {
        console.error('Error calculating PT:', error);
        showToast(error.message || 'Failed to calculate PT', 'error');
        hideLoading();
    }
}

function displayPTCalcResult(result) {
    const resultDiv = document.getElementById('ptCalcResult');
    if (!resultDiv) return;

    // Show result section
    resultDiv.style.display = 'block';

    // Update main amount - backend returns pt_amount, not tax_amount
    document.getElementById('ptCalcAmount').textContent = formatCurrency(result.pt_amount || 0);

    // Update details
    const state = ptStates.find(s => s.id === document.getElementById('ptCalcState').value);
    document.getElementById('ptCalcResultState').textContent = result.state_name || state?.state_name || '-';
    document.getElementById('ptCalcResultType').textContent = result.calculation_type === 'slab' ? 'Slab-based' : 'Fixed Amount';

    // Slab info - backend returns slab_applied as string description
    if (result.slab_applied) {
        document.getElementById('ptCalcResultSlab').textContent = result.slab_applied;
    } else {
        document.getElementById('ptCalcResultSlab').textContent = result.calculation_type === 'fixed' ? 'N/A (Fixed)' : '-';
    }

    // Special month (using result-item display, not flex for row)
    const specialMonthRow = document.getElementById('ptCalcSpecialMonthRow');
    if (result.is_special_month) {
        specialMonthRow.style.display = '';
        document.getElementById('ptCalcSpecialMonth').textContent =
            `Yes - ${getMonthName(result.month)} (${formatCurrency(result.special_month_amount)})`;
    } else {
        specialMonthRow.style.display = 'none';
    }

    // Exemption - backend returns exemption_applied, not is_exempt
    const exemptionRow = document.getElementById('ptCalcExemptionRow');
    if (result.exemption_applied) {
        exemptionRow.style.display = '';
        document.getElementById('ptCalcExemption').textContent = result.exemption_reason || 'Exempt';
        document.getElementById('ptCalcExemption').className = 'result-value exemption-badge exempt';
    } else {
        exemptionRow.style.display = 'none';
    }

    // Slab breakdown - backend returns slab_breakdown, not all_slabs
    const slabEmptyState = document.getElementById('ptSlabEmptyState');
    const slabTable = document.getElementById('ptSlabTable');
    const slabsBody = document.getElementById('ptCalcSlabsBody');

    if (result.slab_breakdown && result.slab_breakdown.length > 0) {
        if (slabEmptyState) slabEmptyState.style.display = 'none';
        if (slabTable) slabTable.style.display = 'table';
        slabsBody.innerHTML = result.slab_breakdown.map((slab, index) => `
            <tr class="${slab.is_applied ? 'slab-applied' : ''}">
                <td>${slab.slab_order || index + 1}</td>
                <td>₹${slab.salary_from?.toLocaleString() || 0} - ₹${slab.salary_to?.toLocaleString() || '∞'}</td>
                <td>${slab.is_percentage ? slab.tax_amount + '%' : formatCurrency(slab.tax_amount)}</td>
                <td>${slab.is_applied ? '✓' : ''}</td>
            </tr>
        `).join('');
    } else {
        if (slabEmptyState) slabEmptyState.style.display = 'flex';
        if (slabTable) slabTable.style.display = 'none';
    }
}

function clearPTCalculator() {
    document.getElementById('ptCalculatorForm').reset();
    document.getElementById('ptCalcResult').style.display = 'none';

    // Reset slab breakdown in second card
    const slabEmptyState = document.getElementById('ptSlabEmptyState');
    const slabTable = document.getElementById('ptSlabTable');
    if (slabEmptyState) slabEmptyState.style.display = 'flex';
    if (slabTable) slabTable.style.display = 'none';

    // Reset to current month/year
    const now = new Date();
    document.getElementById('ptCalcMonth').value = now.getMonth() + 1;
    document.getElementById('ptCalcYear').value = now.getFullYear();
}

// Debounce utility
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

// Close modal when clicking outside
document.addEventListener('click', function(e) {
    if (e.target.classList.contains('modal')) {
        e.target.classList.remove('active');
        document.body.style.overflow = '';
    }
});

// Escape key to close modals
document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
        const activeModal = document.querySelector('.modal.active');
        if (activeModal) {
            activeModal.classList.remove('active');
            document.body.style.overflow = '';
        }
    }
});

// =============================================================
// LABOUR WELFARE FUND (LWF) FUNCTIONS
// =============================================================

let lwfConfigs = [];
let currentLWFConfigId = null;
let lwfTaxTypeId = null;

// Month names for display
const MONTH_NAMES = ['', 'January', 'February', 'March', 'April', 'May', 'June',
                     'July', 'August', 'September', 'October', 'November', 'December'];
const MONTH_SHORT = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                     'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// LWF States cache
let lwfEnabledStates = [];

async function loadLWFConfigs() {
    const grid = document.getElementById('lwfConfigsGrid');
    if (!grid) return;

    grid.innerHTML = '<div class="loading-cell">Loading LWF configurations...</div>';

    try {
        // Get filters
        const stateFilter = document.getElementById('lwfConfigStateFilter')?.value || '';
        const frequencyFilter = document.getElementById('lwfConfigFrequencyFilter')?.value || '';
        const showInactive = document.getElementById('lwfConfigShowInactive')?.checked || false;

        // Use new state-based API
        let url = '/hrms/statutory/lwf/configurations';
        const params = [];
        if (showInactive) params.push('includeInactive=true');
        if (params.length > 0) url += '?' + params.join('&');

        const response = await api.request(url);

        // Filter by state and frequency if selected
        lwfConfigs = (response || []).filter(config => {
            const matchesState = !stateFilter || config.state_id === stateFilter;
            const matchesFrequency = !frequencyFilter || config.frequency === frequencyFilter;
            return matchesState && matchesFrequency;
        });

        await populateLWFStateDropdowns();
        renderLWFConfigsGrid();
    } catch (error) {
        console.error('Error loading LWF configs:', error);
        grid.innerHTML = '<div class="error-cell">Failed to load LWF configurations. Please try again.</div>';
    }
}

async function populateLWFStateDropdowns() {
    const selectIds = [
        'lwfConfigStateFilter',
        'lwfConfigState',
        'lwfCalcState'
    ];

    // Get LWF-enabled states
    try {
        const response = await api.request('/hrms/statutory/lwf/states');
        lwfEnabledStates = response || [];
    } catch (e) {
        console.error('Error loading LWF-enabled states:', e);
        lwfEnabledStates = [];
    }

    // Create options array for searchable dropdowns
    const stateOptions = lwfEnabledStates.map(state => ({
        value: state.id,
        label: `${state.state_name} (${state.state_code})`
    }));

    selectIds.forEach(selectId => {
        const select = document.getElementById(selectId);
        if (!select) return;

        const currentValue = select.value;
        const isFilter = selectId.includes('Filter');

        // Update native select
        select.innerHTML = isFilter
            ? '<option value="">All States</option>'
            : '<option value="">-- Select State (LWF Enabled) --</option>';

        lwfEnabledStates.forEach(state => {
            select.innerHTML += `<option value="${state.id}">${state.state_name} (${state.state_code})</option>`;
        });

        if (currentValue) select.value = currentValue;

        // Also update searchable dropdown component if it exists
        updateSearchableDropdownOptions(selectId, stateOptions, currentValue || null);
    });
}

function renderLWFConfigsGrid() {
    const grid = document.getElementById('lwfConfigsGrid');
    if (!grid) return;

    if (lwfConfigs.length === 0) {
        grid.innerHTML = `
            <div class="empty-state">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                    <circle cx="9" cy="7" r="4"></circle>
                    <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
                    <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
                </svg>
                <p>No LWF configurations found</p>
                <p style="font-size: 0.9rem; color: var(--text-secondary); margin-top: 8px;">Enable LWF for states in Indian States configuration first.</p>
                <button class="btn btn-primary" onclick="showCreateLWFConfigModal()">Add LWF Configuration</button>
            </div>
        `;
        return;
    }

    grid.innerHTML = lwfConfigs.map(config => {
        // Find state from cache
        const state = lwfEnabledStates.find(s => s.id === config.state_id);
        const stateName = state ? `${state.state_name} (${state.state_code})` : (config.state_name || 'Unknown State');
        const frequency = config.frequency || 'monthly';
        const applicableMonths = config.applicable_months || [];

        // Get contributions from config
        const employeeAmt = parseFloat(config.employee_contribution) || 0;
        const employerAmt = parseFloat(config.employer_contribution) || 0;
        const totalAmt = employeeAmt + employerAmt;

        // Check calculation type
        const isPercentage = config.calculation_type === 'percentage';
        const employeeDisplay = isPercentage
            ? `${config.employee_percentage || 0}% of ${config.percentage_of || 'Gross'}`
            : `₹${employeeAmt.toFixed(2)}`;
        const employerDisplay = isPercentage
            ? `${config.employer_percentage || 0}% of ${config.percentage_of || 'Gross'}`
            : `₹${employerAmt.toFixed(2)}`;

        const monthsPills = applicableMonths.length > 0
            ? `<div class="applicable-months">
                ${applicableMonths.map(m => `<span class="month-pill">${MONTH_SHORT[m]}</span>`).join('')}
               </div>`
            : '';

        return `
            <div class="lwf-config-card ${config.is_active ? '' : 'inactive'}">
                <div class="lwf-config-header">
                    <div class="lwf-config-title">
                        <strong>${escapeHtml(config.config_name || 'LWF Configuration')}</strong>
                        <span class="state-name">${escapeHtml(stateName)}</span>
                    </div>
                    <span class="frequency-badge ${frequency}">${frequency}</span>
                </div>
                <div class="lwf-config-body">
                    <div class="lwf-contribution-row">
                        <span class="label">Employee Contribution</span>
                        <span class="amount">${employeeDisplay}</span>
                    </div>
                    <div class="lwf-contribution-row">
                        <span class="label">Employer Contribution</span>
                        <span class="amount">${employerDisplay}</span>
                    </div>
                    ${!isPercentage ? `
                    <div class="lwf-contribution-row total">
                        <span class="label">Total per ${frequency === 'monthly' ? 'Month' : 'Period'}</span>
                        <span class="amount">₹${totalAmt.toFixed(2)}</span>
                    </div>
                    ` : ''}
                    ${monthsPills}
                    <div class="config-info-row" style="margin-top: 12px;">
                        <span>Effective From</span>
                        <strong>${config.effective_from ? new Date(config.effective_from).toLocaleDateString() : 'N/A'}</strong>
                    </div>
                    ${config.effective_to ? `
                        <div class="config-info-row">
                            <span>Effective To</span>
                            <strong>${new Date(config.effective_to).toLocaleDateString()}</strong>
                        </div>
                    ` : ''}
                    ${config.financial_year ? `
                        <div class="config-info-row">
                            <span>Financial Year</span>
                            <strong>${escapeHtml(config.financial_year)}</strong>
                        </div>
                    ` : ''}
                </div>
                <div class="lwf-config-footer">
                    <span class="status-badge ${config.is_active ? 'active' : 'inactive'}">
                        ${config.is_active ? 'Active' : 'Inactive'}
                    </span>
                    <div class="config-actions">
                        <button class="btn btn-sm btn-secondary" onclick="editLWFConfig('${config.id}')" title="Edit">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                            </svg>
                        </button>
                        <button class="btn btn-sm btn-danger" onclick="deleteLWFConfig('${config.id}')" title="Delete">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <polyline points="3 6 5 6 21 6"></polyline>
                                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                            </svg>
                        </button>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

function showCreateLWFConfigModal() {
    currentLWFConfigId = null;
    document.getElementById('lwfConfigModalTitle').textContent = 'Add LWF Configuration';
    document.getElementById('lwfConfigForm').reset();
    document.getElementById('lwfConfigIsActive').checked = true;
    document.getElementById('lwfConfigEffectiveFrom').value = new Date().toISOString().split('T')[0];

    // Reset frequency to monthly and hide applicable months
    document.getElementById('lwfConfigFrequency').value = 'monthly';
    toggleLWFApplicableMonths();

    // Clear selected months
    clearAllMonths();

    populateLWFStateDropdowns();
    openModal('lwfConfigModal');
}

async function editLWFConfig(configId) {
    currentLWFConfigId = configId;
    const config = lwfConfigs.find(c => c.id === configId);
    if (!config) {
        showToast('Configuration not found', 'error');
        return;
    }

    await populateLWFStateDropdowns();

    document.getElementById('lwfConfigModalTitle').textContent = 'Edit LWF Configuration';
    document.getElementById('lwfConfigState').value = config.state_id || '';
    document.getElementById('lwfConfigName').value = config.config_name || '';
    document.getElementById('lwfConfigFinancialYear').value = config.financial_year || '';
    document.getElementById('lwfConfigFrequency').value = config.frequency || 'monthly';
    document.getElementById('lwfConfigEmployeeAmount').value = config.employee_contribution || '';
    document.getElementById('lwfConfigEmployerAmount').value = config.employer_contribution || '';
    document.getElementById('lwfConfigEffectiveFrom').value = config.effective_from?.split('T')[0] || '';
    document.getElementById('lwfConfigEffectiveTo').value = config.effective_to?.split('T')[0] || '';
    document.getElementById('lwfConfigNotes').value = config.notes || '';
    document.getElementById('lwfConfigIsActive').checked = config.is_active !== false;

    // Handle applicable months
    toggleLWFApplicableMonths();
    setSelectedMonths(config.applicable_months || []);

    openModal('lwfConfigModal');
}

function toggleLWFApplicableMonths() {
    const frequency = document.getElementById('lwfConfigFrequency').value;
    const monthsGroup = document.getElementById('lwfApplicableMonthsGroup');

    if (frequency === 'monthly') {
        monthsGroup.style.display = 'none';
        clearAllMonths();
    } else {
        monthsGroup.style.display = 'block';
    }
}

// Month dropdown state
let selectedMonths = [];
const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function toggleMonthDropdown() {
    const container = document.getElementById('lwfMonthDropdown');
    container.classList.toggle('open');
}

function closeMonthDropdown() {
    const container = document.getElementById('lwfMonthDropdown');
    container.classList.remove('open');
}

function toggleMonth(month) {
    const index = selectedMonths.indexOf(month);
    if (index === -1) {
        selectedMonths.push(month);
    } else {
        selectedMonths.splice(index, 1);
    }
    selectedMonths.sort((a, b) => a - b);
    updateMonthDisplay();
}

function removeMonth(month) {
    const index = selectedMonths.indexOf(month);
    if (index !== -1) {
        selectedMonths.splice(index, 1);
        updateMonthDisplay();
    }
}

function clearAllMonths() {
    selectedMonths = [];
    updateMonthDisplay();
}

function setSelectedMonths(months) {
    selectedMonths = months ? [...months].sort((a, b) => a - b) : [];
    updateMonthDisplay();
}

function getSelectedMonths() {
    return [...selectedMonths];
}

function updateMonthDisplay() {
    const tagsContainer = document.getElementById('lwfSelectedMonthsTags');
    const buttons = document.querySelectorAll('.month-toggle-btn');

    // Update toggle buttons
    buttons.forEach(btn => {
        const month = parseInt(btn.dataset.month);
        if (selectedMonths.includes(month)) {
            btn.classList.add('selected');
        } else {
            btn.classList.remove('selected');
        }
    });

    // Update tags display
    if (selectedMonths.length === 0) {
        tagsContainer.innerHTML = '<span class="month-placeholder">Select months...</span>';
    } else {
        tagsContainer.innerHTML = selectedMonths.map(month =>
            `<span class="month-tag">${monthNames[month - 1]}<span class="remove-month" onclick="event.stopPropagation(); removeMonth(${month})">×</span></span>`
        ).join('');
    }
}

// Close dropdown when clicking outside
document.addEventListener('click', function(e) {
    const container = document.getElementById('lwfMonthDropdown');
    if (container && !container.contains(e.target)) {
        container.classList.remove('open');
    }
});

async function saveLWFConfig() {
    const form = document.getElementById('lwfConfigForm');
    if (!form.checkValidity()) {
        form.reportValidity();
        return;
    }

    const stateId = document.getElementById('lwfConfigState').value;
    if (!stateId) {
        showToast('Please select a state', 'error');
        return;
    }

    const frequency = document.getElementById('lwfConfigFrequency').value;

    // Get selected months for non-monthly frequencies
    let applicableMonths = null;
    if (frequency !== 'monthly') {
        applicableMonths = getSelectedMonths();

        // Validate applicable months
        if (applicableMonths.length === 0) {
            showToast('Please select at least one applicable month', 'error');
            return;
        }

        // Validate month count based on frequency
        if (frequency === 'half_yearly' && applicableMonths.length !== 2) {
            showToast('Half-yearly frequency requires exactly 2 months', 'error');
            return;
        }
        if (frequency === 'annual' && applicableMonths.length !== 1) {
            showToast('Annual frequency requires exactly 1 month', 'error');
            return;
        }
    }

    try {
        showLoading();

        const data = {
            state_id: stateId,
            config_name: document.getElementById('lwfConfigName').value,
            employee_contribution: parseFloat(document.getElementById('lwfConfigEmployeeAmount').value) || 0,
            employer_contribution: parseFloat(document.getElementById('lwfConfigEmployerAmount').value) || 0,
            calculation_type: 'fixed',  // Currently only supporting fixed contributions
            frequency: frequency,
            applicable_months: applicableMonths,
            financial_year: document.getElementById('lwfConfigFinancialYear').value || null,
            effective_from: document.getElementById('lwfConfigEffectiveFrom').value,
            effective_to: document.getElementById('lwfConfigEffectiveTo').value || null,
            notes: document.getElementById('lwfConfigNotes').value || null,
            is_active: document.getElementById('lwfConfigIsActive').checked
        };

        if (currentLWFConfigId) {
            data.id = currentLWFConfigId;
            await api.request('/hrms/statutory/lwf/configurations', {
                method: 'PUT',
                body: JSON.stringify(data)
            });
            showToast('LWF configuration updated successfully', 'success');
        } else {
            await api.request('/hrms/statutory/lwf/configurations', {
                method: 'POST',
                body: JSON.stringify(data)
            });
            showToast('LWF configuration created successfully', 'success');
        }

        closeLWFConfigModal();
        await loadLWFConfigs();
        hideLoading();
    } catch (error) {
        console.error('Error saving LWF config:', error);
        showToast(error.message || 'Failed to save LWF configuration', 'error');
        hideLoading();
    }
}

async function deleteLWFConfig(configId) {
    if (!confirm('Are you sure you want to delete this LWF configuration? This action cannot be undone.')) {
        return;
    }

    try {
        showLoading();
        await api.request(`/hrms/statutory/lwf/configurations/${configId}`, {
            method: 'DELETE'
        });
        showToast('LWF configuration deleted successfully', 'success');
        await loadLWFConfigs();
        hideLoading();
    } catch (error) {
        console.error('Error deleting LWF config:', error);
        showToast(error.message || 'Failed to delete LWF configuration', 'error');
        hideLoading();
    }
}

function closeLWFConfigModal() {
    closeModal('lwfConfigModal');
    currentLWFConfigId = null;
}

// LWF Calculator
async function initializeLWFCalculator() {
    await populateLWFStateDropdowns();

    // Set default month to current month
    const today = new Date();
    const monthSelect = document.getElementById('lwfCalcDeductionMonth');
    if (monthSelect) {
        monthSelect.value = today.getMonth() + 1;  // 1-12
    }
}

async function calculateLWF() {
    const stateId = document.getElementById('lwfCalcState').value;
    const deductionMonth = parseInt(document.getElementById('lwfCalcDeductionMonth').value);
    const grossSalary = parseFloat(document.getElementById('lwfCalcGrossSalary').value) || 0;
    const basicSalary = parseFloat(document.getElementById('lwfCalcBasicSalary').value) || null;
    const resultDiv = document.getElementById('lwfCalcResult');

    if (!stateId || !deductionMonth) {
        showToast('Please select a state and deduction month', 'error');
        return;
    }

    if (!grossSalary) {
        showToast('Please enter gross salary', 'error');
        return;
    }

    try {
        showLoading();

        // Find state name from cache
        const state = lwfEnabledStates.find(s => s.id === stateId);
        const stateName = state ? state.state_name : 'Unknown State';

        // Call the LWF calculate API
        const requestData = {
            state_id: stateId,
            gross_salary: grossSalary,
            basic_salary: basicSalary,
            calculation_date: new Date().toISOString().split('T')[0],
            deduction_month: deductionMonth
        };

        const result = await api.request('/hrms/statutory/lwf/calculate', {
            method: 'POST',
            body: JSON.stringify(requestData)
        });

        const isApplicable = result.is_applicable;
        const frequency = result.frequency || 'monthly';

        resultDiv.innerHTML = `
            <div class="calc-result-card">
                <h4>LWF Calculation Result</h4>
                <div class="result-summary">
                    <div class="result-row">
                        <span>State</span>
                        <strong>${escapeHtml(result.state_name || stateName)}</strong>
                    </div>
                    <div class="result-row">
                        <span>Deduction Month</span>
                        <strong>${MONTH_NAMES[deductionMonth]}</strong>
                    </div>
                    <div class="result-row">
                        <span>Gross Salary</span>
                        <strong>₹${grossSalary.toLocaleString('en-IN')}</strong>
                    </div>
                    ${result.frequency ? `
                    <div class="result-row">
                        <span>Frequency</span>
                        <strong><span class="frequency-badge ${frequency}">${frequency}</span></strong>
                    </div>
                    ` : ''}
                </div>

                <div class="result-calculation ${isApplicable ? '' : 'not-applicable'}">
                    <div class="calc-header">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            ${isApplicable
                                ? '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline>'
                                : '<circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line>'
                            }
                        </svg>
                        <span>${isApplicable ? 'LWF Applicable' : 'LWF Not Applicable'}</span>
                    </div>
                    <p class="calc-reason">${escapeHtml(result.message || '')}</p>

                    ${isApplicable ? `
                        <div class="lwf-contribution-row">
                            <span class="label">Employee Contribution</span>
                            <span class="amount">₹${(result.employee_contribution || 0).toFixed(2)}</span>
                        </div>
                        <div class="lwf-contribution-row">
                            <span class="label">Employer Contribution</span>
                            <span class="amount">₹${(result.employer_contribution || 0).toFixed(2)}</span>
                        </div>
                        <div class="lwf-contribution-row total">
                            <span class="label">Total LWF</span>
                            <span class="amount">₹${(result.total_contribution || 0).toFixed(2)}</span>
                        </div>
                        ${result.config_name ? `
                        <div class="result-row" style="margin-top: 12px; font-size: 0.85rem; color: var(--text-secondary);">
                            <span>Configuration Used</span>
                            <strong>${escapeHtml(result.config_name)}</strong>
                        </div>
                        ` : ''}
                    ` : ''}
                </div>
            </div>
        `;

        hideLoading();
    } catch (error) {
        console.error('Error calculating LWF:', error);
        showToast(error.message || 'Failed to calculate LWF', 'error');
        hideLoading();
    }
}
