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
    // Global list of all close functions for cross-component closing
    const allCloseFns = [];

    function registerDropdown(fp, type, closeFn) {
        if (!activeDropdowns.has(fp)) {
            activeDropdowns.set(fp, {});
        }
        activeDropdowns.get(fp)[type] = closeFn;
        allCloseFns.push(closeFn);
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
     * Close ALL open flatpickr custom dropdowns (month + year across all instances).
     * Called externally when other dropdowns (e.g. SearchableDropdown) open.
     */
    function closeAllFpDropdowns() {
        allCloseFns.forEach(fn => fn());
    }

    // Listen for custom event dispatched by SearchableDropdown and other components
    document.addEventListener('dropdownOpened', closeAllFpDropdowns);

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
            dropdown.style.zIndex = '999999';
        }

        function openDropdown() {
            // Close other flatpickr dropdowns first
            closeOtherDropdowns(fp, 'month');
            // Notify other components (SearchableDropdown, etc.) to close
            document.dispatchEvent(new CustomEvent('fpDropdownOpened'));
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
            // Use jumpToDate for reliable absolute month navigation
            fp.jumpToDate(new Date(fp.currentYear, monthIndex, 1));
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
            dropdown.style.zIndex = '999999';
        }

        function openDropdown() {
            // Close other flatpickr dropdowns first
            closeOtherDropdowns(fp, 'year');
            // Notify other components (SearchableDropdown, etc.) to close
            document.dispatchEvent(new CustomEvent('fpDropdownOpened'));
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

    // ─── Time-of-day select population ───────────────────────────────────
    //
    // Pattern: pair a Flatpickr-managed <input type="date"> with a
    // <select data-time-picker="true"> sibling. populateTimeSelect() fills
    // the select with HH:mm options at the requested interval (default
    // 15 min). The codebase's auto-searchable-select.js then converts the
    // <select> into a styled SearchableDropdown — gives users a clean
    // dropdown they can search by typing "2:30" etc.
    //
    // Why a populated <select> rather than <input type="time">: the native
    // time input shows OS-provided spinners that users find tedious, and
    // the AM/PM toggle isn't visually obvious. A dropdown of common times
    // is faster.

    function populateTimeSelect(el, intervalMinutes) {
        if (!el || el.tagName !== 'SELECT' || el.dataset.timePopulated === 'true') return;
        const step = Math.max(1, parseInt(intervalMinutes || el.dataset.timeStep || '15', 10));
        const placeholder = el.dataset.timePlaceholder || 'Select time';
        const previousValue = el.value;

        const opts = ['<option value="">' + placeholder + '</option>'];
        for (let mins = 0; mins < 24 * 60; mins += step) {
            const h24 = Math.floor(mins / 60);
            const m   = mins % 60;
            const ampm = h24 >= 12 ? 'PM' : 'AM';
            const h12 = ((h24 + 11) % 12) + 1;
            const value = String(h24).padStart(2, '0') + ':' + String(m).padStart(2, '0');
            const label = h12 + ':' + String(m).padStart(2, '0') + ' ' + ampm;
            opts.push('<option value="' + value + '">' + label + '</option>');
        }
        el.innerHTML = opts.join('');
        el.dataset.timePopulated = 'true';
        if (previousValue) el.value = previousValue;
    }

    function populateAllTimeSelects(root) {
        const scope = root || document;
        scope.querySelectorAll('select[data-time-picker="true"]').forEach(el => populateTimeSelect(el));
    }

    // Run once on script load + watch for dynamically-added time selects.
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => populateAllTimeSelects());
    } else {
        populateAllTimeSelects();
    }
    new MutationObserver(muts => {
        muts.forEach(m => m.addedNodes.forEach(node => {
            if (node.nodeType !== 1) return;
            if (node.matches && node.matches('select[data-time-picker="true"]')) populateTimeSelect(node);
            else if (node.querySelectorAll) populateAllTimeSelects(node);
        }));
    }).observe(document.body || document.documentElement, { childList: true, subtree: true });

    // ─── Helpers for date+time pairs ─────────────────────────────────────
    //
    // Why these exist: <input type="datetime-local"> renders a calendar-only
    // popup on macOS Safari (no time controls). Flatpickr with enableTime
    // works but its time UI is hard to use (AM/PM toggle isn't obvious, and
    // the spinner inputs are tedious to scroll). Best UX is TWO separate
    // inputs:
    //   - <input type="date" id="X">       (Flatpickr-managed, calendar)
    //   - <input type="time" id="XTime">   (native — works on every browser
    //                                       including Safari, lets users TYPE
    //                                       the time directly)
    //
    // These helpers read/write the pair as a single datetime-local-shaped
    // string ("YYYY-MM-DDTHH:mm") so calling code can treat it as one field.

    function _dateEl(baseId) { return document.getElementById(baseId); }
    function _timeEl(baseId) { return document.getElementById(baseId + 'Time'); }

    /**
     * Read a date/time pair as "YYYY-MM-DDTHH:mm" (datetime-local format).
     * Returns "" if the date input is empty.
     * If the time input is empty, defaults to "00:00".
     */
    function getDateTimeValue(baseId) {
        const dateEl = _dateEl(baseId);
        if (!dateEl || !dateEl.value) return '';
        // Flatpickr's date-only format is "Y-m-d", which is the same as
        // <input type="date"> native value — both yield "YYYY-MM-DD".
        const date = dateEl.value.split(' ')[0].split('T')[0];
        const timeEl = _timeEl(baseId);
        const time = (timeEl && timeEl.value) ? timeEl.value : '00:00';
        return date + 'T' + time;
    }

    /**
     * Set a date/time pair from a datetime-local-shaped or full ISO string.
     * Routes the date through Flatpickr's setDate() when the date input is
     * Flatpickr-managed; the time goes straight to the native time input.
     * Pass empty string / null to clear both.
     */
    function setDateTimeValue(baseId, value) {
        const dateEl = _dateEl(baseId);
        const timeEl = _timeEl(baseId);

        if (!value) {
            if (dateEl && dateEl._flatpickr) dateEl._flatpickr.clear();
            else if (dateEl) dateEl.value = '';
            if (timeEl) timeEl.value = '';
            return;
        }

        // Accept "YYYY-MM-DDTHH:mm[anything]" or "YYYY-MM-DD HH:mm[anything]"
        const normalized = String(value).replace(' ', 'T');
        const parts = normalized.split('T');
        const date = parts[0];
        const time = parts[1] ? parts[1].slice(0, 5) : '';

        if (dateEl) {
            if (dateEl._flatpickr) dateEl._flatpickr.setDate(date, false);
            else dateEl.value = date;
        }
        if (timeEl) timeEl.value = time;
    }

    // Expose functions globally for manual initialization
    window.HRMSDatePicker = {
        init: initDatePicker,
        initAll: initAllDatePickers,
        closeAll: closeAllFpDropdowns,
        config: defaultConfig,
        getDateTimeValue: getDateTimeValue,
        setDateTimeValue: setDateTimeValue,
        populateTimeSelect: populateTimeSelect,
        populateAllTimeSelects: populateAllTimeSelects
    };

})();
