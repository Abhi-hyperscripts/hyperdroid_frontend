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

    // Close all open SearchableDropdowns when flatpickr custom dropdowns open
    document.addEventListener('fpDropdownOpened', () => {
        instances.forEach(instance => {
            if (instance.isOpen) instance.close();
        });
    });

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
            // Optional inline "+" button next to the search input.
            // Usage: quickAdd: { title: 'Add account', onClick: () => openModal() }
            // or simply quickAdd: () => openModal()   (shorthand)
            this.quickAdd = typeof options.quickAdd === 'function'
                ? { title: 'Add new', onClick: options.quickAdd }
                : (options.quickAdd || null);

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
                            ${this.quickAdd ? `
                                <button type="button" class="searchable-dropdown-quick-add" aria-label="${escapeHtml(this.quickAdd.title || 'Add new')}" title="${escapeHtml(this.quickAdd.title || 'Add new')}">
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
                                        <line x1="12" y1="5" x2="12" y2="19"></line>
                                        <line x1="5" y1="12" x2="19" y2="12"></line>
                                    </svg>
                                </button>
                            ` : ''}
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

            // Quick-add button — fires the user's callback. The callback is
            // responsible for showing its own modal; after it resolves with
            // a new item, it can update this dropdown via refreshOptions().
            const quickAddBtn = this.container.querySelector('.searchable-dropdown-quick-add');
            if (quickAddBtn && this.quickAdd && this.quickAdd.onClick) {
                quickAddBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    this.close();
                    Promise.resolve(this.quickAdd.onClick(this)).catch(err => {
                        console.warn('[SearchableDropdown] quickAdd onClick threw', err);
                    });
                });
            }

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

            // Close any open flatpickr custom month/year dropdowns
            document.dispatchEvent(new CustomEvent('dropdownOpened'));

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
            // Reset inline styles from fixed-escape positioning + restore the
            // menu element back to its original parent (we portaled it to
            // <body> on open to escape transformed ancestors).
            if (this.menuEl && this._fixedEscapeActive) {
                this.menuEl.classList.remove('searchable-dropdown-menu--portaled');
                this.menuEl.style.position = '';
                this.menuEl.style.top = '';
                this.menuEl.style.left = '';
                this.menuEl.style.width = '';
                this.menuEl.style.zIndex = '';
                this.menuEl.style.transform = '';
                this.menuEl.style.display = '';
                if (this._menuOriginalParent && this.menuEl.parentElement === document.body) {
                    if (this._menuOriginalNextSibling && this._menuOriginalNextSibling.parentElement === this._menuOriginalParent) {
                        this._menuOriginalParent.insertBefore(this.menuEl, this._menuOriginalNextSibling);
                    } else {
                        this._menuOriginalParent.appendChild(this.menuEl);
                    }
                }
                this._menuOriginalParent = null;
                this._menuOriginalNextSibling = null;
                this._fixedEscapeActive = false;
            }
            this._detachReposition();
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

            // If ANY ancestor has overflow: auto/hidden/scroll, the menu (which
            // is absolutely positioned relative to the dropdown) will get
            // clipped. Detect that and promote the menu to position:fixed so
            // it escapes every overflow ancestor.
            this._fixedEscapeActive = false;
            let el = this.dropdownEl.parentElement;
            while (el && el !== document.body) {
                const cs = getComputedStyle(el);
                const ox = cs.overflowX, oy = cs.overflowY;
                if (ox === 'auto' || ox === 'hidden' || ox === 'scroll' ||
                    oy === 'auto' || oy === 'hidden' || oy === 'scroll') {
                    this._fixedEscapeActive = true;
                    break;
                }
                el = el.parentElement;
            }
            if (this._fixedEscapeActive) {
                const openUp = this.dropdownEl.classList.contains('open-up');
                const top = openUp ? (rect.top - 4) : (rect.bottom + 4);
                // Portal the menu into <body> — any transformed/filtered
                // ancestor (e.g., modal-content has `transform: matrix(...)`)
                // would otherwise anchor `position: fixed` to the ancestor
                // instead of the viewport, throwing the menu way offset.
                if (this.menuEl.parentElement !== document.body) {
                    this._menuOriginalParent = this.menuEl.parentElement;
                    this._menuOriginalNextSibling = this.menuEl.nextSibling;
                    document.body.appendChild(this.menuEl);
                }
                // Tag the portaled menu so it can be styled/selected even
                // outside its original parent's stacking context.
                this.menuEl.classList.add('searchable-dropdown-menu--portaled');
                this.menuEl.style.position = 'fixed';
                this.menuEl.style.top = `${top}px`;
                this.menuEl.style.left = `${rect.left}px`;
                this.menuEl.style.width = `${rect.width}px`;
                this.menuEl.style.zIndex = '10050';
                // The default rule `.searchable-dropdown.open .searchable-dropdown-menu`
                // no longer applies once we've portaled out of that ancestor,
                // so reveal the menu explicitly.
                this.menuEl.style.display = 'block';
                if (openUp) {
                    this.menuEl.style.transform = 'translateY(-100%)';
                } else {
                    this.menuEl.style.transform = '';
                }
                // When anything scrolls, reposition — or close if the trigger
                // is clearly offscreen.
                if (!this._repositionHandler) {
                    this._repositionHandler = () => {
                        if (!this.isOpen) return;
                        const r = this.triggerEl.getBoundingClientRect();
                        if (r.bottom < 0 || r.top > window.innerHeight ||
                            r.right < 0 || r.left > window.innerWidth) {
                            this.close();
                            return;
                        }
                        this.menuEl.style.top  = `${openUp ? r.top - 4 : r.bottom + 4}px`;
                        this.menuEl.style.left = `${r.left}px`;
                    };
                    window.addEventListener('scroll', this._repositionHandler, true);
                    window.addEventListener('resize', this._repositionHandler);
                }
            } else {
                // Reset inline style if we previously used fixed
                this.menuEl.style.position = '';
                this.menuEl.style.top = '';
                this.menuEl.style.left = '';
                this.menuEl.style.width = '';
                this.menuEl.style.zIndex = '';
                this.menuEl.style.transform = '';
            }
        }

        _detachReposition() {
            if (this._repositionHandler) {
                window.removeEventListener('scroll', this._repositionHandler, true);
                window.removeEventListener('resize', this._repositionHandler);
                this._repositionHandler = null;
            }
        }

        /**
         * Replace the option list and optionally set a new selected value.
         * Used by quick-add flows: user opens a "create new" modal, saves,
         * and the dropdown re-pulls the refreshed list with the new item
         * auto-selected.
         */
        refreshOptions(newOptions, newValue) {
            this.options = newOptions || [];
            this.filteredOptions = [...this.options];
            if (newValue !== undefined) this.selectedValue = newValue;
            this.render();
            this.bindEvents();
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

            // Always re-render options (not just when open) so they're ready when dropdown opens
            this.optionsEl.innerHTML = this.renderOptions();
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
            // Restore the original select element visibility
            if (this.linkedSelect) {
                this.linkedSelect.style.display = '';
                this.linkedSelect.removeAttribute('data-searchable');
            }
            // Remove the container from DOM entirely
            if (this.container && this.container.parentNode) {
                this.container.parentNode.removeChild(this.container);
            }
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

    // Remove any existing searchable container for this select
    const existingContainer = document.getElementById(`${selectId}-searchable-container`);
    if (existingContainer) {
        existingContainer.remove();
    }
    // Also remove any container created by the global auto-searchable-select
    // helper (it inserts a `.sd-auto-container` as a sibling to convert every
    // native <select> at page load). Without this cleanup, calling
    // convertSelectToSearchable explicitly in page code would leave a
    // duplicate dropdown stacked on top.
    const prev = select.previousElementSibling;
    const next = select.nextElementSibling;
    if (prev && prev.classList?.contains('sd-auto-container')) prev.remove();
    if (next && next.classList?.contains('sd-auto-container')) next.remove();
    delete select.dataset.sdConverted;
    select.style.display = '';
    select.removeAttribute('data-searchable');

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

    // Observe external mutations of the linked native <select>. When other code
    // does `select.value = "foo"; select.dispatchEvent(new Event("change"))`,
    // the wrapper's visible label, internal selectedValue, and data-value attr
    // would otherwise stay stale. The value-comparison guard prevents recursion
    // when the wrapper itself triggers the change event from setValue().
    const syncFromLinked = () => {
        if (String(select.value) !== String(dropdown.getValue() ?? '')) {
            dropdown.setValue(select.value, false);
        }
    };
    select.addEventListener('change', syncFromLinked);

    // form.reset() does NOT fire 'change' on selects, so we also need to listen
    // on the parent form's 'reset' event. Without this, reopening a modal after
    // a previous fill-and-cancel leaves stale labels in every wrapped dropdown
    // (the underlying select gets reset to the first option, but the wrapper's
    // visible text and data-value attribute stay frozen at the previous values).
    const parentForm = select.closest('form');
    if (parentForm) {
        parentForm.addEventListener('reset', () => {
            // 'reset' fires before the form actually resets the controls; wait
            // one tick so we read the post-reset value of the linked select.
            setTimeout(syncFromLinked, 0);
        });
    }

    // Watch for external code rewriting the linked <select>.innerHTML — for
    // example, dependent dropdowns where the available options change when a
    // parent field is picked (Account Group filtered by Account Type, City
    // filtered by Country, etc.). Without this MutationObserver, the wrapper
    // would still hold the option list snapshot from conversion time and
    // wouldn't recognise newly-added options.
    if (typeof MutationObserver !== 'undefined') {
        const optionsObserver = new MutationObserver(() => {
            const newOpts = Array.from(select.options).map(opt => ({
                value: opt.value,
                label: opt.textContent.trim(),
                description: opt.dataset.description || ''
            }));
            // Skip if options haven't actually changed (avoids resetting the
            // user's selection on every spurious mutation).
            const oldKey = (dropdown.options || []).map(o => o.value + '|' + o.label).join('||');
            const newKey = newOpts.map(o => o.value + '|' + o.label).join('||');
            if (oldKey === newKey) return;
            dropdown.setOptions(newOpts, true);
            // After re-loading options, re-sync to the current native value
            // in case the rewrite also changed the selected value.
            syncFromLinked();
        });
        optionsObserver.observe(select, { childList: true, subtree: true, characterData: true });
    }

    // Expose the dropdown instance on the linked <select> for callers that
    // want to manipulate it directly (rare; the observer above handles most
    // cases without anyone needing to know about the wrapper).
    select._searchableDropdown = dropdown;

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
