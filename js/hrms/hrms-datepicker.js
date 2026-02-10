/**
 * HRMS Date Picker Utility
 * Initializes Flatpickr for consistent date picker experience across all browsers
 * Includes custom month/year selector matching app theme
 */

(function() {
    'use strict';

    const MONTHS = [
        'January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'
    ];

    // Store active dropdown closers per flatpickr instance
    const activeDropdowns = new WeakMap();

    function registerDropdown(fp, type, closeFn) {
        if (!activeDropdowns.has(fp)) {
            activeDropdowns.set(fp, {});
        }
        activeDropdowns.get(fp)[type] = closeFn;
    }

    function closeOtherDropdowns(fp, exceptType) {
        const dropdowns = activeDropdowns.get(fp);
        if (dropdowns) {
            Object.keys(dropdowns).forEach(type => {
                if (type !== exceptType && dropdowns[type]) {
                    dropdowns[type]();
                }
            });
        }
    }

    /**
     * Creates custom month selector to replace native dropdown
     */
    function createCustomMonthSelector(fp) {
        const monthSelect = fp.monthElements[0];
        if (!monthSelect || monthSelect.dataset.customized) return;

        // Mark as customized
        monthSelect.dataset.customized = 'true';

        // Hide native select
        monthSelect.style.opacity = '0';
        monthSelect.style.position = 'absolute';
        monthSelect.style.pointerEvents = 'none';
        monthSelect.style.width = '0';
        monthSelect.style.height = '0';

        // Create custom dropdown container
        const wrapper = document.createElement('div');
        wrapper.className = 'fp-custom-month-wrapper';

        const trigger = document.createElement('div');
        trigger.className = 'fp-custom-month-trigger';
        trigger.innerHTML = `
            <span class="fp-custom-month-text">${MONTHS[fp.currentMonth]}</span>
            <svg class="fp-custom-month-arrow" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="6 9 12 15 18 9"></polyline>
            </svg>
        `;

        const dropdown = document.createElement('div');
        dropdown.className = 'fp-custom-month-dropdown';

        // Add search input
        const searchInput = document.createElement('input');
        searchInput.type = 'text';
        searchInput.className = 'fp-custom-month-search';
        searchInput.placeholder = 'Search month...';
        dropdown.appendChild(searchInput);

        // Add month options
        const optionsList = document.createElement('div');
        optionsList.className = 'fp-custom-month-options';

        MONTHS.forEach((month, index) => {
            const option = document.createElement('div');
            option.className = 'fp-custom-month-option';
            option.dataset.month = index;
            option.textContent = month;
            if (index === fp.currentMonth) {
                option.classList.add('selected');
            }
            optionsList.appendChild(option);
        });

        dropdown.appendChild(optionsList);
        wrapper.appendChild(trigger);

        // Append dropdown to body to avoid overflow clipping
        document.body.appendChild(dropdown);

        // Insert trigger after the hidden select
        monthSelect.parentNode.insertBefore(wrapper, monthSelect.nextSibling);

        // Event handlers
        let isOpen = false;

        function positionDropdown() {
            const triggerRect = trigger.getBoundingClientRect();
            dropdown.style.position = 'fixed';
            dropdown.style.top = (triggerRect.bottom + 4) + 'px';
            dropdown.style.left = triggerRect.left + 'px';
        }

        function openDropdown() {
            // Close other dropdowns first
            closeOtherDropdowns(fp, 'month');
            isOpen = true;
            positionDropdown();
            dropdown.classList.add('open');
            trigger.classList.add('open');
            searchInput.value = '';
            filterOptions('');
            setTimeout(() => searchInput.focus(), 10);
        }

        function closeDropdown() {
            isOpen = false;
            dropdown.classList.remove('open');
            trigger.classList.remove('open');
        }

        // Register this dropdown's close function
        registerDropdown(fp, 'month', closeDropdown);

        function filterOptions(query) {
            const options = optionsList.querySelectorAll('.fp-custom-month-option');
            const lowerQuery = query.toLowerCase();
            options.forEach(opt => {
                const matches = opt.textContent.toLowerCase().includes(lowerQuery);
                opt.style.display = matches ? '' : 'none';
            });
        }

        function selectMonth(monthIndex) {
            fp.changeMonth(monthIndex - fp.currentMonth, false);
            trigger.querySelector('.fp-custom-month-text').textContent = MONTHS[monthIndex];

            // Update selected state
            optionsList.querySelectorAll('.fp-custom-month-option').forEach(opt => {
                opt.classList.toggle('selected', parseInt(opt.dataset.month) === monthIndex);
            });

            closeDropdown();
        }

        trigger.addEventListener('click', (e) => {
            e.stopPropagation();
            if (isOpen) {
                closeDropdown();
            } else {
                openDropdown();
            }
        });

        searchInput.addEventListener('input', (e) => {
            filterOptions(e.target.value);
        });

        searchInput.addEventListener('click', (e) => {
            e.stopPropagation();
        });

        searchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                closeDropdown();
            } else if (e.key === 'Enter') {
                const visibleOptions = optionsList.querySelectorAll('.fp-custom-month-option:not([style*="display: none"])');
                if (visibleOptions.length === 1) {
                    selectMonth(parseInt(visibleOptions[0].dataset.month));
                }
            }
        });

        optionsList.addEventListener('click', (e) => {
            e.stopPropagation();
            e.preventDefault();
            const option = e.target.closest('.fp-custom-month-option');
            if (option) {
                selectMonth(parseInt(option.dataset.month));
            }
        });

        // Prevent clicks on dropdown from closing flatpickr
        dropdown.addEventListener('mousedown', (e) => {
            e.stopPropagation();
        });

        dropdown.addEventListener('click', (e) => {
            e.stopPropagation();
        });

        // Close on click outside (but not when clicking inside flatpickr)
        document.addEventListener('click', (e) => {
            if (isOpen && !wrapper.contains(e.target) && !dropdown.contains(e.target)) {
                closeDropdown();
            }
        });

        // Store reference for updates
        wrapper._updateMonth = (month) => {
            trigger.querySelector('.fp-custom-month-text').textContent = MONTHS[month];
            optionsList.querySelectorAll('.fp-custom-month-option').forEach(opt => {
                opt.classList.toggle('selected', parseInt(opt.dataset.month) === month);
            });
        };

        return wrapper;
    }

    /**
     * Creates custom year selector with 100 years in past and future
     */
    function createCustomYearSelector(fp) {
        const yearInput = fp.currentYearElement;
        if (!yearInput || yearInput.dataset.customized) return;

        // Mark as customized
        yearInput.dataset.customized = 'true';

        // Hide native year input
        yearInput.style.opacity = '0';
        yearInput.style.position = 'absolute';
        yearInput.style.pointerEvents = 'none';
        yearInput.style.width = '0';
        yearInput.style.height = '0';

        // Also hide the year arrows
        const numInputWrapper = yearInput.closest('.numInputWrapper');
        if (numInputWrapper) {
            const arrows = numInputWrapper.querySelectorAll('.arrowUp, .arrowDown');
            arrows.forEach(arrow => arrow.style.display = 'none');
        }

        // Generate years (100 years past and future)
        const currentYear = new Date().getFullYear();
        const startYear = currentYear - 100;
        const endYear = currentYear + 100;
        const years = [];
        for (let y = endYear; y >= startYear; y--) {
            years.push(y);
        }

        // Create custom dropdown container
        const wrapper = document.createElement('div');
        wrapper.className = 'fp-custom-year-wrapper';

        const trigger = document.createElement('div');
        trigger.className = 'fp-custom-year-trigger';
        trigger.innerHTML = `
            <span class="fp-custom-year-text">${fp.currentYear}</span>
            <svg class="fp-custom-year-arrow" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="6 9 12 15 18 9"></polyline>
            </svg>
        `;

        const dropdown = document.createElement('div');
        dropdown.className = 'fp-custom-year-dropdown';

        // Add search input
        const searchInput = document.createElement('input');
        searchInput.type = 'text';
        searchInput.className = 'fp-custom-year-search';
        searchInput.placeholder = 'Search year...';
        dropdown.appendChild(searchInput);

        // Add year options
        const optionsList = document.createElement('div');
        optionsList.className = 'fp-custom-year-options';

        years.forEach(year => {
            const option = document.createElement('div');
            option.className = 'fp-custom-year-option';
            option.dataset.year = year;
            option.textContent = year;
            if (year === fp.currentYear) {
                option.classList.add('selected');
            }
            optionsList.appendChild(option);
        });

        dropdown.appendChild(optionsList);
        wrapper.appendChild(trigger);

        // Append dropdown to body to avoid overflow clipping
        document.body.appendChild(dropdown);

        // Insert trigger after the hidden input
        if (numInputWrapper) {
            numInputWrapper.parentNode.insertBefore(wrapper, numInputWrapper.nextSibling);
        } else {
            yearInput.parentNode.insertBefore(wrapper, yearInput.nextSibling);
        }

        // Event handlers
        let isOpen = false;

        function positionDropdown() {
            const triggerRect = trigger.getBoundingClientRect();
            dropdown.style.position = 'fixed';
            dropdown.style.top = (triggerRect.bottom + 4) + 'px';
            dropdown.style.left = triggerRect.left + 'px';
        }

        function openDropdown() {
            // Close other dropdowns first
            closeOtherDropdowns(fp, 'year');
            isOpen = true;
            positionDropdown();
            dropdown.classList.add('open');
            trigger.classList.add('open');
            searchInput.value = '';
            filterOptions('');

            // Scroll to selected year
            setTimeout(() => {
                const selectedOption = optionsList.querySelector('.selected');
                if (selectedOption) {
                    selectedOption.scrollIntoView({ block: 'center' });
                }
                searchInput.focus();
            }, 10);
        }

        function closeDropdown() {
            isOpen = false;
            dropdown.classList.remove('open');
            trigger.classList.remove('open');
        }

        // Register this dropdown's close function
        registerDropdown(fp, 'year', closeDropdown);

        function filterOptions(query) {
            const options = optionsList.querySelectorAll('.fp-custom-year-option');
            options.forEach(opt => {
                const matches = opt.textContent.includes(query);
                opt.style.display = matches ? '' : 'none';
            });
        }

        function selectYear(year) {
            fp.changeYear(year);
            trigger.querySelector('.fp-custom-year-text').textContent = year;

            // Update selected state
            optionsList.querySelectorAll('.fp-custom-year-option').forEach(opt => {
                opt.classList.toggle('selected', parseInt(opt.dataset.year) === year);
            });

            closeDropdown();
        }

        trigger.addEventListener('click', (e) => {
            e.stopPropagation();
            if (isOpen) {
                closeDropdown();
            } else {
                openDropdown();
            }
        });

        searchInput.addEventListener('input', (e) => {
            filterOptions(e.target.value);
        });

        searchInput.addEventListener('click', (e) => {
            e.stopPropagation();
        });

        searchInput.addEventListener('keydown', (e) => {
            e.stopPropagation();
            if (e.key === 'Escape') {
                closeDropdown();
            } else if (e.key === 'Enter') {
                const visibleOptions = optionsList.querySelectorAll('.fp-custom-year-option:not([style*="display: none"])');
                if (visibleOptions.length === 1) {
                    selectYear(parseInt(visibleOptions[0].dataset.year));
                }
            }
        });

        optionsList.addEventListener('click', (e) => {
            e.stopPropagation();
            e.preventDefault();
            const option = e.target.closest('.fp-custom-year-option');
            if (option) {
                selectYear(parseInt(option.dataset.year));
            }
        });

        // Prevent clicks on dropdown from closing flatpickr
        dropdown.addEventListener('mousedown', (e) => {
            e.stopPropagation();
        });

        dropdown.addEventListener('click', (e) => {
            e.stopPropagation();
        });

        // Close on click outside
        document.addEventListener('click', (e) => {
            if (isOpen && !wrapper.contains(e.target) && !dropdown.contains(e.target)) {
                closeDropdown();
            }
        });

        // Store reference for updates
        wrapper._updateYear = (year) => {
            trigger.querySelector('.fp-custom-year-text').textContent = year;
            optionsList.querySelectorAll('.fp-custom-year-option').forEach(opt => {
                opt.classList.toggle('selected', parseInt(opt.dataset.year) === year);
            });
        };

        return wrapper;
    }

    // Default Flatpickr configuration
    const defaultConfig = {
        dateFormat: 'Y-m-d',
        altInput: true,
        altFormat: 'd M Y',
        allowInput: true,
        disableMobile: true,
        animate: true,
        appendTo: document.body,
        monthSelectorType: 'dropdown',
        prevArrow: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"></polyline></svg>',
        nextArrow: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"></polyline></svg>',
        onReady: function(selectedDates, dateStr, instance) {
            // Create custom month selector
            const monthWrapper = createCustomMonthSelector(instance);

            // Create custom year selector
            const yearWrapper = createCustomYearSelector(instance);

            // Store wrapper references for updates
            instance._customMonthWrapper = monthWrapper;
            instance._customYearWrapper = yearWrapper;
        },
        onMonthChange: function(selectedDates, dateStr, instance) {
            // Update custom month display when month changes via arrows
            if (instance._customMonthWrapper && instance._customMonthWrapper._updateMonth) {
                instance._customMonthWrapper._updateMonth(instance.currentMonth);
            }
        },
        onYearChange: function(selectedDates, dateStr, instance) {
            // Update custom year display when year changes
            if (instance._customYearWrapper && instance._customYearWrapper._updateYear) {
                instance._customYearWrapper._updateYear(instance.currentYear);
            }
        }
    };

    /**
     * Initialize Flatpickr on a specific element
     * @param {HTMLElement|string} element - DOM element or selector
     * @param {Object} options - Additional Flatpickr options
     * @returns {Object} Flatpickr instance
     */
    function initDatePicker(element, options = {}) {
        if (typeof element === 'string') {
            element = document.querySelector(element);
        }

        if (!element) return null;

        // Skip if already initialized
        if (element._flatpickr) {
            return element._flatpickr;
        }

        // Merge callbacks properly
        const mergedConfig = { ...defaultConfig };

        if (options.onReady) {
            const userOnReady = options.onReady;
            mergedConfig.onReady = function(selectedDates, dateStr, instance) {
                defaultConfig.onReady.call(this, selectedDates, dateStr, instance);
                userOnReady.call(this, selectedDates, dateStr, instance);
            };
        }

        if (options.onMonthChange) {
            const userOnMonthChange = options.onMonthChange;
            mergedConfig.onMonthChange = function(selectedDates, dateStr, instance) {
                defaultConfig.onMonthChange.call(this, selectedDates, dateStr, instance);
                userOnMonthChange.call(this, selectedDates, dateStr, instance);
            };
        }

        const config = { ...mergedConfig, ...options };

        // Preserve existing value if present
        if (element.value) {
            config.defaultDate = element.value;
        }

        // IMPORTANT: Read placeholder BEFORE flatpickr converts input to hidden
        const originalPlaceholder = element.getAttribute('placeholder') || element.dataset.placeholder;

        const instance = flatpickr(element, config);

        // Apply placeholder to altInput if it exists
        if (instance.altInput && originalPlaceholder) {
            instance.altInput.placeholder = originalPlaceholder;
        }

        return instance;
    }

    /**
     * Initialize Flatpickr on all date inputs in a container
     * @param {HTMLElement|string} container - Container element or selector (default: document)
     * @param {Object} options - Additional Flatpickr options
     */
    function initAllDatePickers(container = document, options = {}) {
        if (typeof container === 'string') {
            container = document.querySelector(container);
        }

        if (!container) return;

        // Find all date inputs
        const dateInputs = container.querySelectorAll('input[type="date"]');

        dateInputs.forEach(input => {
            // Skip if already initialized
            if (input._flatpickr) return;

            // Check for data attributes for custom options
            const customOptions = {};

            if (input.dataset.minDate) {
                customOptions.minDate = input.dataset.minDate;
            }
            if (input.dataset.maxDate) {
                customOptions.maxDate = input.dataset.maxDate;
            }
            if (input.dataset.enableTime === 'true') {
                customOptions.enableTime = true;
                customOptions.dateFormat = 'Y-m-d H:i';
                customOptions.altFormat = 'd M Y h:i K';
            }

            initDatePicker(input, { ...options, ...customOptions });
        });
    }

    /**
     * Initialize date pickers when DOM is ready
     * Also sets up a MutationObserver to handle dynamically added date inputs
     */
    function autoInit() {
        // Initialize on page load
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => initAllDatePickers());
        } else {
            initAllDatePickers();
        }

        // Set up MutationObserver to handle dynamically added modals/elements
        const observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                mutation.addedNodes.forEach((node) => {
                    if (node.nodeType === Node.ELEMENT_NODE) {
                        // Check if the added node contains date inputs
                        if (node.matches && node.matches('input[type="date"]')) {
                            initDatePicker(node);
                        } else if (node.querySelectorAll) {
                            const dateInputs = node.querySelectorAll('input[type="date"]');
                            dateInputs.forEach(input => initDatePicker(input));
                        }
                    }
                });
            });
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true
        });
    }

    // Auto-initialize when script loads
    autoInit();

    // Expose functions globally for manual initialization
    window.HRMSDatePicker = {
        init: initDatePicker,
        initAll: initAllDatePickers,
        config: defaultConfig
    };

})();
