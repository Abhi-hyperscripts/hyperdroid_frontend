/**
 * HRMS MonthPicker - A calendar-style month/year picker component
 * Shows a dropdown with year navigation and month grid
 * Shared component used across HRMS pages (payroll, attendance, etc.)
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

// Export for use in other modules
if (typeof window !== 'undefined') {
    window.MonthPicker = MonthPicker;
    window.monthPickerInstances = monthPickerInstances;
}
