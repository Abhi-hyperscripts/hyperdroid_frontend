/**
 * HRMS Office Selection Utility
 * Manages persistent office selection across HRMS pages
 *
 * Office is the atomic unit in HRMS - each office has its own:
 * - Departments
 * - Designations
 * - Shifts
 * - Salary Structures
 * - Employees
 *
 * This utility ensures:
 * 1. First office is auto-selected on page load if no selection stored
 * 2. Selection persists across page navigations via localStorage
 * 3. Child dropdowns only show data for selected office
 */
const HrmsOfficeSelection = (function() {
    const STORAGE_KEY = 'hrms_selected_office_id';

    /**
     * Get the currently selected office ID from localStorage
     * @returns {string|null} The office ID or null if not set
     */
    function getSelectedOfficeId() {
        return localStorage.getItem(STORAGE_KEY);
    }

    /**
     * Save the selected office ID to localStorage
     * @param {string} officeId - The office ID to save
     */
    function setSelectedOfficeId(officeId) {
        if (officeId) {
            localStorage.setItem(STORAGE_KEY, officeId);
        } else {
            localStorage.removeItem(STORAGE_KEY);
        }
    }

    /**
     * Initialize office selection for a page
     * - If stored office exists in available offices, use it
     * - Otherwise, select first office and store it
     *
     * @param {Array} offices - Array of office objects with 'id' and 'is_active' properties
     * @returns {string|null} The office ID to use, or null if no offices available
     */
    function initializeSelection(offices) {
        const activeOffices = offices.filter(o => o.is_active !== false);
        if (activeOffices.length === 0) {
            console.warn('[HrmsOfficeSelection] No active offices available');
            return null;
        }

        const storedId = getSelectedOfficeId();

        // Check if stored office exists in available offices
        if (storedId && activeOffices.some(o => o.id === storedId)) {
            return storedId;
        }

        // Otherwise select first office
        const firstOfficeId = activeOffices[0].id;
        setSelectedOfficeId(firstOfficeId);
        console.log('[HrmsOfficeSelection] Auto-selected first office:', firstOfficeId);
        return firstOfficeId;
    }

    /**
     * Format office label with country
     * @param {Object} office - Office object with office_name and country fields
     * @returns {string} Formatted label like "Mumbai Headquarters (India)"
     */
    function formatOfficeLabel(office) {
        const name = office.office_name || office.name || '';
        const country = office.country || '';
        if (country) {
            return `${name} (${country})`;
        }
        return name;
    }

    /**
     * Build options array for dropdown
     * For FILTER dropdowns: NO placeholder, just the offices (first will be selected)
     * For FORM dropdowns: Include "Select Office" placeholder
     *
     * @param {Array} offices - Array of office objects
     * @param {Object} options - Configuration options
     * @param {boolean} options.isFormDropdown - If true, include "Select Office" placeholder
     * @returns {Array} Options array for SearchableDropdown or native select
     */
    function buildOfficeOptions(offices, { isFormDropdown = false } = {}) {
        const activeOffices = offices.filter(o => o.is_active !== false);

        if (isFormDropdown) {
            return [
                { value: '', label: 'Select Office' },
                ...activeOffices.map(o => ({ value: o.id, label: formatOfficeLabel(o) }))
            ];
        }

        // Filter dropdowns - NO "All Offices", just office list
        return activeOffices.map(o => ({ value: o.id, label: formatOfficeLabel(o) }));
    }

    /**
     * Build HTML options string for native select elements
     * @param {Array} offices - Array of office objects
     * @param {string} selectedId - Currently selected office ID
     * @param {Object} options - Configuration options
     * @param {boolean} options.isFormDropdown - If true, include "Select Office" placeholder
     * @returns {string} HTML string of option elements
     */
    function buildOfficeOptionsHtml(offices, selectedId, { isFormDropdown = false } = {}) {
        const activeOffices = offices.filter(o => o.is_active !== false);
        let html = '';

        if (isFormDropdown) {
            html = '<option value="">Select Office</option>';
        }

        html += activeOffices.map(o => {
            const selected = o.id === selectedId ? ' selected' : '';
            const label = escapeHtml(formatOfficeLabel(o));
            return `<option value="${o.id}"${selected}>${label}</option>`;
        }).join('');

        return html;
    }

    /**
     * Escape HTML to prevent XSS
     * @param {string} str - String to escape
     * @returns {string} Escaped string
     */
    function escapeHtml(str) {
        if (!str) return '';
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    return {
        getSelectedOfficeId,
        setSelectedOfficeId,
        initializeSelection,
        buildOfficeOptions,
        buildOfficeOptionsHtml,
        formatOfficeLabel,
        STORAGE_KEY
    };
})();
