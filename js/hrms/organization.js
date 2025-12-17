// Organization Page JavaScript

// Security: HTML escape function to prevent XSS attacks
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

let currentUser = null;
let offices = [];
let departments = [];
let allDesignations = [];  // Renamed from 'designations' to avoid DOM ID conflict
let shifts = [];
let shiftRosters = [];
let holidays = [];
let employees = [];
let taxTypes = [];
let taxRules = [];

// Salary Components and Structures
let components = [];
let structures = [];
let structureComponentCounter = 0;
let currentVersionStructureId = '';
let currentVersionStructureName = '';
let structureVersions = [];

// Arrears management
let currentArrearsList = [];
let selectedArrearsIds = new Set();

// Bulk assignment
let bulkAssignStructureId = null;
let bulkAssignVersionNumber = null;
let bulkPreviewResult = null;

// Store for searchable dropdown instances
const searchableDropdowns = new Map();

/**
 * SearchableDropdown - A reusable searchable dropdown component with virtual scroll
 * Usage:
 *   const dropdown = new SearchableDropdown(container, {
 *     options: [{ value: 'val1', label: 'Label 1', description: 'Optional desc' }, ...],
 *     placeholder: 'Select an option',
 *     searchPlaceholder: 'Search...',
 *     onChange: (value, option) => {},
 *     virtualScroll: true,  // Enable for large lists (100+ items)
 *     itemHeight: 40        // Height of each item for virtual scroll
 *   });
 */
class SearchableDropdown {
    constructor(container, options = {}) {
        this.container = typeof container === 'string' ? document.getElementById(container) : container;
        if (!this.container) return;

        this.options = options.options || [];
        this.placeholder = options.placeholder || 'Select an option';
        this.searchPlaceholder = options.searchPlaceholder || 'Search...';
        this.onChange = options.onChange || (() => {});
        this.virtualScroll = options.virtualScroll || false;
        this.itemHeight = options.itemHeight || 40;
        this.selectedValue = options.value || null;
        this.filteredOptions = [...this.options];
        this.highlightedIndex = -1;
        this.isOpen = false;
        this.id = options.id || `sd-${Date.now()}`;

        this.render();
        this.bindEvents();

        // Store reference
        searchableDropdowns.set(this.id, this);
    }

    render() {
        const selectedOption = this.options.find(o => o.value === this.selectedValue);
        const displayText = selectedOption ? selectedOption.label : '';

        this.container.innerHTML = `
            <div class="searchable-dropdown" id="${this.id}">
                <div class="searchable-dropdown-trigger" tabindex="0">
                    <span class="selected-text ${!displayText ? 'placeholder' : ''}">${displayText || this.placeholder}</span>
                    <svg class="dropdown-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="6 9 12 15 18 9"></polyline>
                    </svg>
                </div>
                <div class="searchable-dropdown-menu">
                    <div class="searchable-dropdown-search">
                        <input type="text" placeholder="${this.searchPlaceholder}" autocomplete="off">
                    </div>
                    <div class="searchable-dropdown-options">
                        ${this.renderOptions()}
                    </div>
                </div>
            </div>
        `;

        this.dropdownEl = this.container.querySelector('.searchable-dropdown');
        this.triggerEl = this.container.querySelector('.searchable-dropdown-trigger');
        this.menuEl = this.container.querySelector('.searchable-dropdown-menu');
        this.searchInput = this.container.querySelector('.searchable-dropdown-search input');
        this.optionsEl = this.container.querySelector('.searchable-dropdown-options');
        this.selectedTextEl = this.container.querySelector('.selected-text');
    }

    renderOptions() {
        if (this.filteredOptions.length === 0) {
            return '<div class="searchable-dropdown-no-results">No results found</div>';
        }

        if (this.virtualScroll && this.filteredOptions.length > 50) {
            return this.renderVirtualOptions();
        }

        return this.filteredOptions.map((option, index) => `
            <div class="searchable-dropdown-option ${option.value === this.selectedValue ? 'selected' : ''} ${index === this.highlightedIndex ? 'highlighted' : ''}"
                 data-value="${escapeHtml(String(option.value))}"
                 data-index="${index}">
                <span class="option-label">${escapeHtml(option.label)}</span>
                ${option.description ? `<span class="option-description">${escapeHtml(option.description)}</span>` : ''}
                <svg class="check-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="20 6 9 17 4 12"></polyline>
                </svg>
            </div>
        `).join('');
    }

    renderVirtualOptions() {
        const totalHeight = this.filteredOptions.length * this.itemHeight;
        const visibleCount = Math.ceil(220 / this.itemHeight) + 2;

        return `
            <div class="searchable-dropdown-virtual" style="height: ${totalHeight}px;">
                <div class="searchable-dropdown-virtual-viewport">
                    ${this.filteredOptions.slice(0, visibleCount).map((option, index) => `
                        <div class="searchable-dropdown-option ${option.value === this.selectedValue ? 'selected' : ''}"
                             data-value="${escapeHtml(String(option.value))}"
                             data-index="${index}"
                             style="height: ${this.itemHeight}px;">
                            <span class="option-label">${escapeHtml(option.label)}</span>
                            ${option.description ? `<span class="option-description">${escapeHtml(option.description)}</span>` : ''}
                            <svg class="check-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <polyline points="20 6 9 17 4 12"></polyline>
                            </svg>
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
            const optionEl = e.target.closest('.searchable-dropdown-option');
            if (optionEl) {
                this.select(optionEl.dataset.value);
            }
        });

        // Virtual scroll
        if (this.virtualScroll) {
            this.optionsEl.addEventListener('scroll', () => this.handleVirtualScroll());
        }

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
        if (!this.virtualScroll) return;

        const scrollTop = this.optionsEl.scrollTop;
        const startIndex = Math.floor(scrollTop / this.itemHeight);
        const visibleCount = Math.ceil(220 / this.itemHeight) + 2;
        const endIndex = Math.min(startIndex + visibleCount, this.filteredOptions.length);

        const viewport = this.optionsEl.querySelector('.searchable-dropdown-virtual-viewport');
        if (viewport) {
            viewport.style.top = `${startIndex * this.itemHeight}px`;
            viewport.innerHTML = this.filteredOptions.slice(startIndex, endIndex).map((option, i) => `
                <div class="searchable-dropdown-option ${option.value === this.selectedValue ? 'selected' : ''}"
                     data-value="${escapeHtml(String(option.value))}"
                     data-index="${startIndex + i}"
                     style="height: ${this.itemHeight}px;">
                    <span class="option-label">${escapeHtml(option.label)}</span>
                    ${option.description ? `<span class="option-description">${escapeHtml(option.description)}</span>` : ''}
                    <svg class="check-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="20 6 9 17 4 12"></polyline>
                    </svg>
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
        const options = this.optionsEl.querySelectorAll('.searchable-dropdown-option');
        options.forEach((el, i) => {
            el.classList.toggle('highlighted', i === this.highlightedIndex);
        });

        // Scroll into view
        const highlighted = options[this.highlightedIndex];
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
        } else {
            this.selectedValue = null;
            this.selectedTextEl.textContent = this.placeholder;
            this.selectedTextEl.classList.add('placeholder');
        }
    }

    setOptions(options) {
        this.options = options;
        this.filteredOptions = [...options];
        if (this.selectedValue && !options.find(o => o.value === this.selectedValue)) {
            this.selectedValue = null;
            this.selectedTextEl.textContent = this.placeholder;
            this.selectedTextEl.classList.add('placeholder');
        }
        if (this.isOpen) {
            this.optionsEl.innerHTML = this.renderOptions();
        }
    }

    destroy() {
        searchableDropdowns.delete(this.id);
        this.container.innerHTML = '';
    }
}

// Helper function to create searchable dropdown from existing select element
function convertToSearchableDropdown(selectId, options = {}) {
    const select = document.getElementById(selectId);
    if (!select) return null;

    // Extract options from select
    const selectOptions = Array.from(select.options).map(opt => ({
        value: opt.value,
        label: opt.textContent,
        description: opt.dataset.description || ''
    }));

    // Create container
    const container = document.createElement('div');
    container.id = `${selectId}-searchable`;
    select.parentNode.insertBefore(container, select);
    select.style.display = 'none';

    // Create dropdown
    const dropdown = new SearchableDropdown(container, {
        id: selectId,
        options: selectOptions,
        value: select.value,
        placeholder: options.placeholder || 'Select...',
        searchPlaceholder: options.searchPlaceholder || 'Search...',
        virtualScroll: options.virtualScroll || selectOptions.length > 50,
        onChange: (value) => {
            select.value = value;
            select.dispatchEvent(new Event('change'));
            if (options.onChange) options.onChange(value);
        }
    });

    return dropdown;
}

// Timezone data (comprehensive list of IANA timezones)
const TIMEZONES = [
    { value: 'Pacific/Midway', label: 'Midway Island (UTC-11:00)' },
    { value: 'Pacific/Honolulu', label: 'Hawaii (UTC-10:00)' },
    { value: 'America/Anchorage', label: 'Alaska (UTC-09:00)' },
    { value: 'America/Los_Angeles', label: 'Pacific Time (US & Canada) (UTC-08:00)' },
    { value: 'America/Tijuana', label: 'Tijuana (UTC-08:00)' },
    { value: 'America/Denver', label: 'Mountain Time (US & Canada) (UTC-07:00)' },
    { value: 'America/Phoenix', label: 'Arizona (UTC-07:00)' },
    { value: 'America/Chicago', label: 'Central Time (US & Canada) (UTC-06:00)' },
    { value: 'America/Mexico_City', label: 'Mexico City (UTC-06:00)' },
    { value: 'America/New_York', label: 'Eastern Time (US & Canada) (UTC-05:00)' },
    { value: 'America/Bogota', label: 'Bogota (UTC-05:00)' },
    { value: 'America/Lima', label: 'Lima (UTC-05:00)' },
    { value: 'America/Caracas', label: 'Caracas (UTC-04:00)' },
    { value: 'America/Halifax', label: 'Atlantic Time (Canada) (UTC-04:00)' },
    { value: 'America/Santiago', label: 'Santiago (UTC-04:00)' },
    { value: 'America/St_Johns', label: 'Newfoundland (UTC-03:30)' },
    { value: 'America/Sao_Paulo', label: 'Brasilia (UTC-03:00)' },
    { value: 'America/Buenos_Aires', label: 'Buenos Aires (UTC-03:00)' },
    { value: 'Atlantic/South_Georgia', label: 'Mid-Atlantic (UTC-02:00)' },
    { value: 'Atlantic/Azores', label: 'Azores (UTC-01:00)' },
    { value: 'Atlantic/Cape_Verde', label: 'Cape Verde (UTC-01:00)' },
    { value: 'UTC', label: 'UTC (UTC+00:00)' },
    { value: 'Europe/London', label: 'London, Edinburgh (UTC+00:00)' },
    { value: 'Europe/Dublin', label: 'Dublin (UTC+00:00)' },
    { value: 'Europe/Lisbon', label: 'Lisbon (UTC+00:00)' },
    { value: 'Africa/Casablanca', label: 'Casablanca (UTC+00:00)' },
    { value: 'Europe/Paris', label: 'Paris, Brussels, Amsterdam (UTC+01:00)' },
    { value: 'Europe/Berlin', label: 'Berlin, Frankfurt (UTC+01:00)' },
    { value: 'Europe/Madrid', label: 'Madrid (UTC+01:00)' },
    { value: 'Europe/Rome', label: 'Rome, Milan (UTC+01:00)' },
    { value: 'Africa/Lagos', label: 'Lagos (UTC+01:00)' },
    { value: 'Europe/Warsaw', label: 'Warsaw (UTC+01:00)' },
    { value: 'Europe/Athens', label: 'Athens (UTC+02:00)' },
    { value: 'Europe/Bucharest', label: 'Bucharest (UTC+02:00)' },
    { value: 'Europe/Helsinki', label: 'Helsinki (UTC+02:00)' },
    { value: 'Europe/Istanbul', label: 'Istanbul (UTC+03:00)' },
    { value: 'Africa/Cairo', label: 'Cairo (UTC+02:00)' },
    { value: 'Africa/Johannesburg', label: 'Johannesburg (UTC+02:00)' },
    { value: 'Asia/Jerusalem', label: 'Jerusalem (UTC+02:00)' },
    { value: 'Europe/Moscow', label: 'Moscow, St. Petersburg (UTC+03:00)' },
    { value: 'Asia/Kuwait', label: 'Kuwait (UTC+03:00)' },
    { value: 'Asia/Riyadh', label: 'Riyadh (UTC+03:00)' },
    { value: 'Africa/Nairobi', label: 'Nairobi (UTC+03:00)' },
    { value: 'Asia/Baghdad', label: 'Baghdad (UTC+03:00)' },
    { value: 'Asia/Tehran', label: 'Tehran (UTC+03:30)' },
    { value: 'Asia/Dubai', label: 'Dubai, Abu Dhabi (UTC+04:00)' },
    { value: 'Asia/Muscat', label: 'Muscat (UTC+04:00)' },
    { value: 'Asia/Baku', label: 'Baku (UTC+04:00)' },
    { value: 'Asia/Kabul', label: 'Kabul (UTC+04:30)' },
    { value: 'Asia/Karachi', label: 'Karachi (UTC+05:00)' },
    { value: 'Asia/Tashkent', label: 'Tashkent (UTC+05:00)' },
    { value: 'Asia/Kolkata', label: 'Mumbai, Kolkata, New Delhi (UTC+05:30)' },
    { value: 'Asia/Colombo', label: 'Colombo (UTC+05:30)' },
    { value: 'Asia/Kathmandu', label: 'Kathmandu (UTC+05:45)' },
    { value: 'Asia/Dhaka', label: 'Dhaka (UTC+06:00)' },
    { value: 'Asia/Almaty', label: 'Almaty (UTC+06:00)' },
    { value: 'Asia/Yangon', label: 'Yangon (UTC+06:30)' },
    { value: 'Asia/Bangkok', label: 'Bangkok (UTC+07:00)' },
    { value: 'Asia/Jakarta', label: 'Jakarta (UTC+07:00)' },
    { value: 'Asia/Ho_Chi_Minh', label: 'Ho Chi Minh City (UTC+07:00)' },
    { value: 'Asia/Singapore', label: 'Singapore (UTC+08:00)' },
    { value: 'Asia/Hong_Kong', label: 'Hong Kong (UTC+08:00)' },
    { value: 'Asia/Shanghai', label: 'Beijing, Shanghai (UTC+08:00)' },
    { value: 'Asia/Taipei', label: 'Taipei (UTC+08:00)' },
    { value: 'Asia/Kuala_Lumpur', label: 'Kuala Lumpur (UTC+08:00)' },
    { value: 'Australia/Perth', label: 'Perth (UTC+08:00)' },
    { value: 'Asia/Seoul', label: 'Seoul (UTC+09:00)' },
    { value: 'Asia/Tokyo', label: 'Tokyo, Osaka (UTC+09:00)' },
    { value: 'Australia/Darwin', label: 'Darwin (UTC+09:30)' },
    { value: 'Australia/Adelaide', label: 'Adelaide (UTC+09:30)' },
    { value: 'Australia/Brisbane', label: 'Brisbane (UTC+10:00)' },
    { value: 'Australia/Sydney', label: 'Sydney, Melbourne (UTC+10:00)' },
    { value: 'Pacific/Guam', label: 'Guam (UTC+10:00)' },
    { value: 'Pacific/Noumea', label: 'Noumea (UTC+11:00)' },
    { value: 'Pacific/Auckland', label: 'Auckland, Wellington (UTC+12:00)' },
    { value: 'Pacific/Fiji', label: 'Fiji (UTC+12:00)' },
    { value: 'Pacific/Tongatapu', label: 'Nuku\'alofa (UTC+13:00)' }
];

// Countries data (comprehensive list)
const COUNTRIES = [
    { value: 'Afghanistan', code: 'AF' }, { value: 'Albania', code: 'AL' }, { value: 'Algeria', code: 'DZ' },
    { value: 'Andorra', code: 'AD' }, { value: 'Angola', code: 'AO' }, { value: 'Argentina', code: 'AR' },
    { value: 'Armenia', code: 'AM' }, { value: 'Australia', code: 'AU' }, { value: 'Austria', code: 'AT' },
    { value: 'Azerbaijan', code: 'AZ' }, { value: 'Bahamas', code: 'BS' }, { value: 'Bahrain', code: 'BH' },
    { value: 'Bangladesh', code: 'BD' }, { value: 'Barbados', code: 'BB' }, { value: 'Belarus', code: 'BY' },
    { value: 'Belgium', code: 'BE' }, { value: 'Belize', code: 'BZ' }, { value: 'Benin', code: 'BJ' },
    { value: 'Bhutan', code: 'BT' }, { value: 'Bolivia', code: 'BO' }, { value: 'Bosnia and Herzegovina', code: 'BA' },
    { value: 'Botswana', code: 'BW' }, { value: 'Brazil', code: 'BR' }, { value: 'Brunei', code: 'BN' },
    { value: 'Bulgaria', code: 'BG' }, { value: 'Burkina Faso', code: 'BF' }, { value: 'Burundi', code: 'BI' },
    { value: 'Cambodia', code: 'KH' }, { value: 'Cameroon', code: 'CM' }, { value: 'Canada', code: 'CA' },
    { value: 'Central African Republic', code: 'CF' }, { value: 'Chad', code: 'TD' }, { value: 'Chile', code: 'CL' },
    { value: 'China', code: 'CN' }, { value: 'Colombia', code: 'CO' }, { value: 'Comoros', code: 'KM' },
    { value: 'Congo', code: 'CG' }, { value: 'Costa Rica', code: 'CR' }, { value: 'Croatia', code: 'HR' },
    { value: 'Cuba', code: 'CU' }, { value: 'Cyprus', code: 'CY' }, { value: 'Czech Republic', code: 'CZ' },
    { value: 'Denmark', code: 'DK' }, { value: 'Djibouti', code: 'DJ' }, { value: 'Dominican Republic', code: 'DO' },
    { value: 'Ecuador', code: 'EC' }, { value: 'Egypt', code: 'EG' }, { value: 'El Salvador', code: 'SV' },
    { value: 'Estonia', code: 'EE' }, { value: 'Ethiopia', code: 'ET' }, { value: 'Fiji', code: 'FJ' },
    { value: 'Finland', code: 'FI' }, { value: 'France', code: 'FR' }, { value: 'Gabon', code: 'GA' },
    { value: 'Gambia', code: 'GM' }, { value: 'Georgia', code: 'GE' }, { value: 'Germany', code: 'DE' },
    { value: 'Ghana', code: 'GH' }, { value: 'Greece', code: 'GR' }, { value: 'Guatemala', code: 'GT' },
    { value: 'Guinea', code: 'GN' }, { value: 'Haiti', code: 'HT' }, { value: 'Honduras', code: 'HN' },
    { value: 'Hong Kong', code: 'HK' }, { value: 'Hungary', code: 'HU' }, { value: 'Iceland', code: 'IS' },
    { value: 'India', code: 'IN' }, { value: 'Indonesia', code: 'ID' }, { value: 'Iran', code: 'IR' },
    { value: 'Iraq', code: 'IQ' }, { value: 'Ireland', code: 'IE' }, { value: 'Israel', code: 'IL' },
    { value: 'Italy', code: 'IT' }, { value: 'Jamaica', code: 'JM' }, { value: 'Japan', code: 'JP' },
    { value: 'Jordan', code: 'JO' }, { value: 'Kazakhstan', code: 'KZ' }, { value: 'Kenya', code: 'KE' },
    { value: 'Kuwait', code: 'KW' }, { value: 'Kyrgyzstan', code: 'KG' }, { value: 'Laos', code: 'LA' },
    { value: 'Latvia', code: 'LV' }, { value: 'Lebanon', code: 'LB' }, { value: 'Liberia', code: 'LR' },
    { value: 'Libya', code: 'LY' }, { value: 'Liechtenstein', code: 'LI' }, { value: 'Lithuania', code: 'LT' },
    { value: 'Luxembourg', code: 'LU' }, { value: 'Macau', code: 'MO' }, { value: 'Madagascar', code: 'MG' },
    { value: 'Malawi', code: 'MW' }, { value: 'Malaysia', code: 'MY' }, { value: 'Maldives', code: 'MV' },
    { value: 'Mali', code: 'ML' }, { value: 'Malta', code: 'MT' }, { value: 'Mauritius', code: 'MU' },
    { value: 'Mexico', code: 'MX' }, { value: 'Moldova', code: 'MD' }, { value: 'Monaco', code: 'MC' },
    { value: 'Mongolia', code: 'MN' }, { value: 'Montenegro', code: 'ME' }, { value: 'Morocco', code: 'MA' },
    { value: 'Mozambique', code: 'MZ' }, { value: 'Myanmar', code: 'MM' }, { value: 'Namibia', code: 'NA' },
    { value: 'Nepal', code: 'NP' }, { value: 'Netherlands', code: 'NL' }, { value: 'New Zealand', code: 'NZ' },
    { value: 'Nicaragua', code: 'NI' }, { value: 'Niger', code: 'NE' }, { value: 'Nigeria', code: 'NG' },
    { value: 'North Korea', code: 'KP' }, { value: 'North Macedonia', code: 'MK' }, { value: 'Norway', code: 'NO' },
    { value: 'Oman', code: 'OM' }, { value: 'Pakistan', code: 'PK' }, { value: 'Panama', code: 'PA' },
    { value: 'Papua New Guinea', code: 'PG' }, { value: 'Paraguay', code: 'PY' }, { value: 'Peru', code: 'PE' },
    { value: 'Philippines', code: 'PH' }, { value: 'Poland', code: 'PL' }, { value: 'Portugal', code: 'PT' },
    { value: 'Qatar', code: 'QA' }, { value: 'Romania', code: 'RO' }, { value: 'Russia', code: 'RU' },
    { value: 'Rwanda', code: 'RW' }, { value: 'Saudi Arabia', code: 'SA' }, { value: 'Senegal', code: 'SN' },
    { value: 'Serbia', code: 'RS' }, { value: 'Singapore', code: 'SG' }, { value: 'Slovakia', code: 'SK' },
    { value: 'Slovenia', code: 'SI' }, { value: 'Somalia', code: 'SO' }, { value: 'South Africa', code: 'ZA' },
    { value: 'South Korea', code: 'KR' }, { value: 'Spain', code: 'ES' }, { value: 'Sri Lanka', code: 'LK' },
    { value: 'Sudan', code: 'SD' }, { value: 'Sweden', code: 'SE' }, { value: 'Switzerland', code: 'CH' },
    { value: 'Syria', code: 'SY' }, { value: 'Taiwan', code: 'TW' }, { value: 'Tajikistan', code: 'TJ' },
    { value: 'Tanzania', code: 'TZ' }, { value: 'Thailand', code: 'TH' }, { value: 'Togo', code: 'TG' },
    { value: 'Trinidad and Tobago', code: 'TT' }, { value: 'Tunisia', code: 'TN' }, { value: 'Turkey', code: 'TR' },
    { value: 'Turkmenistan', code: 'TM' }, { value: 'Uganda', code: 'UG' }, { value: 'Ukraine', code: 'UA' },
    { value: 'United Arab Emirates', code: 'AE' }, { value: 'United Kingdom', code: 'GB' }, { value: 'United States', code: 'US' },
    { value: 'Uruguay', code: 'UY' }, { value: 'Uzbekistan', code: 'UZ' }, { value: 'Venezuela', code: 'VE' },
    { value: 'Vietnam', code: 'VN' }, { value: 'Yemen', code: 'YE' }, { value: 'Zambia', code: 'ZM' },
    { value: 'Zimbabwe', code: 'ZW' }
];

// Searchable dropdown functions
function toggleSearchableDropdown(type) {
    const dropdown = document.getElementById(`${type}Dropdown`);
    const isOpen = dropdown.classList.contains('open');

    // Close all other dropdowns first
    document.querySelectorAll('.searchable-dropdown.open').forEach(d => {
        if (d.id !== `${type}Dropdown`) {
            d.classList.remove('open');
        }
    });

    if (isOpen) {
        dropdown.classList.remove('open');
    } else {
        dropdown.classList.add('open');
        const searchInput = document.getElementById(`${type}Search`);
        if (searchInput) {
            searchInput.value = '';
            searchInput.focus();
            if (type === 'timezone') {
                renderTimezoneOptions();
            } else if (type === 'country') {
                renderCountryOptions();
            } else if (type === 'structureOffice') {
                renderStructureOfficeOptions();
            }
        }
    }
}

function renderTimezoneOptions(filter = '') {
    const container = document.getElementById('timezoneOptions');
    const selectedValue = document.getElementById('officeTimezone').value;
    const filterLower = filter.toLowerCase();

    const filtered = TIMEZONES.filter(tz =>
        tz.value.toLowerCase().includes(filterLower) ||
        tz.label.toLowerCase().includes(filterLower)
    );

    if (filtered.length === 0) {
        container.innerHTML = '<div class="dropdown-no-match">No timezones found</div>';
        return;
    }

    container.innerHTML = filtered.map(tz => `
        <div class="dropdown-option ${tz.value === selectedValue ? 'selected' : ''}"
             onclick="selectTimezone('${tz.value}', '${escapeHtml(tz.label)}')">
            <span class="dropdown-option-text">${escapeHtml(tz.label)}</span>
        </div>
    `).join('');
}

function selectTimezone(value, label) {
    document.getElementById('officeTimezone').value = value;
    document.getElementById('timezoneSelection').textContent = label;
    document.getElementById('timezoneSelection').classList.remove('placeholder');
    document.getElementById('timezoneDropdown').classList.remove('open');
}

function filterTimezones() {
    const searchValue = document.getElementById('timezoneSearch').value;
    renderTimezoneOptions(searchValue);
}

function renderCountryOptions(filter = '') {
    const container = document.getElementById('countryOptions');
    const selectedValue = document.getElementById('officeCountry').value;
    const filterLower = filter.toLowerCase();

    const filtered = COUNTRIES.filter(c =>
        c.value.toLowerCase().includes(filterLower) ||
        c.code.toLowerCase().includes(filterLower)
    );

    if (filtered.length === 0) {
        container.innerHTML = '<div class="dropdown-no-match">No countries found</div>';
        return;
    }

    container.innerHTML = filtered.map(c => `
        <div class="dropdown-option ${c.value === selectedValue ? 'selected' : ''}"
             onclick="selectCountry('${c.value}')">
            <span class="dropdown-option-text">${escapeHtml(c.value)}</span>
            <span class="dropdown-option-subtext">${c.code}</span>
        </div>
    `).join('');
}

function selectCountry(value) {
    document.getElementById('officeCountry').value = value;
    document.getElementById('countrySelection').textContent = value;
    document.getElementById('countrySelection').classList.remove('placeholder');
    document.getElementById('countryDropdown').classList.remove('open');
}

function filterCountries() {
    const searchValue = document.getElementById('countrySearch').value;
    renderCountryOptions(searchValue);
}

// Structure Office searchable dropdown functions
function renderStructureOfficeOptions(filter = '') {
    const container = document.getElementById('structureOfficeOptions');
    if (!container) return;

    const selectedValue = document.getElementById('structureOffice').value;
    const filterLower = filter.toLowerCase();

    const filtered = offices.filter(o =>
        o.office_name.toLowerCase().includes(filterLower) ||
        (o.office_code && o.office_code.toLowerCase().includes(filterLower)) ||
        (o.city && o.city.toLowerCase().includes(filterLower))
    );

    if (filtered.length === 0) {
        container.innerHTML = '<div class="dropdown-no-match">No offices found</div>';
        return;
    }

    container.innerHTML = filtered.map(o => `
        <div class="dropdown-option ${o.id === selectedValue ? 'selected' : ''}"
             onclick="selectStructureOffice('${o.id}', '${escapeHtml(o.office_name)}')">
            <span class="dropdown-option-text">${escapeHtml(o.office_name)}</span>
            <span class="dropdown-option-subtext">${escapeHtml(o.office_code || '')}</span>
        </div>
    `).join('');
}

function selectStructureOffice(value, label) {
    document.getElementById('structureOffice').value = value;
    document.getElementById('structureOfficeSelection').textContent = label;
    document.getElementById('structureOfficeSelection').classList.remove('placeholder');
    document.getElementById('structureOfficeDropdown').classList.remove('open');
}

function filterStructureOffices() {
    const searchValue = document.getElementById('structureOfficeSearch').value;
    renderStructureOfficeOptions(searchValue);
}

// Initialize structure modal office dropdown
function initStructureOfficeDropdown(selectedOfficeId = '') {
    const selection = document.getElementById('structureOfficeSelection');
    const hiddenInput = document.getElementById('structureOffice');

    if (!selection || !hiddenInput) {
        console.warn('Structure office dropdown elements not found');
        return;
    }

    if (selectedOfficeId) {
        const office = offices.find(o => o.id === selectedOfficeId);
        if (office) {
            hiddenInput.value = office.id;
            selection.textContent = office.office_name;
            selection.classList.remove('placeholder');
        } else {
            hiddenInput.value = '';
            selection.textContent = 'Select Office';
            selection.classList.add('placeholder');
        }
    } else {
        hiddenInput.value = '';
        selection.textContent = 'Select Office';
        selection.classList.add('placeholder');
    }
}

// Initialize office modal dropdowns
function initOfficeModalDropdowns(selectedTimezone = 'Asia/Kolkata', selectedCountry = 'India') {
    // Initialize timezone dropdown
    const tz = TIMEZONES.find(t => t.value === selectedTimezone);
    if (tz) {
        document.getElementById('officeTimezone').value = tz.value;
        document.getElementById('timezoneSelection').textContent = tz.label;
        document.getElementById('timezoneSelection').classList.remove('placeholder');
    } else {
        document.getElementById('officeTimezone').value = '';
        document.getElementById('timezoneSelection').textContent = 'Select Timezone';
        document.getElementById('timezoneSelection').classList.add('placeholder');
    }

    // Initialize country dropdown
    if (selectedCountry) {
        document.getElementById('officeCountry').value = selectedCountry;
        document.getElementById('countrySelection').textContent = selectedCountry;
        document.getElementById('countrySelection').classList.remove('placeholder');
    } else {
        document.getElementById('officeCountry').value = '';
        document.getElementById('countrySelection').textContent = 'Select Country';
        document.getElementById('countrySelection').classList.add('placeholder');
    }

    renderTimezoneOptions();
    renderCountryOptions();
}

// Close dropdowns when clicking outside
document.addEventListener('click', function(e) {
    if (!e.target.closest('.searchable-dropdown')) {
        document.querySelectorAll('.searchable-dropdown.open').forEach(d => {
            d.classList.remove('open');
        });
    }
});

// Helper to check if user can edit (HR Admin)
function canEditOrganization() {
    return hrmsRoles.canEditOrganization();
}

// Modal helper functions
function openModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.classList.add('active');
    }
}

function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.classList.remove('active');
    }
}

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

        // Initialize RBAC
        hrmsRoles.init();

        // Check if user has access to organization page
        if (!hrmsRoles.canAccessOrganization()) {
            showToast('You do not have access to the Organization page', 'error');
            window.location.href = 'dashboard.html';
            return;
        }

        currentUser = api.getUser();

        if (!currentUser) {
            window.location.href = '../login.html';
            return;
        }

        // Apply RBAC visibility
        applyOrganizationRBAC();

        // Setup tabs
        setupTabs();

        // Load all data
        await loadAllData();

        // Update departments table again now that designations are loaded
        // (needed because departments table shows designation count)
        updateDepartmentsTable();

        hideLoading();
    } catch (error) {
        console.error('Error initializing page:', error);
        showToast('Failed to load page data', 'error');
        hideLoading();
    }
}

/**
 * Apply RBAC visibility to organization page elements
 */
function applyOrganizationRBAC() {
    const canEdit = canEditOrganization();

    // Hide all "Add" buttons if user can't edit
    const addButtons = [
        'createOfficeBtn', 'createDepartmentBtn', 'createDesignationBtn',
        'createShiftBtn', 'createRosterBtn', 'createHolidayBtn',
        'createStructureBtn', 'createComponentBtn'
    ];

    addButtons.forEach(btnId => {
        hrmsRoles.setElementVisibility(btnId, canEdit);
    });

    console.log('Organization RBAC applied:', {
        canAccessOrganization: hrmsRoles.canAccessOrganization(),
        canEditOrganization: canEdit,
        roles: hrmsRoles.getDebugInfo()
    });
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

            // Re-render table when switching tabs to fix race condition with office names
            if (tabId === 'holidays') {
                updateHolidaysTable();
            }

            // Load tax data when switching to location-taxes tab
            if (tabId === 'location-taxes') {
                loadTaxTypes();
                loadOfficeTaxRules();
            }

            // Load salary components when switching to salary-components tab
            if (tabId === 'salary-components') {
                loadComponents();
            }

            // Load salary structures when switching to salary-structures tab
            // Also load components so they can be added to structures
            if (tabId === 'salary-structures') {
                loadComponents();
                loadSalaryStructures();
            }
        });
    });

    // Setup sub-tabs for Location Taxes
    setupSubTabs();
}

function setupSubTabs() {
    const subTabBtns = document.querySelectorAll('.sub-tab-btn');
    subTabBtns.forEach(btn => {
        btn.addEventListener('click', function() {
            const subtabId = this.dataset.subtab;

            // Update button states
            subTabBtns.forEach(b => b.classList.remove('active'));
            this.classList.add('active');

            // Update content visibility
            document.querySelectorAll('.sub-tab-content').forEach(c => c.classList.remove('active'));
            document.getElementById(subtabId).classList.add('active');
        });
    });
}

async function loadAllData() {
    await Promise.all([
        loadOffices(),
        loadDepartments(),
        loadDesignations(),
        loadShifts(),
        loadShiftRosters(),
        loadHolidays()
    ]);

    // Load employees only if user can edit (for department head selection, etc.)
    if (canEditOrganization()) {
        await loadEmployees();
    }
}

async function loadOffices() {
    try {
        const showInactive = document.getElementById('showInactiveOffices')?.checked || false;
        const response = await api.request(`/hrms/offices?includeInactive=${showInactive}`);
        offices = Array.isArray(response) ? response : (response?.data || []);

        // Update stats by office type (with null checks for when not on Offices tab)
        const totalOfficesEl = document.getElementById('totalOffices');
        const headOfficeCountEl = document.getElementById('headOfficeCount');
        const regionalOfficeCountEl = document.getElementById('regionalOfficeCount');
        const branchOfficeCountEl = document.getElementById('branchOfficeCount');
        const satelliteOfficeCountEl = document.getElementById('satelliteOfficeCount');

        if (totalOfficesEl) totalOfficesEl.textContent = offices.length;
        if (headOfficeCountEl) headOfficeCountEl.textContent = offices.filter(o => o.office_type === 'head').length;
        if (regionalOfficeCountEl) regionalOfficeCountEl.textContent = offices.filter(o => o.office_type === 'regional').length;
        if (branchOfficeCountEl) branchOfficeCountEl.textContent = offices.filter(o => o.office_type === 'branch' || !o.office_type).length;
        if (satelliteOfficeCountEl) satelliteOfficeCountEl.textContent = offices.filter(o => o.office_type === 'satellite').length;

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
            <td><strong>${escapeHtml(office.office_name)}</strong></td>
            <td><code>${escapeHtml(office.office_code)}</code></td>
            <td><span class="badge badge-${escapeHtml(badgeClass)}">${escapeHtml(officeType)}</span></td>
            <td>${escapeHtml(office.city || '')}, ${escapeHtml(office.country || '')}</td>
            <td>${office.employee_count || 0}</td>
            <td><span class="status-badge status-${office.is_active ? 'active' : 'inactive'}">${office.is_active ? 'Active' : 'Inactive'}</span></td>
            <td>
                <div class="action-buttons">
                    <button class="action-btn" onclick="editOffice('${escapeHtml(office.id)}')" data-tooltip="Edit Office">
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
    const selects = ['departmentOffice', 'deptOffice', 'desigOffice', 'shiftOffice', 'shiftOfficeId', 'holidayOffice', 'holidayOffices', 'structureOffice', 'structureOfficeFilter'];
    selects.forEach(id => {
        const select = document.getElementById(id);
        if (select) {
            // Special handling for filter dropdowns - show "All Offices" as first option
            let firstOption;
            if (id === 'holidayOffices') {
                firstOption = '<option value="">All Offices (National Holiday)</option>';
            } else if (id === 'structureOfficeFilter') {
                firstOption = '<option value="">All Offices</option>';
            } else {
                firstOption = '<option value="">Select Office</option>';
            }
            select.innerHTML = firstOption;
            offices.filter(o => o.is_active).forEach(office => {
                select.innerHTML += `<option value="${escapeHtml(office.id)}">${escapeHtml(office.office_name)}</option>`;
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

    tbody.innerHTML = filtered.map(dept => {
        // Count designations for this department
        const designationCount = allDesignations.filter(d => d.department_id === dept.id).length;
        const hasNoDesignations = designationCount === 0;
        const rowClass = hasNoDesignations ? 'class="no-designations-warning"' : '';

        return `
        <tr ${rowClass}>
            <td><strong>${escapeHtml(dept.department_name)}</strong></td>
            <td><code>${escapeHtml(dept.department_code)}</code></td>
            <td>${escapeHtml(dept.office_name || '-')}</td>
            <td>${hasNoDesignations ? '<span class="designation-count-zero">0 ⚠️</span>' : `<span class="designation-count">${designationCount}</span>`}</td>
            <td>${dept.employee_count || 0}</td>
            <td><span class="status-badge status-${dept.is_active ? 'active' : 'inactive'}">${dept.is_active ? 'Active' : 'Inactive'}</span></td>
            <td>
                <div class="action-buttons">
                    <button class="action-btn" onclick="editDepartment('${escapeHtml(dept.id)}')" data-tooltip="Edit Department">
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

function populateDepartmentSelects() {
    const activeDepts = departments.filter(d => d.is_active);
    const activeOffices = offices.filter(o => o.is_active);

    // Office filter dropdown - with "All Offices" option
    const officeFilterSelect = document.getElementById('designationOffice');
    if (officeFilterSelect) {
        if (activeOffices.length === 0) {
            officeFilterSelect.innerHTML = '<option value="">No Offices</option>';
        } else {
            officeFilterSelect.innerHTML = '<option value="">All Offices</option>';
            activeOffices.forEach(office => {
                officeFilterSelect.innerHTML += `<option value="${escapeHtml(office.id)}">${escapeHtml(office.office_name)}</option>`;
            });
        }
    }

    // Department filter dropdown - with "All Departments" option
    const filterSelect = document.getElementById('designationDepartment');
    if (filterSelect) {
        if (activeDepts.length === 0) {
            filterSelect.innerHTML = '<option value="">No Departments</option>';
        } else {
            filterSelect.innerHTML = '<option value="">All Departments</option>';
            activeDepts.forEach(dept => {
                filterSelect.innerHTML += `<option value="${escapeHtml(dept.id)}">${escapeHtml(dept.department_name)}</option>`;
            });
        }
        // Trigger filter update after dropdown is populated
        updateDesignationsTable();
    }

    // Modal dropdown - requires specific department selection
    const modalSelect = document.getElementById('desigDepartment');
    if (modalSelect) {
        modalSelect.innerHTML = '<option value="">Select Department *</option>';
        activeDepts.forEach(dept => {
            modalSelect.innerHTML += `<option value="${escapeHtml(dept.id)}">${escapeHtml(dept.department_name)}</option>`;
        });
    }
}

// ==========================================
// Department Hierarchy View Functions
// ==========================================

let currentDepartmentView = 'table';

function switchDepartmentView(view) {
    currentDepartmentView = view;

    // Update toggle buttons
    document.getElementById('tableViewBtn').classList.toggle('active', view === 'table');
    document.getElementById('treeViewBtn').classList.toggle('active', view === 'tree');

    // Show/hide views
    const tableContainer = document.getElementById('departmentTableContainer');
    const hierarchyContainer = document.getElementById('departmentHierarchy');

    if (view === 'table') {
        tableContainer.style.display = 'block';
        hierarchyContainer.style.display = 'none';
    } else {
        tableContainer.style.display = 'none';
        hierarchyContainer.style.display = 'block';
        renderDepartmentHierarchy();
    }
}

function renderDepartmentHierarchy() {
    const container = document.getElementById('hierarchyTree');
    const officeFilter = document.getElementById('departmentOffice')?.value || '';

    let filteredDepts = [...departments];
    if (officeFilter) {
        filteredDepts = filteredDepts.filter(d => d.office_id === officeFilter);
    }

    if (filteredDepts.length === 0) {
        container.innerHTML = `
            <div class="hierarchy-empty">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">
                    <rect x="2" y="7" width="20" height="14" rx="2" ry="2"></rect>
                    <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"></path>
                </svg>
                <p>No departments to display</p>
            </div>`;
        return;
    }

    // Build hierarchy structure
    const hierarchyMap = buildDepartmentHierarchy(filteredDepts);

    // Render tree
    container.innerHTML = `<div class="tree-root">${renderHierarchyNodes(hierarchyMap.roots, hierarchyMap.childrenMap)}</div>`;

    // Add event listeners for expand/collapse
    container.querySelectorAll('.tree-toggle').forEach(toggle => {
        toggle.addEventListener('click', (e) => {
            e.stopPropagation();
            const nodeId = toggle.dataset.id;
            toggleHierarchyNode(nodeId);
        });
    });
}

function buildDepartmentHierarchy(depts) {
    const childrenMap = new Map();
    const roots = [];

    // Initialize children map
    depts.forEach(dept => {
        childrenMap.set(dept.id, []);
    });

    // Build parent-child relationships
    depts.forEach(dept => {
        if (dept.parent_department_id && childrenMap.has(dept.parent_department_id)) {
            childrenMap.get(dept.parent_department_id).push(dept);
        } else {
            roots.push(dept);
        }
    });

    return { roots, childrenMap };
}

function renderHierarchyNodes(depts, childrenMap, level = 0) {
    return depts.map(dept => {
        const children = childrenMap.get(dept.id) || [];
        const hasChildren = children.length > 0;
        const designationCount = allDesignations.filter(d => d.department_id === dept.id).length;

        return `
        <div class="tree-node" data-id="${dept.id}">
            <div class="tree-node-content" onclick="editDepartment('${dept.id}')">
                <span class="tree-toggle ${hasChildren ? '' : 'no-children'}" data-id="${dept.id}">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="9 18 15 12 9 6"></polyline>
                    </svg>
                </span>
                <span class="tree-node-icon">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <rect x="2" y="7" width="20" height="14" rx="2" ry="2"></rect>
                        <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"></path>
                    </svg>
                </span>
                <div class="tree-node-info">
                    <div class="tree-node-name">${escapeHtml(dept.department_name)}</div>
                    <div class="tree-node-meta">
                        <span>Code: ${escapeHtml(dept.department_code)}</span>
                        <span>${dept.employee_count || 0} employees</span>
                        <span>${designationCount} designations</span>
                    </div>
                </div>
                <span class="tree-node-badge ${dept.is_active ? '' : 'inactive'}">
                    ${dept.is_active ? 'Active' : 'Inactive'}
                </span>
                <div class="tree-node-actions">
                    <button class="action-btn" onclick="event.stopPropagation(); editDepartment('${dept.id}')" title="Edit">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                        </svg>
                    </button>
                </div>
            </div>
            ${hasChildren ? `<div class="tree-children collapsed" data-parent="${dept.id}">${renderHierarchyNodes(children, childrenMap, level + 1)}</div>` : ''}
        </div>`;
    }).join('');
}

function toggleHierarchyNode(nodeId) {
    const toggle = document.querySelector(`.tree-toggle[data-id="${nodeId}"]`);
    const children = document.querySelector(`.tree-children[data-parent="${nodeId}"]`);
    const nodeContent = toggle.closest('.tree-node-content');

    if (toggle && children) {
        const isExpanded = !children.classList.contains('collapsed');
        children.classList.toggle('collapsed');
        toggle.classList.toggle('expanded');
        nodeContent.classList.toggle('expanded');

        // Update toggle icon rotation
        const svg = toggle.querySelector('svg');
        svg.style.transform = isExpanded ? 'rotate(0deg)' : 'rotate(90deg)';
    }
}

// ==========================================
// End Department Hierarchy View Functions
// ==========================================

async function loadDesignations() {
    try {
        const response = await api.request('/hrms/designations');
        allDesignations = Array.isArray(response) ? response : (response?.data || []);
        updateDesignationsTable();
    } catch (error) {
        console.error('Error loading designations:', error);
    }
}

function updateDesignationsTable() {
    const tbody = document.getElementById('designationsTable');
    const searchTerm = document.getElementById('designationSearch')?.value?.toLowerCase() || '';
    const officeFilter = document.getElementById('designationOffice')?.value || '';
    const deptFilter = document.getElementById('designationDepartment')?.value || '';

    let filtered = allDesignations.filter(d =>
        d.designation_name?.toLowerCase().includes(searchTerm) ||
        d.designation_code?.toLowerCase().includes(searchTerm)
    );

    if (officeFilter) {
        filtered = filtered.filter(d => d.office_id === officeFilter);
    }

    if (deptFilter) {
        filtered = filtered.filter(d => d.department_id === deptFilter);
    }

    if (filtered.length === 0) {
        tbody.innerHTML = `
            <tr class="empty-state">
                <td colspan="10">
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
            <td><strong>${escapeHtml(desig.designation_name)}</strong></td>
            <td><code>${escapeHtml(desig.designation_code)}</code></td>
            <td>${escapeHtml(desig.office_name || '-')}</td>
            <td>${escapeHtml(desig.department_name || '-')}</td>
            <td>${escapeHtml(desig.role_category || '-')}</td>
            <td>Level ${desig.level || 1}</td>
            <td>${formatHrmsRoles(desig.default_hrms_roles)}</td>
            <td>${desig.employee_count || 0}</td>
            <td><span class="status-badge status-${desig.is_active ? 'active' : 'inactive'}">${desig.is_active ? 'Active' : 'Inactive'}</span></td>
            <td>
                <div class="action-buttons">
                    <button class="action-btn" onclick="editDesignation('${escapeHtml(desig.id)}')" data-tooltip="Edit Designation">
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
                <td colspan="8">
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

    tbody.innerHTML = filtered.map(shift => {
        // Format weekend days for display
        const weekendDays = formatWeekendDays(shift.weekend_days);
        return `
        <tr>
            <td><strong>${escapeHtml(shift.shift_name)}</strong></td>
            <td><code>${escapeHtml(shift.shift_code)}</code></td>
            <td>${escapeHtml(shift.office_name || '-')}</td>
            <td>${escapeHtml(formatTime(shift.start_time))} - ${escapeHtml(formatTime(shift.end_time))}</td>
            <td>${shift.working_hours || calculateWorkingHours(shift.start_time, shift.end_time)} hrs</td>
            <td><span class="weekend-badge">${escapeHtml(weekendDays)}</span></td>
            <td><span class="status-badge status-${shift.is_active ? 'active' : 'inactive'}">${shift.is_active ? 'Active' : 'Inactive'}</span></td>
            <td>
                <div class="action-buttons">
                    <button class="action-btn" onclick="editShift('${escapeHtml(shift.id)}')" data-tooltip="Edit Shift">
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

async function loadShiftRosters() {
    try {
        const response = await api.request('/hrms/shifts/roster');
        shiftRosters = Array.isArray(response) ? response : (response?.data || []);
        updateRostersTable();
        populateRosterFilters();
    } catch (error) {
        console.error('Error loading shift rosters:', error);
    }
}

function updateRostersTable() {
    const tbody = document.getElementById('rostersTable');
    if (!tbody) return;

    const searchTerm = document.getElementById('rosterSearch')?.value?.toLowerCase() || '';
    const officeFilter = document.getElementById('rosterOffice')?.value || '';
    const shiftFilter = document.getElementById('rosterShift')?.value || '';

    let filtered = shiftRosters.filter(r =>
        r.employee_name?.toLowerCase().includes(searchTerm) ||
        r.employee_code?.toLowerCase().includes(searchTerm) ||
        r.shift_name?.toLowerCase().includes(searchTerm)
    );

    if (officeFilter) {
        filtered = filtered.filter(r => r.office_id === officeFilter);
    }

    if (shiftFilter) {
        filtered = filtered.filter(r => r.shift_id === shiftFilter);
    }

    if (filtered.length === 0) {
        tbody.innerHTML = `
            <tr class="empty-state">
                <td colspan="8">
                    <div class="empty-message">
                        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">
                            <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                            <line x1="16" y1="2" x2="16" y2="6"></line>
                            <line x1="8" y1="2" x2="8" y2="6"></line>
                            <line x1="3" y1="10" x2="21" y2="10"></line>
                        </svg>
                        <p>No shift rosters configured</p>
                    </div>
                </td>
            </tr>`;
        return;
    }

    tbody.innerHTML = filtered.map(roster => {
        const weekendDays = formatWeekendDays(roster.weekend_days);
        const rosterTypeClass = getRosterTypeBadgeClass(roster.roster_type);
        const employeeDisplay = roster.employee_name ?
            `${escapeHtml(roster.employee_name)} (${escapeHtml(roster.employee_code || '')})` :
            escapeHtml(roster.employee_code || '-');

        return `
        <tr>
            <td><strong>${employeeDisplay}</strong></td>
            <td>${escapeHtml(roster.shift_name || '-')}</td>
            <td>${escapeHtml(formatDate(roster.start_date))}</td>
            <td>${roster.end_date ? escapeHtml(formatDate(roster.end_date)) : '<span class="text-muted">Ongoing</span>'}</td>
            <td><span class="weekend-badge">${escapeHtml(weekendDays)}</span></td>
            <td><span class="badge ${escapeHtml(rosterTypeClass)}">${escapeHtml(formatRosterType(roster.roster_type))}</span></td>
            <td><span class="status-badge status-${roster.is_active ? 'active' : 'inactive'}">${roster.is_active ? 'Active' : 'Inactive'}</span></td>
            <td>
                <div class="action-buttons">
                    <button class="action-btn" onclick="editRoster('${escapeHtml(roster.id)}')" data-tooltip="Edit Roster">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                        </svg>
                    </button>
                    <button class="action-btn danger" onclick="deleteRoster('${escapeHtml(roster.id)}')" data-tooltip="Delete Roster">
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

function populateRosterFilters() {
    // Populate office filter
    const officeSelect = document.getElementById('rosterOffice');
    if (officeSelect) {
        officeSelect.innerHTML = '<option value="">All Offices</option>';
        offices.filter(o => o.is_active).forEach(office => {
            officeSelect.innerHTML += `<option value="${escapeHtml(office.id)}">${escapeHtml(office.office_name)}</option>`;
        });
    }

    // Populate shift filter
    const shiftSelect = document.getElementById('rosterShift');
    if (shiftSelect) {
        shiftSelect.innerHTML = '<option value="">All Shifts</option>';
        shifts.filter(s => s.is_active).forEach(shift => {
            shiftSelect.innerHTML += `<option value="${escapeHtml(shift.id)}">${escapeHtml(shift.shift_name)}</option>`;
        });
    }
}

function getRosterTypeBadgeClass(type) {
    const classes = {
        'scheduled': 'badge-scheduled',
        'temporary': 'badge-temporary',
        'swap': 'badge-swap',
        'override': 'badge-override'
    };
    return classes[type] || 'badge-scheduled';
}

function formatRosterType(type) {
    const types = {
        'scheduled': 'Scheduled',
        'temporary': 'Temporary',
        'swap': 'Swap',
        'override': 'Override'
    };
    return types[type] || type || 'Scheduled';
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
            <td><strong>${escapeHtml(holiday.holiday_name)}</strong></td>
            <td>${escapeHtml(formatDate(holiday.holiday_date))}</td>
            <td>${escapeHtml(getDayName(holiday.holiday_date))}</td>
            <td><span class="badge badge-${escapeHtml(holiday.holiday_type)}">${escapeHtml(formatHolidayType(holiday.holiday_type))}</span></td>
            <td>${escapeHtml(getOfficeName(holiday.office_id))}</td>
            <td>
                <div class="action-buttons">
                    <button class="action-btn" onclick="editHoliday('${escapeHtml(holiday.id)}')" data-tooltip="Edit Holiday">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                        </svg>
                    </button>
                    <button class="action-btn danger" onclick="deleteHoliday('${escapeHtml(holiday.id)}')" data-tooltip="Delete Holiday">
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
                select.innerHTML += `<option value="${escapeHtml(emp.id)}">${escapeHtml(emp.first_name)} ${escapeHtml(emp.last_name)}</option>`;
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

    // Initialize searchable dropdowns with defaults
    initOfficeModalDropdowns('Asia/Kolkata', 'India');

    // Reset new fields
    document.getElementById('officeEnableGeofence').checked = false;
    document.getElementById('officeIsActive').checked = true;

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

    // Initialize searchable dropdowns with office values
    initOfficeModalDropdowns(office.timezone || 'Asia/Kolkata', office.country || 'India');

    document.getElementById('officeAddress').value = office.address_line1 || '';
    document.getElementById('officeCity').value = office.city || '';
    document.getElementById('officeState').value = office.state || '';
    document.getElementById('officePostalCode').value = office.postal_code || '';
    document.getElementById('officePhone').value = office.phone || '';
    document.getElementById('officeEmail').value = office.email || '';
    document.getElementById('officeLatitude').value = office.latitude || '';
    document.getElementById('officeLongitude').value = office.longitude || '';
    document.getElementById('officeGeofenceRadius').value = office.geofence_radius_meters || 100;

    // Set new toggle fields
    document.getElementById('officeEnableGeofence').checked = office.enable_geofence_attendance === true;
    document.getElementById('officeIsActive').checked = office.is_active !== false;

    document.getElementById('officeModalTitle').textContent = 'Edit Office';
    document.getElementById('officeModal').classList.add('active');
}

function showCreateDepartmentModal() {
    // Require at least one office to exist before creating departments
    if (offices.filter(o => o.is_active).length === 0) {
        showToast('Please create an office first before adding departments', 'error');
        return;
    }

    document.getElementById('departmentForm').reset();
    document.getElementById('departmentId').value = '';

    // Populate office dropdown before showing modal
    populateOfficeSelects();

    document.getElementById('departmentModalTitle').textContent = 'Create Department';
    document.getElementById('departmentModal').classList.add('active');
}

function editDepartment(id) {
    const dept = departments.find(d => d.id === id);
    if (!dept) return;

    // Populate office dropdown before setting the value
    populateOfficeSelects();

    document.getElementById('departmentId').value = dept.id;
    document.getElementById('departmentName').value = dept.department_name;
    document.getElementById('departmentCode').value = dept.department_code;
    document.getElementById('deptOffice').value = dept.office_id || '';
    document.getElementById('deptHead').value = dept.head_employee_id || '';
    document.getElementById('departmentDescription').value = dept.description || '';
    document.getElementById('departmentIsActive').checked = dept.is_active !== false;

    document.getElementById('departmentModalTitle').textContent = 'Edit Department';
    document.getElementById('departmentModal').classList.add('active');
}

function showCreateDesignationModal() {
    // Require at least one office to exist before creating designations
    if (offices.filter(o => o.is_active).length === 0) {
        showToast('Please create an office first before adding designations', 'error');
        return;
    }

    // Require at least one department to exist before creating designations
    if (departments.filter(d => d.is_active).length === 0) {
        showToast('Please create a department first before adding designations', 'error');
        return;
    }

    document.getElementById('designationForm').reset();
    document.getElementById('designationId').value = '';

    // Initialize and reset the nested office-department dropdown
    initNestedOfficeDeptDropdown();
    resetOfficeDeptDropdown();

    // Reset all HRMS role checkboxes (except HRMS_USER which is always checked and disabled)
    resetHrmsRoleCheckboxes();

    document.getElementById('designationModalTitle').textContent = 'Create Designation';
    document.getElementById('designationModal').classList.add('active');
}

// Reset department dropdown to initial state (requires office selection)
function resetDesigDepartmentDropdown() {
    const deptSelect = document.getElementById('desigDepartment');
    if (deptSelect) {
        deptSelect.innerHTML = '<option value="">-- Select Office First --</option>';
        deptSelect.disabled = true;
    }
}

// Filter and populate department dropdown based on selected office
function filterDesigDepartmentsByOffice(officeId) {
    const deptSelect = document.getElementById('desigDepartment');
    if (!deptSelect) return;

    if (!officeId) {
        resetDesigDepartmentDropdown();
        return;
    }

    // Filter departments by the selected office
    const filteredDepts = departments.filter(d => d.is_active && d.office_id === officeId);

    if (filteredDepts.length === 0) {
        deptSelect.innerHTML = '<option value="">-- No Departments in this Office --</option>';
        deptSelect.disabled = true;
        return;
    }

    // Populate with filtered departments
    deptSelect.innerHTML = '<option value="">Select Department *</option>';
    filteredDepts.forEach(dept => {
        deptSelect.innerHTML += `<option value="${escapeHtml(dept.id)}">${escapeHtml(dept.department_name)}</option>`;
    });
    deptSelect.disabled = false;
}

// ============================================
// Nested Office-Department Dropdown Component
// ============================================

let nestedDropdownInitialized = false;

function initNestedOfficeDeptDropdown() {
    const dropdown = document.getElementById('officeDeptDropdown');
    const trigger = document.getElementById('officeDeptTrigger');
    const menu = document.getElementById('officeDeptMenu');
    const searchInput = document.getElementById('officeDeptSearch');

    if (!dropdown || !trigger || nestedDropdownInitialized) return;

    // Toggle dropdown on trigger click
    trigger.addEventListener('click', function(e) {
        e.stopPropagation();
        const isOpen = dropdown.classList.contains('open');
        closeAllNestedDropdowns();
        if (!isOpen) {
            dropdown.classList.add('open');
            searchInput?.focus();
        }
    });

    // Search functionality
    searchInput?.addEventListener('input', function() {
        filterNestedDropdownItems(this.value);
    });

    // Prevent closing when clicking inside menu
    menu?.addEventListener('click', function(e) {
        e.stopPropagation();
    });

    // Close on outside click
    document.addEventListener('click', function() {
        closeAllNestedDropdowns();
    });

    nestedDropdownInitialized = true;
}

function closeAllNestedDropdowns() {
    document.querySelectorAll('.nested-dropdown.open').forEach(dd => {
        dd.classList.remove('open');
    });
}

function populateNestedOfficeDeptDropdown(selectedOfficeId = '', selectedDeptId = '') {
    const container = document.getElementById('officeDeptItems');
    if (!container) return;

    const activeOffices = offices.filter(o => o.is_active);

    if (activeOffices.length === 0) {
        container.innerHTML = `
            <div class="dropdown-no-results">
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                    <path d="M3 21h18"></path>
                    <path d="M9 8h1"></path><path d="M9 12h1"></path><path d="M9 16h1"></path>
                    <path d="M14 8h1"></path><path d="M14 12h1"></path><path d="M14 16h1"></path>
                    <path d="M5 21V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16"></path>
                </svg>
                <p>No offices configured yet</p>
            </div>`;
        return;
    }

    let html = '';
    activeOffices.forEach(office => {
        const officeDepts = departments.filter(d => d.is_active && d.office_id === office.id);
        const deptCount = officeDepts.length;
        const isExpanded = office.id === selectedOfficeId || deptCount <= 3;

        html += `
            <div class="dropdown-office-group ${isExpanded ? 'expanded' : ''}" data-office-id="${escapeHtml(office.id)}">
                <div class="dropdown-office-header" onclick="toggleOfficeGroup('${escapeHtml(office.id)}')">
                    <svg class="office-expand-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="9 18 15 12 9 6"></polyline>
                    </svg>
                    <div class="office-icon">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M3 21h18"></path>
                            <path d="M5 21V7l8-4v18"></path>
                            <path d="M19 21V11l-6-4"></path>
                            <path d="M9 9v.01"></path><path d="M9 12v.01"></path><path d="M9 15v.01"></path><path d="M9 18v.01"></path>
                        </svg>
                    </div>
                    <div class="office-info">
                        <div class="office-name">${escapeHtml(office.office_name)}</div>
                        <div class="office-dept-count">${deptCount} department${deptCount !== 1 ? 's' : ''}</div>
                    </div>
                </div>
                <div class="dropdown-departments">`;

        if (deptCount === 0) {
            html += `
                <div class="dropdown-dept-item" style="cursor: default; opacity: 0.6;">
                    <div class="dept-info">
                        <span class="dept-name" style="font-style: italic;">No departments in this office</span>
                    </div>
                </div>`;
        } else {
            officeDepts.forEach(dept => {
                const isSelected = dept.id === selectedDeptId;
                html += `
                    <div class="dropdown-dept-item ${isSelected ? 'selected' : ''}"
                         data-office-id="${escapeHtml(office.id)}"
                         data-dept-id="${escapeHtml(dept.id)}"
                         onclick="selectOfficeDepartment('${escapeHtml(office.id)}', '${escapeHtml(dept.id)}', '${escapeHtml(office.office_name)}', '${escapeHtml(dept.department_name)}')">
                        <div class="dept-radio"></div>
                        <div class="dept-info">
                            <span class="dept-name">${escapeHtml(dept.department_name)}</span>
                            <span class="dept-code">${escapeHtml(dept.department_code)}</span>
                        </div>
                    </div>`;
            });
        }

        html += `
                </div>
            </div>`;
    });

    container.innerHTML = html;

    // Update selection text and hidden inputs if we have selected values
    if (selectedOfficeId && selectedDeptId) {
        const office = offices.find(o => o.id === selectedOfficeId);
        const dept = departments.find(d => d.id === selectedDeptId);
        if (office && dept) {
            updateOfficeDeptSelectionText(office.office_name, dept.department_name);
            // Also set the hidden input values (critical for save to work)
            document.getElementById('desigOffice').value = selectedOfficeId;
            document.getElementById('desigDepartment').value = selectedDeptId;
        }
    }
}

function toggleOfficeGroup(officeId) {
    const group = document.querySelector(`.dropdown-office-group[data-office-id="${officeId}"]`);
    if (group) {
        group.classList.toggle('expanded');
    }
}

function selectOfficeDepartment(officeId, deptId, officeName, deptName) {
    // Update hidden inputs
    document.getElementById('desigOffice').value = officeId;
    document.getElementById('desigDepartment').value = deptId;

    // Update selection text
    updateOfficeDeptSelectionText(officeName, deptName);

    // Update visual selection
    document.querySelectorAll('.dropdown-dept-item').forEach(item => {
        item.classList.remove('selected');
    });
    const selectedItem = document.querySelector(`.dropdown-dept-item[data-dept-id="${deptId}"]`);
    if (selectedItem) {
        selectedItem.classList.add('selected');
    }

    // Close dropdown
    closeAllNestedDropdowns();
}

function updateOfficeDeptSelectionText(officeName, deptName) {
    const textEl = document.getElementById('officeDeptSelectionText');
    if (textEl) {
        textEl.textContent = `${officeName} → ${deptName}`;
        textEl.classList.add('has-value');
    }
}

function resetOfficeDeptDropdown() {
    const textEl = document.getElementById('officeDeptSelectionText');
    if (textEl) {
        textEl.textContent = 'Select Office & Department';
        textEl.classList.remove('has-value');
    }
    document.getElementById('desigOffice').value = '';
    document.getElementById('desigDepartment').value = '';

    // Clear search
    const searchInput = document.getElementById('officeDeptSearch');
    if (searchInput) {
        searchInput.value = '';
    }

    // Repopulate without selection
    populateNestedOfficeDeptDropdown();
}

function filterNestedDropdownItems(searchTerm) {
    const container = document.getElementById('officeDeptItems');
    if (!container) return;

    const term = searchTerm.toLowerCase().trim();

    if (!term) {
        // Show all items
        container.querySelectorAll('.dropdown-office-group').forEach(group => {
            group.style.display = '';
            group.querySelectorAll('.dropdown-dept-item').forEach(item => {
                item.style.display = '';
            });
        });
        return;
    }

    let hasResults = false;

    container.querySelectorAll('.dropdown-office-group').forEach(group => {
        const officeId = group.dataset.officeId;
        const office = offices.find(o => o.id === officeId);
        const officeName = office?.office_name?.toLowerCase() || '';
        const officeMatches = officeName.includes(term);

        let groupHasVisibleDept = false;

        group.querySelectorAll('.dropdown-dept-item[data-dept-id]').forEach(item => {
            const deptId = item.dataset.deptId;
            const dept = departments.find(d => d.id === deptId);
            const deptName = dept?.department_name?.toLowerCase() || '';
            const deptCode = dept?.department_code?.toLowerCase() || '';

            const deptMatches = deptName.includes(term) || deptCode.includes(term);

            if (officeMatches || deptMatches) {
                item.style.display = '';
                groupHasVisibleDept = true;
            } else {
                item.style.display = 'none';
            }
        });

        if (officeMatches || groupHasVisibleDept) {
            group.style.display = '';
            group.classList.add('expanded'); // Auto-expand when searching
            hasResults = true;
        } else {
            group.style.display = 'none';
        }
    });

    // Show no results message if needed
    let noResultsEl = container.querySelector('.dropdown-no-results-search');
    if (!hasResults) {
        if (!noResultsEl) {
            noResultsEl = document.createElement('div');
            noResultsEl.className = 'dropdown-no-results dropdown-no-results-search';
            noResultsEl.innerHTML = `
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                    <circle cx="11" cy="11" r="8"></circle>
                    <path d="m21 21-4.35-4.35"></path>
                </svg>
                <p>No matching offices or departments</p>`;
            container.appendChild(noResultsEl);
        }
        noResultsEl.style.display = '';
    } else if (noResultsEl) {
        noResultsEl.style.display = 'none';
    }
}

// Helper function to reset all HRMS role checkboxes
function resetHrmsRoleCheckboxes() {
    const roleCheckboxes = document.querySelectorAll('input[name="hrmsRoles"]');
    roleCheckboxes.forEach(cb => {
        if (cb.value === 'HRMS_USER') {
            cb.checked = true; // Always checked
        } else {
            cb.checked = false;
        }
    });
}

// Helper function to set HRMS role checkboxes from an array
function setHrmsRoleCheckboxes(roles) {
    const roleArray = roles || ['HRMS_USER'];
    const roleCheckboxes = document.querySelectorAll('input[name="hrmsRoles"]');
    roleCheckboxes.forEach(cb => {
        if (cb.value === 'HRMS_USER') {
            cb.checked = true; // Always checked
        } else {
            cb.checked = roleArray.includes(cb.value);
        }
    });
}

// Helper function to get selected HRMS roles as an array
function getSelectedHrmsRoles() {
    const roleCheckboxes = document.querySelectorAll('input[name="hrmsRoles"]:checked');
    const roles = Array.from(roleCheckboxes).map(cb => cb.value);
    // Ensure HRMS_USER is always included
    if (!roles.includes('HRMS_USER')) {
        roles.unshift('HRMS_USER');
    }
    return roles;
}

// Helper function to format HRMS roles for table display
function formatHrmsRoles(roles) {
    if (!roles || roles.length === 0) {
        return '<span class="role-tag role-user">USER</span>';
    }

    // Short display names for roles
    const roleShortNames = {
        'HRMS_USER': 'USER',
        'HRMS_MANAGER': 'MGR',
        'HRMS_ADMIN': 'ADMIN',
        'HRMS_HR_USER': 'HR',
        'HRMS_HR_ADMIN': 'HR_ADMIN',
        'HRMS_HR_MANAGER': 'HR_MGR'
    };

    // CSS classes for different role types
    const roleClasses = {
        'HRMS_USER': 'role-user',
        'HRMS_MANAGER': 'role-manager',
        'HRMS_ADMIN': 'role-admin',
        'HRMS_HR_USER': 'role-hr',
        'HRMS_HR_ADMIN': 'role-hr-admin',
        'HRMS_HR_MANAGER': 'role-hr-manager'
    };

    return roles.map(role => {
        const shortName = roleShortNames[role] || role.replace('HRMS_', '');
        const cssClass = roleClasses[role] || 'role-default';
        return `<span class="role-tag ${cssClass}">${escapeHtml(shortName)}</span>`;
    }).join(' ');
}

function editDesignation(id) {
    const desig = allDesignations.find(d => d.id === id);
    if (!desig) return;

    document.getElementById('designationId').value = desig.id;
    document.getElementById('designationName').value = desig.designation_name;
    document.getElementById('designationCode').value = desig.designation_code;

    // Initialize and populate the nested office-department dropdown with selection
    initNestedOfficeDeptDropdown();
    populateNestedOfficeDeptDropdown(desig.office_id || '', desig.department_id || '');

    document.getElementById('desigLevel').value = desig.level || 1;
    document.getElementById('desigCategory').value = desig.role_category || '';

    // Set HRMS role checkboxes based on default_hrms_roles array
    setHrmsRoleCheckboxes(desig.default_hrms_roles);

    document.getElementById('designationDescription').value = desig.description || '';
    document.getElementById('designationIsActive').checked = desig.is_active !== false;

    document.getElementById('designationModalTitle').textContent = 'Edit Designation';
    document.getElementById('designationModal').classList.add('active');
}

function showCreateShiftModal() {
    // Require at least one office to exist before creating shifts
    if (offices.filter(o => o.is_active).length === 0) {
        showToast('Please create an office first before adding shifts', 'error');
        return;
    }

    document.getElementById('shiftForm').reset();
    document.getElementById('shiftId').value = '';
    document.getElementById('shiftEnableGeofence').checked = false;
    document.getElementById('shiftModalTitle').textContent = 'Create Shift';
    document.getElementById('shiftModal').classList.add('active');

    // Populate the office dropdown
    populateOfficeSelects();

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
    document.getElementById('graceMinutes').value = shift.grace_period_minutes || 15;
    document.getElementById('halfDayHours').value = shift.half_day_hours || 4;
    document.getElementById('shiftIsActive').checked = shift.is_active !== false;
    document.getElementById('shiftEnableGeofence').checked = shift.enable_geofence_attendance || false;

    // Set working days checkboxes
    // working_days comes from backend as comma-separated string (e.g., "Mon,Tue,Wed,Thu,Fri")
    // Checkbox values are lowercase full names (monday, tuesday, etc.)
    const dayMapping = {
        'Mon': 'monday', 'Tue': 'tuesday', 'Wed': 'wednesday',
        'Thu': 'thursday', 'Fri': 'friday', 'Sat': 'saturday', 'Sun': 'sunday'
    };
    let workingDays = shift.working_days || "Mon,Tue,Wed,Thu,Fri";
    if (typeof workingDays === 'string') {
        workingDays = workingDays.split(',').map(d => dayMapping[d.trim()] || d.trim().toLowerCase());
    }
    document.querySelectorAll('input[name="workingDays"]').forEach(cb => {
        cb.checked = workingDays.includes(cb.value);
    });

    document.getElementById('shiftModalTitle').textContent = 'Edit Shift';
    document.getElementById('shiftModal').classList.add('active');

    // Populate office dropdown then set the value
    populateOfficeSelects();
    document.getElementById('shiftOfficeId').value = shift.office_id || '';

    // Initialize time pickers and set values
    initTimePickers();
    setTimePickerValue('shiftStart', shift.start_time || '09:00');
    setTimePickerValue('shiftEnd', shift.end_time || '18:00');
    setTimePickerValue('breakStart', shift.break_start || '13:00');
    setTimePickerValue('breakEnd', shift.break_end || '14:00');
}

function showCreateHolidayModal() {
    // Require at least one office to exist before creating holidays
    if (offices.filter(o => o.is_active).length === 0) {
        showToast('Please create an office first before adding holidays', 'error');
        return;
    }

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

    // Set selected office (single selection now)
    const officeSelect = document.getElementById('holidayOffices');
    officeSelect.value = holiday.office_id || '';

    document.getElementById('holidayModalTitle').textContent = 'Edit Holiday';
    document.getElementById('holidayModal').classList.add('active');
}

function showCreateRosterModal() {
    // Require at least one shift to exist before creating rosters
    if (shifts.filter(s => s.is_active).length === 0) {
        showToast('Please create a shift first before assigning rosters', 'error');
        return;
    }

    // Require employees to exist
    if (employees.length === 0) {
        showToast('No employees found. Please add employees first.', 'error');
        return;
    }

    document.getElementById('rosterForm').reset();
    document.getElementById('rosterId').value = '';
    document.getElementById('rosterIsActive').checked = true;

    // Populate employee dropdown
    populateRosterEmployeeSelect();

    // Populate shift dropdown
    populateRosterShiftSelect();

    // Set default start date to today
    document.getElementById('rosterStartDate').value = new Date().toISOString().split('T')[0];

    document.getElementById('rosterModalTitle').textContent = 'Assign Shift Roster';
    document.getElementById('rosterModal').classList.add('active');
}

function editRoster(id) {
    const roster = shiftRosters.find(r => r.id === id);
    if (!roster) return;

    // Populate dropdowns first
    populateRosterEmployeeSelect();
    populateRosterShiftSelect();

    document.getElementById('rosterId').value = roster.id;
    document.getElementById('rosterEmployee').value = roster.employee_id || '';
    document.getElementById('rosterShiftId').value = roster.shift_id || '';
    document.getElementById('rosterStartDate').value = roster.start_date?.split('T')[0] || '';
    document.getElementById('rosterEndDate').value = roster.end_date?.split('T')[0] || '';
    document.getElementById('rosterType').value = roster.roster_type || 'scheduled';
    document.getElementById('rosterNotes').value = roster.notes || '';
    document.getElementById('rosterIsActive').checked = roster.is_active !== false;

    document.getElementById('rosterModalTitle').textContent = 'Edit Shift Roster';
    document.getElementById('rosterModal').classList.add('active');
}

function populateRosterEmployeeSelect() {
    const select = document.getElementById('rosterEmployee');
    if (select) {
        select.innerHTML = '<option value="">Select Employee</option>';
        employees.forEach(emp => {
            const name = `${emp.first_name || ''} ${emp.last_name || ''}`.trim() || emp.employee_code;
            select.innerHTML += `<option value="${escapeHtml(emp.id)}">${escapeHtml(name)} (${escapeHtml(emp.employee_code || '')})</option>`;
        });
    }
}

function populateRosterShiftSelect() {
    const select = document.getElementById('rosterShiftId');
    if (select) {
        select.innerHTML = '<option value="">Select Shift</option>';
        shifts.filter(s => s.is_active).forEach(shift => {
            select.innerHTML += `<option value="${escapeHtml(shift.id)}">${escapeHtml(shift.shift_name)} (${escapeHtml(shift.shift_code)})</option>`;
        });
    }
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

        // Get office_type from dropdown
        const officeTypeVal = document.getElementById('officeType').value;

        const data = {
            office_name: document.getElementById('officeName').value,
            office_code: document.getElementById('officeCode').value,
            // Auto-derive is_headquarters from office_type (dropdown has "head" option)
            is_headquarters: officeTypeVal === 'head',
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
            enable_geofence_attendance: document.getElementById('officeEnableGeofence').checked,
            is_active: document.getElementById('officeIsActive').checked
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
            is_active: document.getElementById('departmentIsActive').checked
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

    // Validate office and department selection (from nested dropdown)
    const officeId = document.getElementById('desigOffice').value;
    const departmentId = document.getElementById('desigDepartment').value;
    if (!officeId || !departmentId) {
        showToast('Please select an office and department', 'error');
        return;
    }

    try {
        showLoading();
        const id = document.getElementById('designationId').value;

        // Get selected HRMS roles
        const selectedRoles = getSelectedHrmsRoles();

        const data = {
            designation_name: document.getElementById('designationName').value,
            designation_code: document.getElementById('designationCode').value,
            office_id: officeId,
            department_id: departmentId,
            level: parseInt(document.getElementById('desigLevel').value) || 1,
            role_category: document.getElementById('desigCategory').value || null,
            default_hrms_roles: selectedRoles,
            description: document.getElementById('designationDescription').value,
            is_active: document.getElementById('designationIsActive').checked
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

        // Get selected working days from checkboxes and convert to abbreviated format for backend
        // Checkbox values are lowercase full names (monday, tuesday, etc.)
        // Backend expects abbreviated format (Mon, Tue, etc.)
        const dayToAbbrev = {
            'monday': 'Mon', 'tuesday': 'Tue', 'wednesday': 'Wed',
            'thursday': 'Thu', 'friday': 'Fri', 'saturday': 'Sat', 'sunday': 'Sun'
        };
        const selectedWorkingDays = Array.from(document.querySelectorAll('input[name="workingDays"]:checked'))
            .map(cb => dayToAbbrev[cb.value] || cb.value)
            .join(',');

        const data = {
            shift_name: document.getElementById('shiftName').value,
            shift_code: document.getElementById('shiftCode').value,
            office_id: document.getElementById('shiftOfficeId').value || null,
            start_time: convertTo24HourFormat(document.getElementById('shiftStart').value),
            end_time: convertTo24HourFormat(document.getElementById('shiftEnd').value),
            break_duration_minutes: breakDurationMinutes,
            grace_period_minutes: parseInt(document.getElementById('graceMinutes').value) || 15,
            half_day_hours: parseFloat(document.getElementById('halfDayHours').value) || 4,
            working_days: selectedWorkingDays || 'Mon,Tue,Wed,Thu,Fri',
            is_active: document.getElementById('shiftIsActive').checked,
            enable_geofence_attendance: document.getElementById('shiftEnableGeofence').checked
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

        const officeSelect = document.getElementById('holidayOffices');
        const selectedOffice = officeSelect.value;

        const data = {
            holiday_name: document.getElementById('holidayName').value,
            holiday_date: document.getElementById('holidayDate').value,
            holiday_type: document.getElementById('holidayTypeSelect').value,
            description: document.getElementById('holidayDescription').value,
            office_id: selectedOffice ? selectedOffice : null
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

async function saveRoster() {
    const form = document.getElementById('rosterForm');
    if (!form.checkValidity()) {
        form.reportValidity();
        return;
    }

    try {
        showLoading();
        const id = document.getElementById('rosterId').value;
        const data = {
            employee_id: document.getElementById('rosterEmployee').value,
            shift_id: document.getElementById('rosterShiftId').value,
            start_date: document.getElementById('rosterStartDate').value,
            end_date: document.getElementById('rosterEndDate').value || null,
            roster_type: document.getElementById('rosterType').value,
            notes: document.getElementById('rosterNotes').value,
            is_active: document.getElementById('rosterIsActive').checked
        };

        if (id) {
            data.id = id;
            await api.request('/hrms/shifts/roster', {
                method: 'PUT',
                body: JSON.stringify(data)
            });
        } else {
            await api.request('/hrms/shifts/roster', {
                method: 'POST',
                body: JSON.stringify(data)
            });
        }

        closeModal('rosterModal');
        showToast(`Roster ${id ? 'updated' : 'created'} successfully`, 'success');
        await loadShiftRosters();
        hideLoading();
    } catch (error) {
        console.error('Error saving roster:', error);
        showToast(error.message || 'Failed to save roster', 'error');
        hideLoading();
    }
}

async function deleteRoster(id) {
    if (!confirm('Are you sure you want to delete this roster assignment?')) return;

    try {
        showLoading();
        await api.request(`/hrms/shifts/roster/${id}`, { method: 'DELETE' });
        showToast('Roster deleted successfully', 'success');
        await loadShiftRosters();
        hideLoading();
    } catch (error) {
        console.error('Error deleting roster:', error);
        showToast(error.message || 'Failed to delete roster', 'error');
        hideLoading();
    }
}

// ==========================================
// Bulk Operations Functions
// ==========================================

let bulkHolidayRowCount = 0;
let allEmployeesForBulkRoster = [];

function showBulkHolidayModal() {
    // Populate office dropdown
    const officeSelect = document.getElementById('bulkHolidayOffice');
    officeSelect.innerHTML = '<option value="">All Offices</option>';
    offices.forEach(office => {
        officeSelect.innerHTML += `<option value="${office.id}">${office.office_name || office.name}</option>`;
    });

    // Clear and add initial rows
    document.getElementById('bulkHolidayEntries').innerHTML = '';
    bulkHolidayRowCount = 0;
    for (let i = 0; i < 3; i++) {
        addBulkHolidayRow();
    }
    updateBulkHolidayCount();

    openModal('bulkHolidayModal');
}

function addBulkHolidayRow() {
    if (bulkHolidayRowCount >= 20) {
        showToast('Maximum 20 holidays allowed per bulk operation', 'warning');
        return;
    }

    const container = document.getElementById('bulkHolidayEntries');
    const row = document.createElement('div');
    row.className = 'bulk-entry-row';
    row.innerHTML = `
        <input type="text" class="form-control holiday-name" placeholder="Holiday name *" required>
        <input type="date" class="form-control holiday-date" required>
        <select class="form-control holiday-type">
            <option value="public">Public</option>
            <option value="regional">Regional</option>
            <option value="restricted">Restricted</option>
            <option value="company">Company</option>
        </select>
        <input type="text" class="form-control holiday-desc" placeholder="Description (optional)">
        <button type="button" class="remove-entry-btn" onclick="removeBulkHolidayRow(this)">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
        </button>
    `;
    container.appendChild(row);
    bulkHolidayRowCount++;
    updateBulkHolidayCount();
}

function removeBulkHolidayRow(btn) {
    if (bulkHolidayRowCount <= 1) {
        showToast('At least one holiday row is required', 'warning');
        return;
    }
    btn.closest('.bulk-entry-row').remove();
    bulkHolidayRowCount--;
    updateBulkHolidayCount();
}

function updateBulkHolidayCount() {
    const rows = document.querySelectorAll('#bulkHolidayEntries .bulk-entry-row');
    let validCount = 0;
    rows.forEach(row => {
        const name = row.querySelector('.holiday-name').value.trim();
        const date = row.querySelector('.holiday-date').value;
        if (name && date) validCount++;
    });
    document.getElementById('bulkHolidayCount').textContent = `${validCount} holiday(s) to add`;
}

async function saveBulkHolidays() {
    const year = document.getElementById('bulkHolidayYear').value;
    const selectedOfficeId = document.getElementById('bulkHolidayOffice').value;
    const rows = document.querySelectorAll('#bulkHolidayEntries .bulk-entry-row');

    // Collect holiday data from rows
    const holidayData = [];
    let hasErrors = false;

    rows.forEach(row => {
        const name = row.querySelector('.holiday-name').value.trim();
        const date = row.querySelector('.holiday-date').value;
        const type = row.querySelector('.holiday-type').value;
        const desc = row.querySelector('.holiday-desc').value.trim();

        if (name && date) {
            holidayData.push({
                holiday_name: name,
                holiday_date: date,
                holiday_type: type,
                description: desc || null
            });
        } else if (name || date) {
            hasErrors = true;
            row.style.borderColor = 'var(--color-danger-dark)';
        }
    });

    if (hasErrors) {
        showToast('Please fill in both name and date for all holidays', 'error');
        return;
    }

    if (holidayData.length === 0) {
        showToast('Please add at least one holiday', 'error');
        return;
    }

    // Build final holidays array - if "All Offices" selected, create for each office
    const holidays = [];
    const activeOffices = offices.filter(o => o.is_active !== false);

    if (!selectedOfficeId && activeOffices.length > 0) {
        // "All Offices" selected - create holiday for each office
        activeOffices.forEach(office => {
            holidayData.forEach(hd => {
                holidays.push({
                    ...hd,
                    office_id: office.id
                });
            });
        });
    } else if (selectedOfficeId) {
        // Specific office selected
        holidayData.forEach(hd => {
            holidays.push({
                ...hd,
                office_id: selectedOfficeId
            });
        });
    } else {
        showToast('No offices available. Please create an office first.', 'error');
        return;
    }

    try {
        showLoading();
        await api.createBulkHolidays(holidays);
        closeModal('bulkHolidayModal');
        const officeCount = !selectedOfficeId ? activeOffices.length : 1;
        const msg = officeCount > 1
            ? `Successfully added ${holidayData.length} holiday(s) to ${officeCount} offices`
            : `Successfully added ${holidayData.length} holiday(s)`;
        showToast(msg, 'success');
        await loadHolidays();
        hideLoading();
    } catch (error) {
        console.error('Error saving bulk holidays:', error);
        showToast(error.message || 'Failed to save holidays', 'error');
        hideLoading();
    }
}

async function showBulkRosterModal() {
    // Populate shift dropdown
    const shiftSelect = document.getElementById('bulkRosterShift');
    shiftSelect.innerHTML = '<option value="">Select Shift</option>';
    shifts.forEach(shift => {
        shiftSelect.innerHTML += `<option value="${shift.id}">${shift.shift_name || shift.name}</option>`;
    });

    // Populate department filter
    const deptFilter = document.getElementById('bulkRosterDepartmentFilter');
    deptFilter.innerHTML = '<option value="">All Departments</option>';
    departments.forEach(dept => {
        deptFilter.innerHTML += `<option value="${dept.id}">${dept.department_name || dept.name}</option>`;
    });

    // Set default start date to today
    document.getElementById('bulkRosterStartDate').value = new Date().toISOString().split('T')[0];
    document.getElementById('bulkRosterEndDate').value = '';

    // Load employees
    await loadBulkRosterEmployees();
    updateBulkRosterCount();

    openModal('bulkRosterModal');
}

async function loadBulkRosterEmployees() {
    try {
        const response = await api.getHrmsEmployees();
        allEmployeesForBulkRoster = Array.isArray(response) ? response : (response?.data || []);
        allEmployeesForBulkRoster = allEmployeesForBulkRoster.filter(e => e.employment_status === 'active');
        renderBulkRosterEmployees();
    } catch (error) {
        console.error('Error loading employees:', error);
        showToast('Failed to load employees', 'error');
    }
}

function renderBulkRosterEmployees() {
    const container = document.getElementById('bulkRosterEmployees');
    const deptFilter = document.getElementById('bulkRosterDepartmentFilter').value;

    container.innerHTML = '';
    allEmployeesForBulkRoster.forEach(emp => {
        const deptMatch = !deptFilter || emp.department_id === deptFilter;
        const deptName = departments.find(d => d.id === emp.department_id)?.department_name || 'No Dept';

        const item = document.createElement('label');
        item.className = `employee-checkbox-item${deptMatch ? '' : ' hidden'}`;
        item.innerHTML = `
            <input type="checkbox" value="${emp.id}" onchange="updateBulkRosterCount()">
            <span class="employee-checkbox-label">
                ${emp.first_name} ${emp.last_name || ''}
                <span class="employee-checkbox-dept">${deptName}</span>
            </span>
        `;
        container.appendChild(item);
    });
}

function filterBulkRosterEmployees() {
    renderBulkRosterEmployees();
    updateBulkRosterCount();
}

function selectAllBulkRosterEmployees() {
    const checkboxes = document.querySelectorAll('#bulkRosterEmployees .employee-checkbox-item:not(.hidden) input[type="checkbox"]');
    checkboxes.forEach(cb => cb.checked = true);
    updateBulkRosterCount();
}

function deselectAllBulkRosterEmployees() {
    const checkboxes = document.querySelectorAll('#bulkRosterEmployees input[type="checkbox"]');
    checkboxes.forEach(cb => cb.checked = false);
    updateBulkRosterCount();
}

function updateBulkRosterCount() {
    const checked = document.querySelectorAll('#bulkRosterEmployees input[type="checkbox"]:checked').length;
    document.getElementById('bulkRosterCount').textContent = `${checked} employee(s) selected`;
}

async function saveBulkRosters() {
    const shiftId = document.getElementById('bulkRosterShift').value;
    const rosterType = document.getElementById('bulkRosterType').value;
    const startDate = document.getElementById('bulkRosterStartDate').value;
    const endDate = document.getElementById('bulkRosterEndDate').value || null;

    if (!shiftId) {
        showToast('Please select a shift', 'error');
        return;
    }

    if (!startDate) {
        showToast('Please select a start date', 'error');
        return;
    }

    const selectedEmployees = Array.from(
        document.querySelectorAll('#bulkRosterEmployees input[type="checkbox"]:checked')
    ).map(cb => cb.value);

    if (selectedEmployees.length === 0) {
        showToast('Please select at least one employee', 'error');
        return;
    }

    const rosters = selectedEmployees.map(empId => ({
        employee_id: empId,
        shift_id: shiftId,
        start_date: startDate,
        end_date: endDate,
        roster_type: rosterType,
        is_active: true
    }));

    try {
        showLoading();
        await api.createBulkShiftRosters(rosters);
        closeModal('bulkRosterModal');
        showToast(`Successfully assigned shift to ${selectedEmployees.length} employee(s)`, 'success');
        await loadShiftRosters();
        hideLoading();
    } catch (error) {
        console.error('Error saving bulk rosters:', error);
        showToast(error.message || 'Failed to assign rosters', 'error');
        hideLoading();
    }
}

// ==========================================
// End Bulk Operations Functions
// ==========================================

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
    let startMinutes = sh * 60 + sm;
    let endMinutes = eh * 60 + em;

    // Handle overnight/night shifts (e.g., 22:00 - 06:00)
    if (endMinutes < startMinutes) {
        endMinutes += 24 * 60; // Add 24 hours
    }

    return (endMinutes - startMinutes) / 60;
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

function formatWeekendDays(weekendDays) {
    if (!weekendDays) return 'Sat, Sun';
    // Handle comma-separated format (e.g., "Sat,Sun" or "Saturday,Sunday")
    if (typeof weekendDays === 'string') {
        // Normalize to short form
        const dayMap = {
            'saturday': 'Sat', 'sunday': 'Sun', 'monday': 'Mon',
            'tuesday': 'Tue', 'wednesday': 'Wed', 'thursday': 'Thu', 'friday': 'Fri',
            'sat': 'Sat', 'sun': 'Sun', 'mon': 'Mon', 'tue': 'Tue',
            'wed': 'Wed', 'thu': 'Thu', 'fri': 'Fri'
        };
        return weekendDays.split(',')
            .map(d => dayMap[d.trim().toLowerCase()] || d.trim())
            .join(', ');
    }
    return 'Sat, Sun';
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

function getOfficeName(officeId) {
    if (!officeId) return 'All Offices';
    const office = offices.find(o => o.id === officeId);
    return office?.office_name || 'Unknown Office';
}

function showLoading() {
    document.getElementById('loadingOverlay').classList.add('active');
}

function hideLoading() {
    document.getElementById('loadingOverlay').classList.remove('active');
}

// Local showToast removed - using unified toast.js instead

// Event listeners - will be attached after DOM is loaded
document.addEventListener('DOMContentLoaded', function() {
    document.getElementById('officeSearch')?.addEventListener('input', updateOfficesTable);
    document.getElementById('departmentSearch')?.addEventListener('input', updateDepartmentsTable);
    document.getElementById('departmentOffice')?.addEventListener('change', updateDepartmentsTable);
    document.getElementById('designationSearch')?.addEventListener('input', updateDesignationsTable);
    document.getElementById('designationOffice')?.addEventListener('change', updateDesignationsTable);
    document.getElementById('designationDepartment')?.addEventListener('change', updateDesignationsTable);
    document.getElementById('shiftSearch')?.addEventListener('input', updateShiftsTable);
    document.getElementById('shiftOffice')?.addEventListener('change', updateShiftsTable);
    document.getElementById('holidayYear')?.addEventListener('change', loadHolidays);
    document.getElementById('holidayOffice')?.addEventListener('change', updateHolidaysTable);
    document.getElementById('holidayType')?.addEventListener('change', updateHolidaysTable);
    document.getElementById('rosterSearch')?.addEventListener('input', updateRostersTable);
    document.getElementById('rosterOffice')?.addEventListener('change', updateRostersTable);
    document.getElementById('rosterShift')?.addEventListener('change', updateRostersTable);

    // Designation modal: Office -> Department dependency
    document.getElementById('desigOffice')?.addEventListener('change', function() {
        filterDesigDepartmentsByOffice(this.value);
    });

    // Toggle switch label updates
    document.getElementById('desigIsManager')?.addEventListener('change', function() {
        document.getElementById('desigIsManagerLabel').textContent = this.checked ? 'Yes' : 'No';
    });
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
    if (!confirm('Are you sure you want to delete this tax type? This may affect associated tax rules.')) return;

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
            <td>${escapeHtml(officeName)}</td>
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

function formatCurrency(amount) {
    return new Intl.NumberFormat('en-IN', {
        style: 'currency',
        currency: 'INR',
        maximumFractionDigits: 0
    }).format(amount || 0);
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
    if (!confirm('Are you sure you want to delete this tax rule?')) return;

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
    document.getElementById('formulaFields').style.display = calcType === 'formula' ? 'flex' : 'none';
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
    document.getElementById('taxTypeSearch')?.addEventListener('input', updateTaxTypesTable);
    document.getElementById('taxRuleSearch')?.addEventListener('input', updateTaxRulesTable);

    // Add event listeners for salary components
    document.getElementById('componentSearch')?.addEventListener('input', updateComponentsTables);
    document.getElementById('componentType')?.addEventListener('change', updateComponentsTables);

    // Add event listeners for salary structures
    document.getElementById('structureSearch')?.addEventListener('input', updateSalaryStructuresTable);
    document.getElementById('structureOfficeFilter')?.addEventListener('change', loadSalaryStructures);

    // Add event listener for calculation type change in component modal
    const calcTypeSelect = document.getElementById('calculationType');
    if (calcTypeSelect) {
        calcTypeSelect.addEventListener('change', togglePercentageFields);
    }
});

// ============================================
// SALARY COMPONENTS FUNCTIONS
// ============================================

async function loadComponents() {
    try {
        const includeInactive = document.getElementById('showInactiveComponents')?.checked || false;
        const response = await api.request(`/hrms/payroll/components?includeInactive=${includeInactive}`);
        components = response || [];
        updateComponentsTables();
        // Update the calculation base dropdown to reflect available basic components
        updateCalculationBaseOptions();
    } catch (error) {
        console.error('Error loading components:', error);
    }
}

function toggleShowInactiveComponents() {
    const checkbox = document.getElementById('showInactiveComponents');
    checkbox.checked = !checkbox.checked;
    loadComponents();
}

// Update the "Percentage Of" dropdown to hide "Basic Salary" if no active basic component exists
function updateCalculationBaseOptions() {
    const calculationBaseSelect = document.getElementById('calculationBase');
    if (!calculationBaseSelect) return;

    // Check if there are any active basic components
    const activeBasicComponents = components.filter(c => c.is_basic_component === true && c.is_active !== false);
    const basicOption = calculationBaseSelect.querySelector('option[value="basic"]');

    if (activeBasicComponents.length === 0) {
        // No active basic component - hide the Basic Salary option entirely
        if (basicOption) {
            basicOption.style.display = 'none';
        }
        // If current selection is 'basic', switch to 'gross'
        if (calculationBaseSelect.value === 'basic') {
            calculationBaseSelect.value = 'gross';
            updatePercentageHelpText();
        }
    } else {
        // Active basic component exists - show the option
        if (basicOption) {
            basicOption.style.display = '';
            basicOption.textContent = 'Basic Salary';
        }
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

// Format component value for display (percentage or fixed amount)
function formatComponentValue(component) {
    const calcType = component.calculation_type || component.calculationType || 'fixed';
    const calcBase = component.calculation_base || component.calculationBase || 'basic';
    const percentage = component.percentage || 0;
    const fixedAmount = component.fixed_amount || 0;

    if (calcType === 'percentage') {
        // Format the base nicely
        let baseLabel = 'Basic';
        if (calcBase === 'ctc') baseLabel = 'CTC';
        else if (calcBase === 'gross') baseLabel = 'Gross';
        else if (calcBase === 'basic') baseLabel = 'Basic';

        return `<span class="value-badge value-percentage">${percentage}% of ${baseLabel}</span>`;
    } else {
        // Fixed amount - show "Not set" if 0
        if (fixedAmount === 0 || fixedAmount === null) {
            return `<span class="value-badge value-fixed" style="opacity: 0.6;">Not set</span>`;
        }
        return `<span class="value-badge value-fixed">₹${fixedAmount.toLocaleString('en-IN')}</span>`;
    }
}

function updateEarningsTable(earnings) {
    const tbody = document.getElementById('earningsTable');
    if (!tbody) return;

    if (!earnings || earnings.length === 0) {
        tbody.innerHTML = '<tr class="empty-state"><td colspan="7"><p>No earnings components</p></td></tr>';
        return;
    }

    tbody.innerHTML = earnings.map(c => {
        const isActive = c.is_active !== undefined ? c.is_active : c.isActive;
        const isBasic = c.is_basic_component === true;
        return `
        <tr class="${!isActive ? 'row-inactive' : ''}">
            <td>
                <strong>${c.component_name || c.name}</strong>
                ${isBasic ? '<span class="basic-badge">Basic</span>' : ''}
            </td>
            <td><code>${c.component_code || c.code}</code></td>
            <td>${c.calculation_type || c.calculationType || 'Fixed'}</td>
            <td>${formatComponentValue(c)}</td>
            <td>${(c.is_taxable !== undefined ? c.is_taxable : c.isTaxable) ? 'Yes' : 'No'}</td>
            <td><span class="status-badge status-${isActive ? 'active' : 'inactive'}">${isActive ? 'Active' : 'Inactive'}</span></td>
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
    `}).join('');
}

function updateDeductionsTable(deductions) {
    const tbody = document.getElementById('deductionsTable');
    if (!tbody) return;

    if (!deductions || deductions.length === 0) {
        tbody.innerHTML = '<tr class="empty-state"><td colspan="7"><p>No deduction components</p></td></tr>';
        return;
    }

    tbody.innerHTML = deductions.map(c => {
        const isActive = c.is_active !== undefined ? c.is_active : c.isActive;
        return `
        <tr class="${!isActive ? 'row-inactive' : ''}">
            <td><strong>${c.component_name || c.name}</strong></td>
            <td><code>${c.component_code || c.code}</code></td>
            <td>${c.calculation_type || c.calculationType || 'Fixed'}</td>
            <td>${formatComponentValue(c)}</td>
            <td>${(c.is_pre_tax !== undefined ? c.is_pre_tax : c.isPreTax) ? 'Yes' : 'No'}</td>
            <td><span class="status-badge status-${isActive ? 'active' : 'inactive'}">${isActive ? 'Active' : 'Inactive'}</span></td>
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
    `}).join('');
}

function showCreateComponentModal() {
    document.getElementById('componentForm').reset();
    document.getElementById('componentId').value = '';
    document.getElementById('componentModalTitle').textContent = 'Create Salary Component';
    // Reset status to active for new components
    const isActiveCheckbox = document.getElementById('componentIsActive');
    if (isActiveCheckbox) isActiveCheckbox.checked = true;
    // Reset isBasicSalary checkbox
    const isBasicCheckbox = document.getElementById('isBasicSalary');
    if (isBasicCheckbox) isBasicCheckbox.checked = false;
    // Reset calculation base to 'basic' (default for non-Basic components)
    document.getElementById('calculationBase').value = 'basic';
    // Update calculation base options based on active basic components
    updateCalculationBaseOptions();
    document.getElementById('componentModal').classList.add('active');
    // Reset calculation fields visibility
    toggleComponentCalcFields();
}

function toggleComponentCalcFields() {
    const calcType = document.getElementById('calculationType')?.value;
    const percentageRow = document.getElementById('percentageFieldsRow');
    const fixedAmountRow = document.getElementById('fixedAmountFieldsRow');
    const isBasicSalaryRow = document.getElementById('isBasicSalaryRow');
    const calculationBaseGroup = document.getElementById('calculationBaseGroup');
    const percentageInput = document.getElementById('componentPercentage');
    const fixedAmountInput = document.getElementById('defaultFixedAmount');

    if (!percentageRow || !fixedAmountRow) return;

    if (calcType === 'percentage') {
        percentageRow.style.display = 'flex';
        fixedAmountRow.style.display = 'none';
        if (isBasicSalaryRow) isBasicSalaryRow.style.display = 'block';
        if (percentageInput) percentageInput.required = true;
        if (fixedAmountInput) {
            fixedAmountInput.required = false;
            fixedAmountInput.value = '';
        }
        // Update help text and calculationBaseGroup visibility based on isBasicSalary checkbox
        toggleBasicSalaryInfo();
    } else {
        percentageRow.style.display = 'none';
        fixedAmountRow.style.display = 'flex';
        if (isBasicSalaryRow) isBasicSalaryRow.style.display = 'none';
        // Hide calculation base group for fixed type
        if (calculationBaseGroup) calculationBaseGroup.style.display = 'none';
        if (percentageInput) {
            percentageInput.required = false;
            percentageInput.value = '';
        }
        // Reset isBasicSalary checkbox for fixed type
        const isBasicCheckbox = document.getElementById('isBasicSalary');
        if (isBasicCheckbox) isBasicCheckbox.checked = false;
        // Set calculation base to null for fixed amount
        document.getElementById('calculationBase').value = '';
    }
}

// Toggle help text and calculation base based on isBasicSalary checkbox
function toggleBasicSalaryInfo() {
    const isBasicSalary = document.getElementById('isBasicSalary')?.checked;
    const percentageHelpText = document.getElementById('percentageHelpText');
    const calculationBase = document.getElementById('calculationBase');
    const calculationBaseGroup = document.getElementById('calculationBaseGroup');

    if (isBasicSalary) {
        // This is the Basic Salary component - calculated as % of CTC
        if (percentageHelpText) percentageHelpText.textContent = 'Percentage of CTC (Cost to Company)';
        if (calculationBase) calculationBase.value = 'ctc';
        // Hide the dropdown since basic salary is always % of CTC
        if (calculationBaseGroup) calculationBaseGroup.style.display = 'none';
    } else {
        // Regular component - show dropdown to select base (Basic, Gross, or CTC)
        if (calculationBaseGroup) calculationBaseGroup.style.display = 'block';
        // Update help text based on selected base
        updatePercentageHelpText();
    }
}

// Update the help text when calculation base changes
function updatePercentageHelpText() {
    const calculationBase = document.getElementById('calculationBase');
    const percentageHelpText = document.getElementById('percentageHelpText');

    if (!calculationBase || !percentageHelpText) return;

    const baseValue = calculationBase.value;
    switch (baseValue) {
        case 'ctc':
            percentageHelpText.textContent = 'Percentage of CTC (Cost to Company)';
            break;
        case 'gross':
            percentageHelpText.textContent = 'Percentage of Gross Salary';
            break;
        case 'basic':
        default:
            percentageHelpText.textContent = 'Percentage of Basic Salary';
            break;
    }
}

// Keep old function name for backward compatibility
function togglePercentageFields() {
    toggleComponentCalcFields();
}

// Legacy function - no longer needed but kept for compatibility
function toggleIsBaseField() {
    // This function is replaced by toggleBasicSalaryInfo
    toggleBasicSalaryInfo();
}

function editComponent(componentId) {
    const component = components.find(c => c.id === componentId);
    if (!component) return;

    document.getElementById('componentId').value = component.id;
    document.getElementById('componentName').value = component.component_name || component.name || '';
    document.getElementById('componentCode').value = component.component_code || component.code || '';
    document.getElementById('componentCategory').value = component.component_type || component.category || 'earning';
    document.getElementById('calculationType').value = component.calculation_type || component.calculationType || 'percentage';
    document.getElementById('isTaxable').value = (component.is_taxable !== undefined ? component.is_taxable : component.isTaxable) ? 'true' : 'false';
    document.getElementById('isStatutory').value = (component.is_statutory !== undefined ? component.is_statutory : component.isStatutory) ? 'true' : 'false';
    document.getElementById('componentDescription').value = component.description || '';

    // Set is_active checkbox
    const isActiveCheckbox = document.getElementById('componentIsActive');
    if (isActiveCheckbox) {
        isActiveCheckbox.checked = component.is_active !== false;
    }

    // Set percentage fields BEFORE triggering toggleComponentCalcFields
    if (component.calculation_type === 'percentage') {
        document.getElementById('componentPercentage').value = component.percentage || component.default_percentage || '';
        // Set calculation base value
        const calcBaseValue = component.calculation_base || 'basic';
        document.getElementById('calculationBase').value = calcBaseValue;
        // Set isBasicSalary checkbox based on is_basic_component flag (or fallback to calculation_base)
        const isBasicCheckbox = document.getElementById('isBasicSalary');
        if (isBasicCheckbox) {
            // Prefer is_basic_component flag if available, otherwise fallback to checking calculation_base
            isBasicCheckbox.checked = component.is_basic_component === true || calcBaseValue === 'ctc';
        }
    }

    // Handle calculation fields visibility (this will also update help text)
    toggleComponentCalcFields();

    // Set fixed amount field
    if (component.calculation_type === 'fixed') {
        const fixedAmountInput = document.getElementById('defaultFixedAmount');
        if (fixedAmountInput) {
            fixedAmountInput.value = component.default_fixed_amount || component.fixed_amount || '';
        }
    }

    document.getElementById('componentModalTitle').textContent = 'Edit Salary Component';
    // Update calculation base options based on active basic components
    updateCalculationBaseOptions();
    document.getElementById('componentModal').classList.add('active');
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
        const calculationType = document.getElementById('calculationType').value;
        const data = {
            component_name: document.getElementById('componentName').value,
            component_code: document.getElementById('componentCode').value,
            component_type: document.getElementById('componentCategory').value,
            calculation_type: calculationType,
            is_taxable: document.getElementById('isTaxable').value === 'true',
            is_statutory: document.getElementById('isStatutory').value === 'true',
            description: document.getElementById('componentDescription').value,
            is_active: document.getElementById('componentIsActive')?.checked !== false
        };

        // Add percentage fields if calculation type is percentage
        if (calculationType === 'percentage') {
            const percentageInputValue = document.getElementById('componentPercentage').value;
            const percentageValue = parseFloat(percentageInputValue);

            // Validate percentage is required and must be between 0.01 and 100
            if (!percentageInputValue || percentageInputValue.trim() === '' || isNaN(percentageValue)) {
                hideLoading();
                showToast('Percentage is required. Please enter a value.', 'error');
                return;
            }

            if (percentageValue <= 0) {
                hideLoading();
                showToast('Percentage must be greater than 0', 'error');
                return;
            }

            if (percentageValue > 100) {
                hideLoading();
                showToast('Percentage must not exceed 100', 'error');
                return;
            }

            data.percentage = percentageValue;
            // calculation_base is set by toggleBasicSalaryInfo() based on isBasicSalary checkbox
            // 'ctc' if isBasicSalary is checked, 'basic' otherwise
            data.calculation_base = document.getElementById('calculationBase').value || 'basic';
            // is_basic_component is true if this is a Basic Salary component (calculated as % of CTC)
            data.is_basic_component = document.getElementById('isBasicSalary')?.checked || false;

            // Validate: If calculation_base is 'basic', check if at least one basic component exists
            if (data.calculation_base === 'basic' && !data.is_basic_component) {
                const basicComponents = components.filter(c => c.is_basic_component === true && c.is_active !== false);
                if (basicComponents.length === 0) {
                    hideLoading();
                    showToast('Cannot create component based on Basic. No component with "is_basic_component" flag exists. Please create a basic component first.', 'error');
                    return;
                }
            }
        } else {
            // Fixed amount type - value is required and must be positive
            const fixedInputValue = document.getElementById('defaultFixedAmount').value;
            const fixedValue = parseFloat(fixedInputValue);

            // Validate fixed amount is required and must be between 1 and 999,999,999
            if (!fixedInputValue || fixedInputValue.trim() === '' || isNaN(fixedValue)) {
                hideLoading();
                showToast('Fixed amount is required. Please enter a value.', 'error');
                return;
            }

            if (fixedValue <= 0) {
                hideLoading();
                showToast('Fixed amount must be greater than 0', 'error');
                return;
            }

            if (fixedValue > 999999999) {
                hideLoading();
                showToast('Fixed amount must not exceed 999,999,999', 'error');
                return;
            }

            data.fixed_amount = fixedValue;
            data.calculation_base = null;
            data.is_basic_component = false;
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

// ============================================
// SALARY STRUCTURES FUNCTIONS
// ============================================

async function loadSalaryStructures() {
    try {
        const officeFilter = document.getElementById('structureOfficeFilter')?.value || '';
        const includeInactive = document.getElementById('showInactiveStructures')?.checked || false;
        let url = '/hrms/payroll/structures';
        if (officeFilter) {
            url = `/hrms/payroll/structures/office/${officeFilter}`;
        }
        // Add includeInactive parameter
        url += `?includeInactive=${includeInactive}`;

        const response = await api.request(url);
        structures = response || [];
        updateSalaryStructuresTable();

        // Also load setup status to display office structure status
        await loadOfficeStructureStatus();
    } catch (error) {
        console.error('Error loading salary structures:', error);
    }
}

function toggleShowInactiveStructures() {
    const checkbox = document.getElementById('showInactiveStructures');
    checkbox.checked = !checkbox.checked;
    loadSalaryStructures();
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
    if (!tbody) return;

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

    tbody.innerHTML = filtered.map(s => {
        const isActive = s.is_active !== undefined ? s.is_active : true;
        return `
        <tr class="${!isActive ? 'row-inactive' : ''}">
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
            <td><span class="status-badge status-${isActive ? 'active' : 'inactive'}">${isActive ? 'Active' : 'Inactive'}</span></td>
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
    `;}).join('');
}

function showCreateStructureModal() {
    document.getElementById('structureForm').reset();
    document.getElementById('structureId').value = '';
    document.getElementById('structureModalTitle').textContent = 'Create Salary Structure';
    document.getElementById('structureComponents').innerHTML = '';
    structureComponentCounter = 0;
    // Reset office searchable dropdown
    initStructureOfficeDropdown('');
    // Reset is_default select
    const isDefaultSelect = document.getElementById('structureIsDefault');
    if (isDefaultSelect) isDefaultSelect.value = 'false';
    // Reset status to active for new structures
    const isActiveCheckbox = document.getElementById('structureIsActive');
    if (isActiveCheckbox) isActiveCheckbox.checked = true;
    // Populate basic components list (none selected for new structure)
    populateBasicComponentsList(null);
    document.getElementById('structureModal').classList.add('active');
}

// Populate basic salary components as radio buttons
// Store basic components for filtering
let basicComponentsData = [];

function populateBasicComponentsList(selectedBasicComponentId) {
    const optionsContainer = document.getElementById('basicComponentOptions');
    const valueDisplay = document.getElementById('basicComponentDropdownValue');
    const hiddenInput = document.getElementById('selectedBasicComponentId');
    const helpText = document.getElementById('basicComponentHelpText');

    if (!optionsContainer) return;

    // Filter only basic components (is_basic_component === true)
    basicComponentsData = components.filter(c => c.is_basic_component === true);

    if (basicComponentsData.length === 0) {
        optionsContainer.innerHTML = `
            <div class="searchable-dropdown-empty">
                No basic components available. <a href="#" onclick="showCreateComponentModal(); closeBasicComponentDropdown(); return false;">Create one</a>
            </div>
        `;
        if (valueDisplay) valueDisplay.textContent = 'No basic components available';
        if (helpText) helpText.innerHTML = 'No basic salary components available. <a href="#" onclick="showCreateComponentModal(); return false;">Create one first</a>.';
        return;
    }

    if (helpText) helpText.textContent = 'Select the basic salary component for this structure';

    // Render options
    renderBasicComponentOptions(basicComponentsData, selectedBasicComponentId);

    // Set selected value display
    if (selectedBasicComponentId) {
        const selected = basicComponentsData.find(c => c.id === selectedBasicComponentId);
        if (selected && valueDisplay) {
            const compName = selected.component_name || selected.name || '';
            const percentage = selected.percentage || selected.default_percentage || 0;
            valueDisplay.innerHTML = `<span class="selected-component-name">${escapeHtml(compName)}</span> <span class="selected-component-percent">${percentage}%</span>`;
            valueDisplay.classList.add('has-value');
        }
        if (hiddenInput) hiddenInput.value = selectedBasicComponentId;
    } else {
        if (valueDisplay) {
            valueDisplay.textContent = 'Select basic component...';
            valueDisplay.classList.remove('has-value');
        }
        if (hiddenInput) hiddenInput.value = '';
    }
}

function renderBasicComponentOptions(componentsList, selectedId) {
    const optionsContainer = document.getElementById('basicComponentOptions');
    if (!optionsContainer) return;

    if (componentsList.length === 0) {
        optionsContainer.innerHTML = `<div class="searchable-dropdown-no-results">No matching components found</div>`;
        return;
    }

    optionsContainer.innerHTML = componentsList.map(c => {
        const isSelected = c.id === selectedId;
        const compName = c.component_name || c.name || '';
        const compCode = c.component_code || c.code || '';
        const percentage = c.percentage || c.default_percentage || 0;

        return `
            <div class="searchable-dropdown-option ${isSelected ? 'selected' : ''}" onclick="selectBasicComponent('${c.id}')" data-id="${c.id}">
                <div class="option-info">
                    <span class="option-name">${escapeHtml(compName)}</span>
                    <span class="option-details">${escapeHtml(compCode)} • ${percentage}% of CTC</span>
                </div>
                <span class="option-percentage">${percentage}%</span>
            </div>
        `;
    }).join('');
}

// Toggle dropdown visibility
function toggleBasicComponentDropdown() {
    const container = document.getElementById('basicComponentDropdownContainer');
    const menu = document.getElementById('basicComponentDropdownMenu');
    const searchInput = document.getElementById('basicComponentSearchInput');

    if (container && menu) {
        const isOpen = container.classList.contains('open');

        // Close any other open dropdowns first
        document.querySelectorAll('.searchable-dropdown.open').forEach(dd => {
            if (dd !== container) dd.classList.remove('open');
        });

        if (isOpen) {
            container.classList.remove('open');
        } else {
            container.classList.add('open');
            // Focus search input and clear it
            if (searchInput) {
                searchInput.value = '';
                searchInput.focus();
                // Reset filter
                renderBasicComponentOptions(basicComponentsData, document.getElementById('selectedBasicComponentId')?.value);
            }
        }
    }
}

function closeBasicComponentDropdown() {
    const container = document.getElementById('basicComponentDropdownContainer');
    if (container) container.classList.remove('open');
}

// Filter basic components based on search
function filterBasicComponents(searchTerm) {
    const term = searchTerm.toLowerCase().trim();
    const selectedId = document.getElementById('selectedBasicComponentId')?.value;

    if (!term) {
        renderBasicComponentOptions(basicComponentsData, selectedId);
        return;
    }

    const filtered = basicComponentsData.filter(c => {
        const name = (c.component_name || c.name || '').toLowerCase();
        const code = (c.component_code || c.code || '').toLowerCase();
        return name.includes(term) || code.includes(term);
    });

    renderBasicComponentOptions(filtered, selectedId);
}

// Handle basic component selection
function selectBasicComponent(componentId) {
    const hiddenInput = document.getElementById('selectedBasicComponentId');
    const valueDisplay = document.getElementById('basicComponentDropdownValue');

    // Find the component
    const component = basicComponentsData.find(c => c.id === componentId);

    if (component) {
        // Update hidden input
        if (hiddenInput) hiddenInput.value = componentId;

        // Update display value
        if (valueDisplay) {
            const compName = component.component_name || component.name || '';
            const percentage = component.percentage || component.default_percentage || 0;
            valueDisplay.innerHTML = `<span class="selected-component-name">${escapeHtml(compName)}</span> <span class="selected-component-percent">${percentage}%</span>`;
            valueDisplay.classList.add('has-value');
        }

        // Update option highlighting
        document.querySelectorAll('#basicComponentOptions .searchable-dropdown-option').forEach(opt => {
            opt.classList.toggle('selected', opt.dataset.id === componentId);
        });
    }

    // Close dropdown
    closeBasicComponentDropdown();
}

// Get selected basic component
function getSelectedBasicComponent() {
    const hiddenInput = document.getElementById('selectedBasicComponentId');
    return hiddenInput ? hiddenInput.value : null;
}

// Close dropdown when clicking outside
document.addEventListener('click', function(e) {
    const container = document.getElementById('basicComponentDropdownContainer');
    if (container && !container.contains(e.target)) {
        container.classList.remove('open');
    }
});

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

        // Set office searchable dropdown
        initStructureOfficeDropdown(structure.office_id || '');

        // Set is_default select
        const isDefaultSelect = document.getElementById('structureIsDefault');
        if (isDefaultSelect) {
            isDefaultSelect.value = structure.is_default ? 'true' : 'false';
        }

        // Set is_active checkbox
        const isActiveCheckbox = document.getElementById('structureIsActive');
        if (isActiveCheckbox) {
            isActiveCheckbox.checked = structure.is_active !== false;
        }

        // Find basic component from existing structure components
        let selectedBasicComponentId = null;
        const nonBasicComponents = [];

        if (structure.components && structure.components.length > 0) {
            structure.components.forEach(sc => {
                // Find the full component details
                const fullComponent = components.find(c => c.id === sc.component_id);
                if (fullComponent && fullComponent.is_basic_component === true) {
                    selectedBasicComponentId = sc.component_id;
                } else {
                    nonBasicComponents.push(sc);
                }
            });
        }

        // Populate basic components list with selection
        populateBasicComponentsList(selectedBasicComponentId);

        // Load and populate non-basic structure components
        if (nonBasicComponents.length > 0) {
            populateStructureComponents(nonBasicComponents);
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

    // VALIDATION 1: Check that a basic salary component is selected
    const selectedBasicComponentId = getSelectedBasicComponent();
    if (!selectedBasicComponentId) {
        showToast('Please select a Basic Salary component for this structure', 'error');
        return;
    }

    // Get the basic component details
    const basicComponent = components.find(c => c.id === selectedBasicComponentId);
    if (!basicComponent) {
        showToast('Selected Basic Salary component not found', 'error');
        return;
    }

    // Get other structure components (non-basic)
    const otherComponents = getStructureComponents();

    // Build the complete components array starting with the basic component
    const structureComponents = [];

    // Add the basic salary component first (always at display_order 0)
    structureComponents.push({
        component_id: basicComponent.id,
        component_type: basicComponent.component_type || 'earning',
        calculation_type: basicComponent.calculation_type || 'percentage',
        calculation_base: 'ctc', // Basic is always % of CTC
        is_calculation_base: true, // This IS the base for other calculations
        percentage: basicComponent.default_percentage || basicComponent.percentage || 0,
        fixed_amount: null,
        override_value: null,
        display_order: 0
    });

    // Add other components with adjusted display_order
    otherComponents.forEach((comp, index) => {
        structureComponents.push({
            ...comp,
            display_order: index + 1 // Start from 1 since basic is 0
        });
    });

    // Validate that at least basic component exists (should always pass after above check)
    if (!structureComponents || structureComponents.length === 0) {
        showToast('Please add at least one salary component with values', 'error');
        return;
    }

    // Validate that all non-basic components have proper values
    const invalidComponents = otherComponents.filter(c => {
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

        // Debug logging - remove after testing
        console.log('Saving structure with components:', {
            basicComponent: basicComponent,
            otherComponents: otherComponents,
            totalComponents: structureComponents.length,
            components: structureComponents
        });

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

// Structure component management
function addStructureComponent() {
    const container = document.getElementById('structureComponents');
    const componentId = `sc_${structureComponentCounter++}`;

    const componentHtml = `
        <div class="structure-component-row" id="${componentId}">
            <div class="form-row component-row">
                <div class="form-group" style="flex: 2;">
                    <div class="searchable-dropdown component-dropdown" id="${componentId}_dropdown">
                        <div class="searchable-dropdown-trigger" onclick="toggleComponentDropdown('${componentId}')">
                            <span class="dropdown-selection placeholder" id="${componentId}_selection">Select Component</span>
                            <svg class="dropdown-arrow" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
                        </div>
                        <div class="searchable-dropdown-menu" id="${componentId}_menu">
                            <div class="dropdown-search-box">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                                <input type="text" id="${componentId}_search" class="dropdown-search-input" placeholder="Search components..." oninput="filterComponentOptions('${componentId}')">
                            </div>
                            <div class="dropdown-options" id="${componentId}_options"></div>
                        </div>
                        <input type="hidden" class="component-select" id="${componentId}_value" data-type="" data-calc-base="" data-calc-type="" required>
                    </div>
                </div>
                <div class="form-group calc-rule-display" style="flex: 1.5;" id="${componentId}_calc_rule">
                    <span class="calc-rule-text text-muted">Select a component</span>
                </div>
                <div class="form-group value-field" style="flex: 1;" id="${componentId}_value_field">
                    <input type="number" class="form-control override-value" id="${componentId}_override" placeholder="Override" step="0.01" min="0" title="Leave empty to use component default">
                    <input type="hidden" class="calc-type-select" id="${componentId}_calctype_value" value="">
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
    // Initialize the component dropdown options
    renderComponentDropdownOptions(componentId);
}

// Toggle component searchable dropdown
function toggleComponentDropdown(componentId) {
    const dropdown = document.getElementById(`${componentId}_dropdown`);
    const isOpen = dropdown.classList.contains('open');

    // Close all other dropdowns first
    document.querySelectorAll('.searchable-dropdown.open').forEach(d => {
        if (d.id !== `${componentId}_dropdown`) {
            d.classList.remove('open');
        }
    });

    if (isOpen) {
        dropdown.classList.remove('open');
    } else {
        dropdown.classList.add('open');
        const searchInput = document.getElementById(`${componentId}_search`);
        if (searchInput) {
            searchInput.value = '';
            searchInput.focus();
            renderComponentDropdownOptions(componentId);
        }
    }
}

// Render component dropdown options with badges
function renderComponentDropdownOptions(componentId, filter = '') {
    const container = document.getElementById(`${componentId}_options`);
    if (!container) return;

    const selectedValue = document.getElementById(`${componentId}_value`).value;
    const filterLower = filter.toLowerCase();

    // Exclude basic components - they are selected separately in the "Basic Salary Component" section
    const filtered = components.filter(c => {
        // Skip basic components
        if (c.is_basic_component === true) return false;

        const name = c.component_name || c.name || '';
        const code = c.component_code || c.code || '';
        return name.toLowerCase().includes(filterLower) || code.toLowerCase().includes(filterLower);
    });

    if (filtered.length === 0) {
        container.innerHTML = '<div class="dropdown-no-match">No components found</div>';
        return;
    }

    container.innerHTML = filtered.map(c => {
        const compType = c.component_type || c.category || 'earning';
        const compName = c.component_name || c.name || '';
        const compCode = c.component_code || c.code || '';
        const badgeClass = compType === 'earning' ? 'badge-success' : 'badge-danger';
        const badgeText = compType === 'earning' ? 'Earning' : 'Deduction';

        return `
            <div class="dropdown-option ${c.id === selectedValue ? 'selected' : ''}"
                 onclick="selectComponentOption('${componentId}', '${c.id}', '${escapeHtml(compName)}', '${compType}')">
                <div class="dropdown-option-content">
                    <span class="dropdown-option-text">${escapeHtml(compName)} (${escapeHtml(compCode)})</span>
                    <span class="badge ${badgeClass}">${badgeText}</span>
                </div>
            </div>
        `;
    }).join('');
}

// Select a component from dropdown
function selectComponentOption(componentId, value, label, compType) {
    const hiddenInput = document.getElementById(`${componentId}_value`);
    const selection = document.getElementById(`${componentId}_selection`);
    const dropdown = document.getElementById(`${componentId}_dropdown`);
    const calcRuleDisplay = document.getElementById(`${componentId}_calc_rule`);
    const valueField = document.getElementById(`${componentId}_value_field`);
    const overrideInput = document.getElementById(`${componentId}_override`);
    const calcTypeHidden = document.getElementById(`${componentId}_calctype_value`);

    // Get the full component details
    const comp = components.find(c => c.id === value);
    if (!comp) return;

    // Store component data in hidden input
    hiddenInput.value = value;
    hiddenInput.setAttribute('data-type', compType);
    hiddenInput.setAttribute('data-calc-type', comp.calculation_type || 'percentage');
    hiddenInput.setAttribute('data-calc-base', comp.calculation_base || 'basic');
    hiddenInput.setAttribute('data-is-base', comp.is_calculation_base || false);

    // Update selection display
    selection.textContent = label;
    selection.classList.remove('placeholder');
    dropdown.classList.remove('open');

    // Store calculation type in hidden field
    if (calcTypeHidden) {
        calcTypeHidden.value = comp.calculation_type || 'percentage';
    }

    // Build and display the calculation rule
    const calcType = comp.calculation_type || 'percentage';
    const calcBase = comp.calculation_base || 'basic';
    const defaultPct = comp.default_percentage || comp.percentage || 0;
    const defaultFixed = comp.default_fixed_amount || comp.fixed_amount || 0;
    const isBase = comp.is_calculation_base === true;

    let ruleText = '';
    let ruleClass = '';

    if (calcType === 'percentage') {
        const baseLabel = calcBase === 'ctc' ? 'CTC' : calcBase === 'gross' ? 'Gross' : 'Basic';
        if (isBase) {
            ruleText = `${defaultPct}% of ${baseLabel}`;
            ruleClass = 'badge-info';
        } else {
            ruleText = `${defaultPct}% of ${baseLabel}`;
            ruleClass = calcBase === 'ctc' ? 'badge-info' : 'badge-warning';
        }
    } else {
        ruleText = defaultFixed > 0 ? `Fixed ₹${defaultFixed.toLocaleString()}` : 'Fixed Amount';
        ruleClass = 'badge-success';
    }

    if (calcRuleDisplay) {
        calcRuleDisplay.innerHTML = `<span class="badge ${ruleClass}">${ruleText}</span>`;
    }

    // Configure override input
    if (valueField && overrideInput) {
        if (isBase && calcBase === 'ctc') {
            // This is a CTC-based base component (like Basic Salary)
            // No override needed - auto-calculated from employee's CTC
            valueField.style.display = 'none';
            overrideInput.value = '';
        } else if (calcType === 'percentage') {
            valueField.style.display = 'block';
            overrideInput.placeholder = `Override % (default: ${defaultPct})`;
            overrideInput.value = ''; // Empty means use default
            overrideInput.max = '100';
        } else {
            valueField.style.display = 'block';
            overrideInput.placeholder = defaultFixed > 0 ? `Override (default: ${defaultFixed})` : 'Enter amount';
            overrideInput.value = '';
            overrideInput.removeAttribute('max');
        }
    }
}

// Filter component dropdown options
function filterComponentOptions(componentId) {
    const searchValue = document.getElementById(`${componentId}_search`).value;
    renderComponentDropdownOptions(componentId, searchValue);
}

// Toggle calculation type dropdown
function toggleCalcTypeDropdown(componentId) {
    const dropdown = document.getElementById(`${componentId}_calctype_dropdown`);
    const isOpen = dropdown.classList.contains('open');

    // Close all other dropdowns first
    document.querySelectorAll('.searchable-dropdown.open').forEach(d => {
        if (d.id !== `${componentId}_calctype_dropdown`) {
            d.classList.remove('open');
        }
    });

    if (isOpen) {
        dropdown.classList.remove('open');
    } else {
        dropdown.classList.add('open');
    }
}

// Select calculation type
function selectCalcType(componentId, value, label) {
    const hiddenInput = document.getElementById(`${componentId}_calctype_value`);
    const selection = document.getElementById(`${componentId}_calctype_selection`);
    const dropdown = document.getElementById(`${componentId}_calctype_dropdown`);
    const optionsContainer = document.getElementById(`${componentId}_calctype_options`);

    hiddenInput.value = value;
    selection.textContent = label;
    dropdown.classList.remove('open');

    // Update selected state in options
    optionsContainer.querySelectorAll('.dropdown-option').forEach(opt => {
        opt.classList.remove('selected');
        if (opt.textContent.trim() === label) {
            opt.classList.add('selected');
        }
    });

    // Toggle value fields
    toggleComponentValueFieldsByType(componentId, value);
}

// Toggle value fields based on calculation type
function toggleComponentValueFieldsByType(componentId, calcType) {
    const row = document.getElementById(componentId);
    if (!row) return;

    const percentageInput = row.querySelector('.percentage-value');
    const fixedInput = row.querySelector('.fixed-value');

    if (calcType === 'percentage') {
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
        const overrideInput = row.querySelector('.override-value');

        if (componentSelect.value) {
            // Get component data from the hidden input's data attributes
            const componentType = componentSelect.getAttribute('data-type') || '';
            const calcType = componentSelect.getAttribute('data-calc-type') || calcTypeSelect?.value || 'percentage';
            const calcBase = componentSelect.getAttribute('data-calc-base') || 'basic';
            const isBase = componentSelect.getAttribute('data-is-base') === 'true';

            // Get the override value (if provided)
            const overrideValue = overrideInput ? parseFloat(overrideInput.value) : null;

            // Get the component's default values
            const comp = components.find(c => c.id === componentSelect.value);
            const defaultPct = comp?.default_percentage || comp?.percentage || 0;
            const defaultFixed = comp?.default_fixed_amount || comp?.fixed_amount || 0;

            // Use override if provided, otherwise use component default
            let percentage = null;
            let fixed_amount = null;

            if (calcType === 'percentage') {
                percentage = (overrideValue !== null && !isNaN(overrideValue)) ? overrideValue : defaultPct;
            } else {
                fixed_amount = (overrideValue !== null && !isNaN(overrideValue)) ? overrideValue : defaultFixed;
            }

            componentsList.push({
                component_id: componentSelect.value,
                component_type: componentType,
                calculation_type: calcType,
                calculation_base: calcBase,
                is_calculation_base: isBase,
                percentage: percentage,
                fixed_amount: fixed_amount,
                override_value: overrideValue,
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
                const rowId = lastRow.id;
                const componentSelect = lastRow.querySelector('.component-select');

                // Find the component details
                const comp = components.find(c => c.id === sc.component_id);
                if (!comp) return;

                const compName = comp.component_name || comp.name || '';
                const compType = comp.component_type || comp.category || 'earning';

                // Simulate selecting the component to trigger all the UI updates
                selectComponentOption(rowId, sc.component_id, compName, compType);

                // If there's an override value stored, set it
                const overrideInput = lastRow.querySelector('.override-value');
                if (overrideInput && sc.override_value !== null && sc.override_value !== undefined) {
                    overrideInput.value = sc.override_value;
                } else if (overrideInput) {
                    // Check if the saved value differs from component default
                    const calcType = comp.calculation_type || 'percentage';
                    const defaultPct = comp.default_percentage || comp.percentage || 0;
                    const defaultFixed = comp.default_fixed_amount || comp.fixed_amount || 0;

                    if (calcType === 'percentage' && sc.percentage && sc.percentage !== defaultPct) {
                        overrideInput.value = sc.percentage;
                    } else if (calcType === 'fixed' && sc.fixed_amount && sc.fixed_amount !== defaultFixed) {
                        overrideInput.value = sc.fixed_amount;
                    }
                }
            }
        });
    }
}

// ============================================
// VERSION HISTORY FUNCTIONS
// ============================================

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
        const isCurrent = index === 0;
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

async function viewVersionDetails(versionId) {
    try {
        showLoading();
        const version = await api.request(`/hrms/payroll/structures/versions/${versionId}`);

        if (!version) {
            showToast('Version not found', 'error');
            hideLoading();
            return;
        }

        // Populate modal header
        document.getElementById('versionBadge').textContent = `v${version.version_number}`;

        // Populate effective dates
        document.getElementById('versionEffectiveFrom').textContent = formatDate(version.effective_from);

        const effectiveToEl = document.getElementById('versionEffectiveTo');
        if (version.effective_to) {
            effectiveToEl.textContent = formatDate(version.effective_to);
            effectiveToEl.classList.remove('ongoing');
        } else {
            effectiveToEl.textContent = 'Ongoing';
            effectiveToEl.classList.add('ongoing');
        }

        // Populate change reason
        const reasonText = document.getElementById('versionChangeReason');
        if (version.change_reason) {
            reasonText.textContent = version.change_reason;
            reasonText.classList.remove('empty');
        } else {
            reasonText.textContent = 'No reason provided';
            reasonText.classList.add('empty');
        }

        // Populate components table
        const components = version.components || [];
        document.getElementById('versionComponentCount').textContent = components.length;

        const tbody = document.getElementById('versionComponentsBody');

        if (components.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="3">
                        <div class="version-components-empty">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                                <path d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"/>
                            </svg>
                            <p>No components in this version</p>
                        </div>
                    </td>
                </tr>`;
        } else {
            tbody.innerHTML = components.map(c => {
                const isEarning = c.component_type === 'earning';
                const typeClass = isEarning ? 'earning' : 'deduction';
                const typeLabel = isEarning ? 'Earning' : 'Deduction';

                let valueHtml;
                if (c.calculation_type === 'percentage') {
                    let baseLabel = 'Basic';
                    if (c.calculation_base === 'gross') {
                        baseLabel = 'Gross';
                    } else if (c.calculation_base && c.calculation_base !== 'basic') {
                        baseLabel = c.calculation_base;
                    }
                    valueHtml = `
                        <span class="percentage">${c.percentage || 0}%</span>
                        <span class="calc-base">of ${baseLabel}</span>`;
                } else {
                    valueHtml = `<span class="fixed">₹${(c.fixed_amount || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>`;
                }

                return `
                    <tr>
                        <td>
                            <div class="component-name">
                                <strong>${c.component_name || 'Unknown'}</strong>
                                <span class="component-code">${c.component_code || '-'}</span>
                            </div>
                        </td>
                        <td>
                            <span class="component-type ${typeClass}">${typeLabel}</span>
                        </td>
                        <td>
                            <div class="component-value">${valueHtml}</div>
                        </td>
                    </tr>`;
            }).join('');
        }

        hideLoading();
        openModal('versionDetailsModal');
    } catch (error) {
        console.error('Error loading version details:', error);
        showToast(error.message || 'Failed to load version details', 'error');
        hideLoading();
    }
}

async function compareVersions(structureId, fromVersion, toVersion) {
    try {
        showLoading();
        const diff = await api.request(`/hrms/payroll/structures/${structureId}/versions/compare?fromVersion=${fromVersion}&toVersion=${toVersion}`);

        if (!diff) {
            showToast('Could not compare versions', 'error');
            hideLoading();
            return;
        }

        let summary = `Version ${fromVersion} → Version ${toVersion}\n\n`;

        if (diff.added_components?.length > 0) {
            summary += `ADDED (${diff.added_components.length}):\n`;
            diff.added_components.forEach(c => {
                summary += `  + ${c.component_name} (${c.component_code})\n`;
            });
        }

        if (diff.removed_components?.length > 0) {
            summary += `\nREMOVED (${diff.removed_components.length}):\n`;
            diff.removed_components.forEach(c => {
                summary += `  - ${c.component_name} (${c.component_code})\n`;
            });
        }

        if (diff.modified_components?.length > 0) {
            summary += `\nMODIFIED (${diff.modified_components.length}):\n`;
            diff.modified_components.forEach(c => {
                summary += `  ~ ${c.component_name}: ${c.old_value} → ${c.new_value}\n`;
            });
        }

        if (diff.unchanged_components?.length > 0) {
            summary += `\nUNCHANGED: ${diff.unchanged_components.length} components\n`;
        }

        alert(summary);
        hideLoading();
    } catch (error) {
        console.error('Error comparing versions:', error);
        showToast(error.message || 'Failed to compare versions', 'error');
        hideLoading();
    }
}

async function showCreateVersionModal() {
    if (!currentVersionStructureId) {
        showToast('No structure selected', 'error');
        return;
    }

    try {
        showLoading();

        // Fetch the BASE structure's components (not version components)
        // This ensures any edits to the base structure are reflected
        const baseStructure = await api.request(`/hrms/payroll/structures/${currentVersionStructureId}`);
        const baseStructureComponents = baseStructure?.components || [];

        document.getElementById('newVersionForm').reset();

        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        document.getElementById('versionEffectiveDate').value = tomorrow.toISOString().split('T')[0];

        // Pass base structure components to pre-select them
        populateNewVersionComponents(baseStructureComponents);

        document.getElementById('createVersionModalTitle').textContent = `Create New Version - ${currentVersionStructureName}`;
        openModal('createVersionModal');
        hideLoading();
    } catch (error) {
        console.error('Error loading structure for new version:', error);
        showToast('Failed to load structure components', 'error');
        hideLoading();
    }
}

function populateNewVersionComponents(baseStructureComponents = []) {
    const container = document.getElementById('newVersionComponents');
    if (!container) return;

    // Use BASE STRUCTURE components for pre-selection (not previous version)
    // This ensures any edits made to the base structure are reflected in new versions
    const existingComponents = baseStructureComponents;

    // Build table structure
    container.innerHTML = `
        <div class="version-components-table">
            <div class="version-components-header">
                <div class="col-select"></div>
                <div class="col-name">Component</div>
                <div class="col-type">Type</div>
                <div class="col-calc">Calculation</div>
                <div class="col-value">Value</div>
            </div>
            <div class="version-components-body">
                ${components.map(c => {
                    const existingComp = existingComponents.find(ec => ec.component_id === c.id);
                    const isSelected = !!existingComp;

                    // Use values from base structure component if present
                    const value = existingComp?.percentage || existingComp?.fixed_amount ||
                                  c.default_percentage || c.percentage || '';
                    const calcType = existingComp?.calculation_type || c.calculation_type || 'percentage';
                    const calcBase = existingComp?.calculation_base || c.calculation_base || 'basic';
                    const compType = c.component_type || c.category;

                    // Format calculation display based on base
                    const calcBaseLabel = calcBase === 'gross' ? 'Gross' : calcBase === 'ctc' ? 'CTC' : 'Basic';

                    return `
                    <div class="version-component-row ${isSelected ? 'selected' : ''}" data-component-id="${c.id}">
                        <div class="col-select">
                            <input type="checkbox" name="versionComponent" value="${c.id}" ${isSelected ? 'checked' : ''}
                                   id="vc_${c.id}"
                                   data-name="${c.component_name || c.name}"
                                   data-code="${c.component_code || c.code}"
                                   data-type="${compType}"
                                   data-calc-base="${calcBase}"
                                   onchange="toggleVersionComponentRow(this)">
                        </div>
                        <div class="col-name">
                            <label for="vc_${c.id}">${c.component_name || c.name}</label>
                            <span class="component-code">${c.component_code || c.code}</span>
                        </div>
                        <div class="col-type">
                            <span class="type-badge type-${compType}">${compType}</span>
                        </div>
                        <div class="col-calc">
                            <select class="version-calc-type" data-component-id="${c.id}" onchange="updateVersionValuePlaceholder(this)">
                                <option value="percentage" ${calcType === 'percentage' ? 'selected' : ''}>% of ${calcBaseLabel}</option>
                                <option value="fixed" ${calcType === 'fixed' ? 'selected' : ''}>Fixed ₹</option>
                            </select>
                        </div>
                        <div class="col-value">
                            <input type="number" class="version-value" data-component-id="${c.id}"
                                   value="${isSelected ? value : ''}" placeholder="${calcType === 'percentage' ? '%' : '₹'}"
                                   step="0.01" min="0">
                        </div>
                    </div>`;
                }).join('')}
            </div>
        </div>`;
}

function toggleVersionComponentRow(checkbox) {
    const row = checkbox.closest('.version-component-row');
    if (checkbox.checked) {
        row.classList.add('selected');
    } else {
        row.classList.remove('selected');
    }
}

function updateVersionValuePlaceholder(select) {
    const componentId = select.dataset.componentId;
    const input = document.querySelector(`.version-value[data-component-id="${componentId}"]`);
    if (input) {
        input.placeholder = select.value === 'percentage' ? '%' : '₹';
    }
}

// =============================================================================
// SALARY CALCULATION PREVIEW
// =============================================================================

function previewVersionedSalary() {
    // Get the current version's components from structureVersions
    if (!structureVersions || structureVersions.length === 0) {
        showToast('No version data available for preview', 'error');
        return;
    }

    // Reset the modal
    document.getElementById('previewCtcInput').value = '';
    document.getElementById('salaryPreviewResults').style.display = 'none';
    document.getElementById('salaryPreviewEmpty').style.display = 'block';

    // Show the modal
    openModal('salaryPreviewModal');
}

function calculateSalaryPreview() {
    const ctcInput = document.getElementById('previewCtcInput');
    const resultsDiv = document.getElementById('salaryPreviewResults');
    const emptyDiv = document.getElementById('salaryPreviewEmpty');

    const annualCtc = parseFloat(ctcInput.value) || 0;

    if (annualCtc <= 0) {
        resultsDiv.style.display = 'none';
        emptyDiv.style.display = 'block';
        return;
    }

    // Show results, hide empty state
    resultsDiv.style.display = 'block';
    emptyDiv.style.display = 'none';

    const monthlyGross = annualCtc / 12;

    // Get current version components
    const currentVersion = structureVersions[0];
    const versionComponents = currentVersion?.components || [];

    let totalEarnings = 0;
    let totalDeductions = 0;
    const earningsItems = [];
    const deductionsItems = [];

    // Calculate Basic first (if percentage-based components exist, we need a base)
    // For simplicity, we'll use monthly gross as the base for percentage calculations
    const basicAmount = monthlyGross;

    versionComponents.forEach(comp => {
        const compName = comp.component_name || comp.name || 'Unknown';
        const compCode = comp.component_code || comp.code || '';
        const compType = comp.component_type || comp.type || 'earning';
        const calcType = comp.calculation_type || 'percentage';

        let amount = 0;
        let calcDescription = '';

        if (calcType === 'percentage') {
            const percentage = comp.percentage || comp.percentage_of_basic || 0;
            amount = (basicAmount * percentage) / 100;
            calcDescription = `${percentage}% of Basic`;
        } else {
            amount = comp.fixed_amount || 0;
            calcDescription = 'Fixed';
        }

        const item = {
            name: compName,
            code: compCode,
            amount: amount,
            calcDescription: calcDescription
        };

        if (compType === 'earning' || compType === 'Earning') {
            totalEarnings += amount;
            earningsItems.push(item);
        } else {
            totalDeductions += amount;
            deductionsItems.push(item);
        }
    });

    // If no components, show the gross as Basic
    if (versionComponents.length === 0) {
        earningsItems.push({
            name: 'Basic Salary',
            code: 'BASIC',
            amount: monthlyGross,
            calcDescription: '100%'
        });
        totalEarnings = monthlyGross;
    }

    const netPay = totalEarnings - totalDeductions;

    // Update summary cards
    document.getElementById('previewMonthlyGross').textContent = formatCurrency(monthlyGross);
    document.getElementById('previewTotalEarnings').textContent = formatCurrency(totalEarnings);
    document.getElementById('previewTotalDeductions').textContent = formatCurrency(totalDeductions);
    document.getElementById('previewNetPay').textContent = formatCurrency(netPay);

    // Update earnings table
    const earningsTable = document.getElementById('previewEarningsTable');
    if (earningsItems.length > 0) {
        earningsTable.innerHTML = earningsItems.map(item => `
            <div class="preview-row">
                <div>
                    <span class="preview-row-name">${item.name}</span>
                    <span class="preview-row-code">${item.code}</span>
                </div>
                <div>
                    <span class="preview-row-value">${formatCurrency(item.amount)}</span>
                    <span class="preview-row-calc">${item.calcDescription}</span>
                </div>
            </div>
        `).join('');
    } else {
        earningsTable.innerHTML = '<div class="preview-table-empty">No earnings components</div>';
    }

    // Update deductions table
    const deductionsTable = document.getElementById('previewDeductionsTable');
    if (deductionsItems.length > 0) {
        deductionsTable.innerHTML = deductionsItems.map(item => `
            <div class="preview-row">
                <div>
                    <span class="preview-row-name">${item.name}</span>
                    <span class="preview-row-code">${item.code}</span>
                </div>
                <div>
                    <span class="preview-row-value">${formatCurrency(item.amount)}</span>
                    <span class="preview-row-calc">${item.calcDescription}</span>
                </div>
            </div>
        `).join('');
    } else {
        deductionsTable.innerHTML = '<div class="preview-table-empty">No deduction components</div>';
    }
}

function formatCurrency(amount) {
    return '₹' + amount.toLocaleString('en-IN', {
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
    });
}

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

    const selectedComponents = [];
    document.querySelectorAll('input[name="versionComponent"]:checked').forEach((checkbox, index) => {
        const componentId = checkbox.value;
        const calcTypeSelect = document.querySelector(`.version-calc-type[data-component-id="${componentId}"]`);
        const valueInput = document.querySelector(`.version-value[data-component-id="${componentId}"]`);

        const calcType = calcTypeSelect?.value || 'percentage';
        const calcBase = checkbox.getAttribute('data-calc-base') || 'basic';
        const value = parseFloat(valueInput?.value) || 0;

        if (value > 0) {
            selectedComponents.push({
                component_id: componentId,
                calculation_order: index + 1,
                calculation_type: calcType,
                calculation_base: calcBase,
                percentage: calcType === 'percentage' ? value : null,
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

        await viewStructureVersions(currentVersionStructureId);
        hideLoading();
    } catch (error) {
        console.error('Error creating version:', error);
        showToast(error.message || 'Failed to create version', 'error');
        hideLoading();
    }
}

// ============================================
// ARREARS MANAGEMENT
// ============================================

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

async function refreshArrears() {
    try {
        const versionId = structureVersions && structureVersions.length > 0
            ? structureVersions[0]?.id
            : null;

        if (versionId && !isValidGuid(versionId)) {
            console.warn('Invalid version ID format, fetching all arrears');
        }

        const arrears = await api.getPendingArrears(versionId);
        currentArrearsList = arrears || [];
        selectedArrearsIds.clear();
        updateArrearsTable();
        updateArrearsSummary();
        updateArrearsButtons();
    } catch (error) {
        console.error('Error refreshing arrears:', error);
        const errorMessage = error.error || error.message || 'Failed to refresh arrears';
        showToast(errorMessage, 'error');
        currentArrearsList = [];
        selectedArrearsIds.clear();
        updateArrearsTable();
        updateArrearsSummary();
        updateArrearsButtons();
    }
}

function updateArrearsSummary() {
    const summary = document.getElementById('arrearsSummary');
    if (!summary) return;

    if (!currentArrearsList || currentArrearsList.length === 0) {
        summary.style.display = 'none';
        return;
    }

    summary.style.display = 'block';

    const uniqueEmployees = new Set(currentArrearsList.map(a => a.employee_id));
    const totalAmount = currentArrearsList.reduce((sum, a) => sum + (a.arrears_amount || 0), 0);
    const pendingCount = currentArrearsList.filter(a => a.status === 'pending').length;

    const employeeCountEl = document.getElementById('arrearsEmployeeCount');
    const totalAmountEl = document.getElementById('arrearsTotalAmount');
    const pendingCountEl = document.getElementById('arrearsPendingCount');

    if (employeeCountEl) employeeCountEl.textContent = uniqueEmployees.size;
    if (totalAmountEl) totalAmountEl.textContent = `₹${totalAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
    if (pendingCountEl) pendingCountEl.textContent = pendingCount;
}

function updateArrearsTable() {
    const tbody = document.getElementById('arrearsTable');
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
            <td>${getMonthNameShort(a.payroll_month)} ${a.payroll_year}</td>
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

function getArrearsStatusBadge(status) {
    const badges = {
        'pending': '<span class="badge" style="background: var(--color-warning-light); color: var(--color-warning-text);">Pending</span>',
        'applied': '<span class="badge" style="background: var(--color-success-light); color: var(--color-success-text);">Applied</span>',
        'cancelled': '<span class="badge" style="background: var(--color-danger-light); color: var(--color-danger-text);">Cancelled</span>'
    };
    return badges[status] || badges['pending'];
}

function getMonthNameShort(monthNumber) {
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return months[monthNumber - 1] || '';
}

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

function toggleArrearsSelection(arrearsId) {
    if (selectedArrearsIds.has(arrearsId)) {
        selectedArrearsIds.delete(arrearsId);
    } else {
        selectedArrearsIds.add(arrearsId);
    }
    updateArrearsButtons();
}

function updateArrearsButtons() {
    const hasSelection = selectedArrearsIds.size > 0;
    const applyBtn = document.getElementById('applyArrearsBtn');
    const cancelBtn = document.getElementById('cancelArrearsBtn');
    if (applyBtn) applyBtn.disabled = !hasSelection;
    if (cancelBtn) cancelBtn.disabled = !hasSelection;
}

async function applySingleArrears(arrearsId) {
    if (!arrearsId || !isValidGuid(arrearsId)) {
        showToast('Invalid arrears ID', 'error');
        return;
    }

    if (!confirm('Are you sure you want to apply this arrears to the next payroll?')) return;

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

async function cancelSingleArrears(arrearsId) {
    if (!arrearsId || !isValidGuid(arrearsId)) {
        showToast('Invalid arrears ID', 'error');
        return;
    }

    if (!confirm('Are you sure you want to cancel this arrears?')) return;

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

async function applySelectedArrears() {
    if (selectedArrearsIds.size === 0) {
        showToast('No arrears selected', 'error');
        return;
    }

    const validIds = Array.from(selectedArrearsIds).filter(id => isValidGuid(id));
    if (validIds.length === 0) {
        showToast('No valid arrears IDs selected', 'error');
        return;
    }

    if (!confirm(`Are you sure you want to apply ${validIds.length} arrears to the next payroll?`)) return;

    try {
        showLoading();
        let successCount = 0;
        let errorCount = 0;

        for (const arrearsId of validIds) {
            try {
                await api.applyArrears(arrearsId);
                successCount++;
            } catch (e) {
                errorCount++;
            }
        }

        if (successCount > 0) {
            showToast(`Applied ${successCount} arrears${errorCount > 0 ? `, ${errorCount} failed` : ''}`, 'success');
        } else {
            showToast('Failed to apply arrears', 'error');
        }
        await refreshArrears();
        hideLoading();
    } catch (error) {
        console.error('Error applying arrears:', error);
        showToast(error.message || 'Failed to apply arrears', 'error');
        hideLoading();
    }
}

async function cancelSelectedArrears() {
    if (selectedArrearsIds.size === 0) {
        showToast('No arrears selected', 'error');
        return;
    }

    const validIds = Array.from(selectedArrearsIds).filter(id => isValidGuid(id));
    if (validIds.length === 0) {
        showToast('No valid arrears IDs selected', 'error');
        return;
    }

    if (!confirm(`Are you sure you want to cancel ${validIds.length} arrears?`)) return;

    try {
        showLoading();
        let successCount = 0;
        let errorCount = 0;

        for (const arrearsId of validIds) {
            try {
                await api.cancelArrears(arrearsId);
                successCount++;
            } catch (e) {
                errorCount++;
            }
        }

        if (successCount > 0) {
            showToast(`Cancelled ${successCount} arrears${errorCount > 0 ? `, ${errorCount} failed` : ''}`, 'success');
        } else {
            showToast('Failed to cancel arrears', 'error');
        }
        await refreshArrears();
        hideLoading();
    } catch (error) {
        console.error('Error cancelling arrears:', error);
        showToast(error.message || 'Failed to cancel arrears', 'error');
        hideLoading();
    }
}

// ============================================
// BULK VERSION ASSIGNMENT
// ============================================

async function openBulkAssignModal() {
    if (!currentVersionStructureId) {
        showToast('Please select a structure first', 'error');
        return;
    }

    bulkAssignStructureId = currentVersionStructureId;
    bulkAssignVersionNumber = structureVersions[0]?.version_number || 1;

    try {
        showLoading();

        await loadBulkAssignFilters();

        document.getElementById('bulkAssignForm').reset();
        document.getElementById('bulkPreviewSection').style.display = 'none';
        document.getElementById('executeBulkBtn').disabled = true;
        bulkPreviewResult = null;

        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        document.getElementById('bulkEffectiveFrom').value = tomorrow.toISOString().split('T')[0];

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

async function loadBulkAssignFilters() {
    try {
        const officeSelect = document.getElementById('bulkOfficeId');
        if (officeSelect) {
            officeSelect.innerHTML = '<option value="">All Offices</option>' +
                (offices || []).map(o => `<option value="${o.id}">${o.office_name}</option>`).join('');
        }

        const deptSelect = document.getElementById('bulkDepartmentId');
        if (deptSelect) {
            deptSelect.innerHTML = '<option value="">All Departments</option>' +
                (departments || []).map(d => `<option value="${d.id}">${d.department_name}</option>`).join('');
        }

        const desigSelect = document.getElementById('bulkDesignationId');
        if (desigSelect) {
            desigSelect.innerHTML = '<option value="">All Designations</option>' +
                (allDesignations || []).map(d => `<option value="${d.id}">${d.designation_name}</option>`).join('');
        }
    } catch (error) {
        console.error('Error loading bulk assign filters:', error);
    }
}

function isValidGuid(value) {
    if (!value || value === '') return false;
    const guidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    return guidRegex.test(value);
}

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

async function previewBulkAssignment() {
    const effectiveFrom = document.getElementById('bulkEffectiveFrom').value;
    if (!effectiveFrom) {
        showToast('Please select an effective date', 'error');
        return;
    }

    const officeId = parseGuidOrNull(document.getElementById('bulkOfficeId').value);
    const departmentId = parseGuidOrNull(document.getElementById('bulkDepartmentId').value);
    const designationId = parseGuidOrNull(document.getElementById('bulkDesignationId').value);

    if (!officeId && !departmentId && !designationId) {
        document.getElementById('bulkPreviewSection').style.display = 'none';
        document.getElementById('executeBulkBtn').disabled = true;
        bulkPreviewResult = null;
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
            calculate_arrears: document.getElementById('bulkCalculateArrears')?.checked || false,
            reason: document.getElementById('bulkReason')?.value || null
        };

        bulkPreviewResult = await api.bulkAssignVersion(bulkAssignStructureId, bulkAssignVersionNumber, request);

        document.getElementById('bulkPreviewSection').style.display = 'block';
        document.getElementById('bulkMatchedCount').textContent = bulkPreviewResult.total_employees_matched || 0;
        document.getElementById('bulkToAssignCount').textContent = bulkPreviewResult.employees_to_assign || 0;
        document.getElementById('bulkEstArrears').textContent =
            `₹${(bulkPreviewResult.estimated_arrears_total || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;

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

        const toAssign = bulkPreviewResult.employees_to_update || bulkPreviewResult.employees_to_assign || 0;
        document.getElementById('executeBulkBtn').disabled = toAssign === 0;

        hideLoading();
    } catch (error) {
        console.error('Error previewing bulk assignment:', error);
        const errorMessage = error.error || error.message || 'Failed to preview assignment';
        showToast(errorMessage, 'error');

        document.getElementById('bulkPreviewSection').style.display = 'none';
        document.getElementById('executeBulkBtn').disabled = true;
        bulkPreviewResult = null;

        hideLoading();
    }
}

async function executeBulkAssignment() {
    if (!bulkPreviewResult || bulkPreviewResult.employees_to_assign === 0) {
        showToast('No employees to assign. Please preview first.', 'error');
        return;
    }

    if (!bulkAssignStructureId || !isValidGuid(bulkAssignStructureId)) {
        showToast('Invalid structure ID', 'error');
        return;
    }

    if (!bulkAssignVersionNumber || bulkAssignVersionNumber <= 0) {
        showToast('Invalid version number', 'error');
        return;
    }

    const effectiveFrom = document.getElementById('bulkEffectiveFrom').value;
    if (!effectiveFrom) {
        showToast('Please select an effective date', 'error');
        return;
    }

    const officeId = parseGuidOrNull(document.getElementById('bulkOfficeId').value);
    const departmentId = parseGuidOrNull(document.getElementById('bulkDepartmentId').value);
    const designationId = parseGuidOrNull(document.getElementById('bulkDesignationId').value);

    if (!officeId && !departmentId && !designationId) {
        showToast('At least one filter (office, department, or designation) must be selected', 'error');
        return;
    }

    if (!confirm(`Are you sure you want to assign this structure version to ${bulkPreviewResult.employees_to_assign} employees?`)) {
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
            preview_only: false,
            calculate_arrears: document.getElementById('bulkCalculateArrears')?.checked || false,
            reason: document.getElementById('bulkReason')?.value || null
        };

        const result = await api.bulkAssignVersion(bulkAssignStructureId, bulkAssignVersionNumber, request);

        closeModal('bulkAssignModal');
        showToast(`Successfully assigned structure to ${result.employees_assigned || result.employees_to_assign} employees`, 'success');

        await loadSalaryStructures();

        hideLoading();
    } catch (error) {
        console.error('Error executing bulk assignment:', error);
        const errorMessage = error.error || error.message || 'Failed to execute assignment';
        showToast(errorMessage, 'error');
        hideLoading();
    }
}
