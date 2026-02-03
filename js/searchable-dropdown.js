/**
 * Searchable Dropdown Component for Ragenaizer
 * A reusable searchable dropdown with virtual scroll support
 *
 * Usage:
 *   // Create new dropdown
 *   const dropdown = new SearchableDropdown(container, {
 *     options: [{ value: 'val1', label: 'Label 1', description: 'Optional desc' }, ...],
 *     placeholder: 'Select an option',
 *     searchPlaceholder: 'Search...',
 *     onChange: (value, option) => {},
 *     virtualScroll: true,  // Enable for large lists (50+ items)
 *     itemHeight: 40        // Height of each item for virtual scroll
 *   });
 *
 *   // Convert existing select element
 *   convertSelectToSearchable('selectId', {
 *     placeholder: 'Select...',
 *     onChange: (value) => {}
 *   });
 */

const SearchableDropdown = (function() {
    'use strict';

    // Store for all dropdown instances
    const instances = new Map();

    // HTML escape function to prevent XSS
    function escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    /**
     * SearchableDropdown Class
     */
    class Dropdown {
        constructor(container, options = {}) {
            this.container = typeof container === 'string' ? document.getElementById(container) : container;
            if (!this.container) {
                console.warn('SearchableDropdown: Container not found');
                return;
            }

            this.options = options.options || [];
            this.placeholder = options.placeholder || 'Select an option';
            this.searchPlaceholder = options.searchPlaceholder || 'Search...';
            this.onChange = options.onChange || (() => {});
            this.virtualScroll = options.virtualScroll !== undefined ? options.virtualScroll : this.options.length > 50;
            this.itemHeight = options.itemHeight || 40;
            this.selectedValue = options.value !== undefined ? options.value : null;
            this.filteredOptions = [...this.options];
            this.highlightedIndex = -1;
            this.isOpen = false;
            this.id = options.id || `sd-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
            this.disabled = options.disabled || false;
            this.compact = options.compact || false;
            this.linkedSelect = options.linkedSelect || null; // For form sync

            this.render();
            this.bindEvents();

            // Store reference
            instances.set(this.id, this);
        }

        render() {
            const selectedOption = this.options.find(o => String(o.value) === String(this.selectedValue));
            const displayText = selectedOption ? selectedOption.label : '';
            const compactClass = this.compact ? 'searchable-dropdown--compact' : '';
            const disabledClass = this.disabled ? 'searchable-dropdown--disabled' : '';

            this.container.innerHTML = `
                <div class="searchable-dropdown ${compactClass} ${disabledClass}" id="${this.id}-dropdown" data-value="${escapeHtml(String(this.selectedValue || ''))}">
                    <div class="searchable-dropdown-trigger" tabindex="${this.disabled ? -1 : 0}" role="combobox" aria-haspopup="listbox" aria-expanded="false">
                        <span class="searchable-dropdown-text ${!displayText ? 'placeholder' : ''}">${escapeHtml(displayText) || escapeHtml(this.placeholder)}</span>
                        <svg class="searchable-dropdown-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="6 9 12 15 18 9"></polyline>
                        </svg>
                    </div>
                    <div class="searchable-dropdown-menu" role="listbox">
                        <div class="searchable-dropdown-search">
                            <svg class="searchable-dropdown-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <circle cx="11" cy="11" r="8"></circle>
                                <path d="m21 21-4.35-4.35"></path>
                            </svg>
                            <input type="text" placeholder="${escapeHtml(this.searchPlaceholder)}" autocomplete="off" aria-label="Search options">
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
            this.textEl = this.container.querySelector('.searchable-dropdown-text');
        }

        renderOptions() {
            if (this.filteredOptions.length === 0) {
                return '<div class="searchable-dropdown-empty">No results found</div>';
            }

            if (this.virtualScroll && this.filteredOptions.length > 50) {
                return this.renderVirtualOptions();
            }

            return this.filteredOptions.map((option, index) => `
                <div class="searchable-dropdown-option ${String(option.value) === String(this.selectedValue) ? 'selected' : ''} ${index === this.highlightedIndex ? 'highlighted' : ''}"
                     data-value="${escapeHtml(String(option.value))}"
                     data-index="${index}"
                     role="option"
                     aria-selected="${String(option.value) === String(this.selectedValue)}">
                    <span class="searchable-dropdown-option-label">${escapeHtml(option.label)}</span>
                    ${option.description ? `<span class="searchable-dropdown-option-desc">${escapeHtml(option.description)}</span>` : ''}
                    <svg class="searchable-dropdown-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="20 6 9 17 4 12"></polyline>
                    </svg>
                </div>
            `).join('');
        }

        renderVirtualOptions() {
            const totalHeight = this.filteredOptions.length * this.itemHeight;
            const visibleCount = Math.ceil(220 / this.itemHeight) + 2;

            return `
                <div class="searchable-dropdown-virtual" style="height: ${totalHeight}px; position: relative;">
                    <div class="searchable-dropdown-virtual-viewport" style="position: absolute; top: 0; left: 0; right: 0;">
                        ${this.filteredOptions.slice(0, visibleCount).map((option, index) => `
                            <div class="searchable-dropdown-option ${String(option.value) === String(this.selectedValue) ? 'selected' : ''}"
                                 data-value="${escapeHtml(String(option.value))}"
                                 data-index="${index}"
                                 style="height: ${this.itemHeight}px;"
                                 role="option">
                                <span class="searchable-dropdown-option-label">${escapeHtml(option.label)}</span>
                                ${option.description ? `<span class="searchable-dropdown-option-desc">${escapeHtml(option.description)}</span>` : ''}
                                <svg class="searchable-dropdown-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <polyline points="20 6 9 17 4 12"></polyline>
                                </svg>
                            </div>
                        `).join('')}
                    </div>
                </div>
            `;
        }

        bindEvents() {
            if (this.disabled) return;

            // Toggle dropdown on trigger click
            this.triggerEl.addEventListener('click', (e) => {
                e.stopPropagation();
                this.toggle();
            });

            // Keyboard navigation on trigger
            this.triggerEl.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    this.toggle();
                } else if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    this.open();
                } else if (e.key === 'Escape') {
                    this.close();
                }
            });

            // Search input
            this.searchInput.addEventListener('input', (e) => {
                this.filter(e.target.value);
            });

            this.searchInput.addEventListener('keydown', (e) => {
                this.handleKeydown(e);
            });

            // Prevent search input click from closing
            this.searchInput.addEventListener('click', (e) => {
                e.stopPropagation();
            });

            // Option click
            this.optionsEl.addEventListener('click', (e) => {
                const optionEl = e.target.closest('.searchable-dropdown-option');
                if (optionEl && !optionEl.classList.contains('disabled')) {
                    this.select(optionEl.dataset.value);
                }
            });

            // Virtual scroll
            if (this.virtualScroll) {
                this.optionsEl.addEventListener('scroll', () => this.handleVirtualScroll());
            }

            // Close on outside click
            document.addEventListener('click', (e) => {
                if (this.isOpen && !this.container.contains(e.target)) {
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
                    this.triggerEl.focus();
                    break;
                case 'Tab':
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
                    <div class="searchable-dropdown-option ${String(option.value) === String(this.selectedValue) ? 'selected' : ''}"
                         data-value="${escapeHtml(String(option.value))}"
                         data-index="${startIndex + i}"
                         style="height: ${this.itemHeight}px;"
                         role="option">
                        <span class="searchable-dropdown-option-label">${escapeHtml(option.label)}</span>
                        ${option.description ? `<span class="searchable-dropdown-option-desc">${escapeHtml(option.description)}</span>` : ''}
                        <svg class="searchable-dropdown-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
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
                el.classList.toggle('highlighted', parseInt(el.dataset.index) === this.highlightedIndex);
            });

            // Scroll highlighted option into view
            const highlighted = this.optionsEl.querySelector('.searchable-dropdown-option.highlighted');
            if (highlighted) {
                highlighted.scrollIntoView({ block: 'nearest' });
            }
        }

        filter(query) {
            const q = query.toLowerCase().trim();
            this.filteredOptions = this.options.filter(option => {
                const label = (option.label || '').toLowerCase();
                const desc = (option.description || '').toLowerCase();
                const value = String(option.value || '').toLowerCase();
                return label.includes(q) || desc.includes(q) || value.includes(q);
            });
            this.highlightedIndex = this.filteredOptions.length > 0 ? 0 : -1;
            this.optionsEl.innerHTML = this.renderOptions();
        }

        toggle() {
            if (this.disabled) return;
            // Check actual class state instead of property (in case another dropdown forcibly closed us)
            const isCurrentlyOpen = this.dropdownEl.classList.contains('open');
            if (isCurrentlyOpen) {
                this.close();
            } else {
                this.open();
            }
        }

        open() {
            if (this.disabled) return;

            // Close all other open dropdowns first
            instances.forEach((instance, id) => {
                if (id !== this.id && instance.isOpen) {
                    instance.close();
                }
            });

            // Also close any open MonthPickers
            document.querySelectorAll('.month-picker.open').forEach(picker => {
                picker.classList.remove('open');
            });

            this.isOpen = true;
            this.dropdownEl.classList.add('open');
            this.triggerEl.setAttribute('aria-expanded', 'true');
            this.searchInput.value = '';
            this.filteredOptions = [...this.options];
            this.highlightedIndex = -1;
            this.optionsEl.innerHTML = this.renderOptions();

            // Position menu if needed (for dropdowns near bottom of screen)
            this.positionMenu();

            setTimeout(() => this.searchInput.focus(), 10);
        }

        close() {
            this.isOpen = false;
            this.dropdownEl.classList.remove('open');
            this.dropdownEl.classList.remove('open-up');
            this.triggerEl.setAttribute('aria-expanded', 'false');
            this.highlightedIndex = -1;
        }

        positionMenu() {
            const rect = this.triggerEl.getBoundingClientRect();
            const menuHeight = 280; // Approximate max height
            const spaceBelow = window.innerHeight - rect.bottom;
            const spaceAbove = rect.top;

            if (spaceBelow < menuHeight && spaceAbove > spaceBelow) {
                this.dropdownEl.classList.add('open-up');
            } else {
                this.dropdownEl.classList.remove('open-up');
            }
        }

        select(value) {
            const option = this.options.find(o => String(o.value) === String(value));
            if (option) {
                this.selectedValue = option.value;
                this.textEl.textContent = option.label;
                this.textEl.classList.remove('placeholder');
                this.dropdownEl.dataset.value = option.value;
                this.close();

                // Sync with linked select element
                if (this.linkedSelect) {
                    this.linkedSelect.value = option.value;
                    this.linkedSelect.dispatchEvent(new Event('change', { bubbles: true }));
                }

                this.onChange(option.value, option);
            }
        }

        getValue() {
            return this.selectedValue;
        }

        setValue(value, triggerChange = false) {
            const option = this.options.find(o => String(o.value) === String(value));
            if (option) {
                this.selectedValue = option.value;
                this.textEl.textContent = option.label;
                this.textEl.classList.remove('placeholder');
                this.dropdownEl.dataset.value = option.value;

                if (this.linkedSelect) {
                    this.linkedSelect.value = option.value;
                }

                if (triggerChange) {
                    this.onChange(option.value, option);
                }
            } else {
                this.selectedValue = null;
                this.textEl.textContent = this.placeholder;
                this.textEl.classList.add('placeholder');
                this.dropdownEl.dataset.value = '';

                if (this.linkedSelect) {
                    this.linkedSelect.value = '';
                }
            }
        }

        setOptions(options, preserveValue = true) {
            const previousValue = this.selectedValue;
            this.options = options;
            this.filteredOptions = [...options];

            // Check if previous value still exists
            if (preserveValue && previousValue !== null) {
                const stillExists = options.find(o => String(o.value) === String(previousValue));
                if (!stillExists) {
                    this.selectedValue = null;
                    this.textEl.textContent = this.placeholder;
                    this.textEl.classList.add('placeholder');
                    this.dropdownEl.dataset.value = '';
                }
            }

            // Sync options to linked native select for form validation
            if (this.linkedSelect) {
                this.linkedSelect.innerHTML = options.map(opt =>
                    `<option value="${opt.value}">${opt.label}</option>`
                ).join('');
                // Sync the current value
                if (this.selectedValue !== null) {
                    this.linkedSelect.value = this.selectedValue;
                }
            }

            // Update virtual scroll threshold
            this.virtualScroll = options.length > 50;

            if (this.isOpen) {
                this.optionsEl.innerHTML = this.renderOptions();
            }
        }

        setDisabled(disabled) {
            this.disabled = disabled;
            this.dropdownEl.classList.toggle('searchable-dropdown--disabled', disabled);
            this.triggerEl.tabIndex = disabled ? -1 : 0;
            if (disabled && this.isOpen) {
                this.close();
            }
        }

        destroy() {
            instances.delete(this.id);
            this.container.innerHTML = '';
        }

        // Static method to get instance by ID
        static getInstance(id) {
            return instances.get(id);
        }

        // Static method to get all instances
        static getAllInstances() {
            return instances;
        }
    }

    return Dropdown;
})();

/**
 * Helper function to convert existing select element to searchable dropdown
 * @param {string} selectId - ID of the select element to convert
 * @param {object} options - Additional options
 * @returns {SearchableDropdown} The created dropdown instance
 */
function convertSelectToSearchable(selectId, options = {}) {
    const select = document.getElementById(selectId);
    if (!select) {
        console.warn(`convertSelectToSearchable: Select element '${selectId}' not found`);
        return null;
    }

    // Extract options from select
    const selectOptions = Array.from(select.options).map(opt => ({
        value: opt.value,
        label: opt.textContent.trim(),
        description: opt.dataset.description || ''
    }));

    // Create container for the dropdown
    const container = document.createElement('div');
    container.id = `${selectId}-searchable-container`;
    container.className = 'searchable-dropdown-wrapper';
    select.parentNode.insertBefore(container, select);

    // Hide original select but keep it for form submission
    select.style.display = 'none';
    select.setAttribute('data-searchable', 'true');

    // Create dropdown
    const dropdown = new SearchableDropdown(container, {
        id: selectId,
        options: selectOptions,
        value: select.value,
        placeholder: options.placeholder || select.options[0]?.textContent || 'Select...',
        searchPlaceholder: options.searchPlaceholder || 'Search...',
        virtualScroll: options.virtualScroll !== undefined ? options.virtualScroll : selectOptions.length > 50,
        compact: options.compact || false,
        linkedSelect: select,
        onChange: (value, option) => {
            // Additional onChange handler if provided
            if (options.onChange) {
                options.onChange(value, option);
            }
        }
    });

    return dropdown;
}

/**
 * Batch convert multiple select elements
 * @param {Array} configs - Array of { id, options } objects
 * @returns {Map} Map of dropdown instances by ID
 */
function convertMultipleSelectsToSearchable(configs) {
    const dropdowns = new Map();
    configs.forEach(config => {
        const dropdown = convertSelectToSearchable(config.id, config.options || {});
        if (dropdown) {
            dropdowns.set(config.id, dropdown);
        }
    });
    return dropdowns;
}

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { SearchableDropdown, convertSelectToSearchable, convertMultipleSelectsToSearchable };
}

// Make available globally
window.SearchableDropdown = SearchableDropdown;
window.convertSelectToSearchable = convertSelectToSearchable;
window.convertMultipleSelectsToSearchable = convertMultipleSelectsToSearchable;
