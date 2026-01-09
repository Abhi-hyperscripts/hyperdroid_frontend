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

// Compliance-first: Countries and States from statutory compliance
let complianceCountries = [];
let complianceStates = [];  // States with PT configured

// Store for searchable dropdown instances (local to organization page)
const searchableDropdownInstances = new Map();

/**
 * Generate year options for a searchable dropdown
 * @param {number} yearsBack - How many years back from current year
 * @param {number} yearsForward - How many years forward from current year
 * @returns {Array} Array of {value, label} objects
 */
function generateYearOptions(yearsBack = 20, yearsForward = 5) {
    const currentYear = new Date().getFullYear();
    const years = [];

    // Future years first (descending)
    for (let y = currentYear + yearsForward; y > currentYear; y--) {
        years.push({ value: y, label: String(y) });
    }

    // Current year and past years
    for (let y = currentYear; y >= currentYear - yearsBack; y--) {
        years.push({ value: y, label: String(y) });
    }

    return years;
}

// Store for holiday year picker
let holidayYearPicker = null;

/**
 * Initialize the holiday year searchable dropdown
 */
function initHolidayYearPicker() {
    const container = document.getElementById('holidayYearPicker');
    if (!container) return;

    // Check if SearchableDropdown class is available
    if (typeof SearchableDropdown !== 'function') {
        console.warn('SearchableDropdown class not available for holidayYearPicker');
        return;
    }

    const currentYear = new Date().getFullYear();
    const yearOptions = generateYearOptions(20, 5);

    holidayYearPicker = new SearchableDropdown(container, {
        id: 'holidayYearDropdown',
        options: yearOptions,
        value: currentYear,
        placeholder: 'Select Year',
        searchPlaceholder: 'Search year...',
        onChange: (value) => {
            loadHolidays();
        }
    });
}

/**
 * Get the selected holiday year
 * @returns {number} The selected year
 */
function getHolidayYear() {
    if (holidayYearPicker) {
        return holidayYearPicker.getValue();
    }
    return new Date().getFullYear();
}

/**
 * Initialize searchable dropdowns with retry mechanism for script loading timing
 * Retries up to 5 times with 100ms delay if SearchableDropdown isn't available yet
 */
function initSearchableDropdownsWithRetry(retryCount = 0, maxRetries = 20) {
    const searchableAvailable = typeof SearchableDropdown === 'function' && typeof convertSelectToSearchable === 'function';
    const officeSelectionAvailable = typeof HrmsOfficeSelection !== 'undefined';

    if (searchableAvailable && officeSelectionAvailable) {
        initHolidayYearPicker();
        initOrganizationSearchableDropdowns();
        console.log('[Organization] Searchable dropdowns initialized on retry', retryCount);
    } else if (retryCount < maxRetries) {
        setTimeout(() => initSearchableDropdownsWithRetry(retryCount + 1, maxRetries), 50);
    } else {
        console.warn('[Organization] Dependencies not available after retries, using native selects');
        console.warn('SearchableDropdown:', typeof SearchableDropdown, 'convertSelectToSearchable:', typeof convertSelectToSearchable, 'HrmsOfficeSelection:', typeof HrmsOfficeSelection);
    }
}

/**
 * Initialize all searchable dropdowns on the organization page
 * This converts standard <select> elements to searchable dropdowns
 */
function initOrganizationSearchableDropdowns() {
    // Check if convertSelectToSearchable function is available
    if (typeof convertSelectToSearchable !== 'function') {
        console.warn('convertSelectToSearchable function not available, dropdowns will remain native');
        return;
    }

    // Helper function to convert and store dropdown instance
    function convertAndStore(id, options) {
        const dropdown = convertSelectToSearchable(id, options);
        if (dropdown) {
            searchableDropdownInstances.set(id, dropdown);
        }
        return dropdown;
    }

    // ========================================
    // FILTER DROPDOWNS (compact variant)
    // ========================================

    // Department filters - auto-selects first office, persists selection
    convertAndStore('departmentOffice', {
        placeholder: 'Select Office',
        searchPlaceholder: 'Search offices...',
        compact: true,
        onChange: (value) => {
            HrmsOfficeSelection.setSelectedOfficeId(value);
            updateDepartmentsTable();
        }
    });

    // Designation filters - auto-selects first office, persists selection
    convertAndStore('designationOffice', {
        placeholder: 'Select Office',
        searchPlaceholder: 'Search offices...',
        compact: true,
        onChange: (value) => {
            HrmsOfficeSelection.setSelectedOfficeId(value);
            // When office changes, update department filter options
            updateDesignationDepartmentFilter();
            updateDesignationsTable();
        }
    });

    convertAndStore('designationDepartment', {
        placeholder: 'All Departments',
        searchPlaceholder: 'Search departments...',
        compact: true,
        onChange: () => updateDesignationsTable()
    });

    // Shift filters - auto-selects first office, persists selection
    convertAndStore('shiftOffice', {
        placeholder: 'Select Office',
        searchPlaceholder: 'Search offices...',
        compact: true,
        onChange: (value) => {
            HrmsOfficeSelection.setSelectedOfficeId(value);
            updateShiftsTable();
        }
    });

    // Roster filters - auto-selects first office, persists selection, cascades shifts
    convertAndStore('rosterOffice', {
        placeholder: 'Select Office',
        searchPlaceholder: 'Search offices...',
        compact: true,
        onChange: (value) => {
            HrmsOfficeSelection.setSelectedOfficeId(value);
            // Re-populate shifts filtered by the new office
            updateRosterShiftFilter(value);
            updateRostersTable();
        }
    });

    convertAndStore('rosterShift', {
        placeholder: 'Select Shift',
        searchPlaceholder: 'Search shifts...',
        compact: true,
        onChange: () => updateRostersTable()
    });

    // Holiday filters - auto-selects first office, persists selection
    convertAndStore('holidayOffice', {
        placeholder: 'Select Office',
        searchPlaceholder: 'Search offices...',
        compact: true,
        onChange: (value) => {
            HrmsOfficeSelection.setSelectedOfficeId(value);
            updateHolidaysTable();
        }
    });

    convertAndStore('holidayType', {
        placeholder: 'All Types',
        searchPlaceholder: 'Search types...',
        compact: true,
        onChange: () => updateHolidaysTable()
    });

    // ========================================
    // FORM MODAL DROPDOWNS
    // ========================================

    // Office Modal
    convertAndStore('officeType', {
        placeholder: 'Select Type',
        searchPlaceholder: 'Search types...'
    });

    // Department Modal
    convertAndStore('deptOffice', {
        placeholder: 'Select Office',
        searchPlaceholder: 'Search offices...'
    });

    convertAndStore('deptHead', {
        placeholder: 'Select Employee',
        searchPlaceholder: 'Search employees...',
        virtualScroll: true
    });

    // Shift Modal
    convertAndStore('shiftOfficeId', {
        placeholder: 'Select Office',
        searchPlaceholder: 'Search offices...'
    });

    // Holiday Modal
    convertAndStore('holidayTypeSelect', {
        placeholder: 'Select Type',
        searchPlaceholder: 'Search types...'
    });

    convertAndStore('holidayOffices', {
        placeholder: 'All Offices (National)',
        searchPlaceholder: 'Search offices...'
    });

    // Roster Modal
    convertAndStore('rosterEmployee', {
        placeholder: 'Select Employee',
        searchPlaceholder: 'Search employees...',
        virtualScroll: true
    });

    convertAndStore('rosterShiftId', {
        placeholder: 'Select Shift',
        searchPlaceholder: 'Search shifts...'
    });

    convertAndStore('rosterType', {
        placeholder: 'Select Type',
        searchPlaceholder: 'Search types...'
    });

    // Bulk Holiday Modal
    convertAndStore('bulkHolidayYear', {
        placeholder: 'Select Year',
        searchPlaceholder: 'Search year...'
    });

    convertAndStore('bulkHolidayOffice', {
        placeholder: 'All Offices',
        searchPlaceholder: 'Search offices...'
    });

    // Bulk Roster Modal
    convertAndStore('bulkRosterShift', {
        placeholder: 'Select Shift',
        searchPlaceholder: 'Search shifts...'
    });

    convertAndStore('bulkRosterType', {
        placeholder: 'Select Type',
        searchPlaceholder: 'Search types...'
    });

    convertAndStore('bulkRosterDepartmentFilter', {
        placeholder: 'All Departments',
        searchPlaceholder: 'Search departments...',
        onChange: () => {
            filterBulkRosterEmployees();
            updateBulkRosterCount();
        }
    });

    // Bulk Assignment Modal (if present)
    convertAndStore('bulkOfficeId', {
        placeholder: 'Select Office',
        searchPlaceholder: 'Search offices...',
        onChange: () => previewBulkAssignment()
    });

    convertAndStore('bulkDepartmentId', {
        placeholder: 'Select Department',
        searchPlaceholder: 'Search departments...',
        onChange: () => previewBulkAssignment()
    });

    convertAndStore('bulkDesignationId', {
        placeholder: 'Select Designation',
        searchPlaceholder: 'Search designations...',
        onChange: () => previewBulkAssignment()
    });

    console.log('Organization searchable dropdowns initialized');
}

/**
 * Update designation department filter based on selected office
 */
function updateDesignationDepartmentFilter() {
    const officeId = getSearchableDropdownValue('designationOffice');
    const deptDropdown = searchableDropdownInstances.get('designationDepartment');

    if (!deptDropdown) return;

    let filteredDepts;
    if (officeId) {
        filteredDepts = departments.filter(d => d.is_active && d.office_id === officeId);
    } else {
        filteredDepts = departments.filter(d => d.is_active);
    }

    const options = [
        { value: '', label: 'All Departments' },
        ...filteredDepts.map(d => ({ value: d.id, label: d.department_name }))
    ];

    deptDropdown.setOptions(options);
    deptDropdown.setValue(''); // Reset selection
}

/**
 * Helper to get value from searchable dropdown or fall back to standard select
 */
function getSearchableDropdownValue(id) {
    const dropdown = searchableDropdownInstances.get(id);
    if (dropdown) {
        return dropdown.getValue();
    }
    // Fallback to standard select
    const select = document.getElementById(id);
    return select ? select.value : '';
}

/**
 * Helper to set value on searchable dropdown
 */
function setSearchableDropdownValue(id, value) {
    const dropdown = searchableDropdownInstances.get(id);
    if (dropdown) {
        dropdown.setValue(value);
    } else {
        const select = document.getElementById(id);
        if (select) select.value = value;
    }
}

/**
 * Helper to update options on searchable dropdown
 */
function updateSearchableDropdownOptions(id, options) {
    const dropdown = searchableDropdownInstances.get(id);
    if (dropdown) {
        dropdown.setOptions(options);
    }
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

    // Use compliance countries (only countries configured in statutory compliance)
    // Fall back to hardcoded COUNTRIES if compliance data not loaded yet
    const countriesToUse = complianceCountries.length > 0
        ? complianceCountries.map(c => ({ value: c.country_name, code: c.country_code, id: c.id }))
        : COUNTRIES;

    const filtered = countriesToUse.filter(c =>
        c.value.toLowerCase().includes(filterLower) ||
        c.code.toLowerCase().includes(filterLower)
    );

    if (filtered.length === 0) {
        container.innerHTML = '<div class="dropdown-no-match">No countries configured in compliance. Please configure countries in Statutory Compliance first.</div>';
        return;
    }

    container.innerHTML = filtered.map(c => `
        <div class="dropdown-option ${c.value === selectedValue ? 'selected' : ''}"
             onclick="selectCountry('${escapeHtml(c.value)}', '${escapeHtml(c.code)}', '${c.id || ''}')">
            <span class="dropdown-option-text">${escapeHtml(c.value)}</span>
            <span class="dropdown-option-subtext">${c.code}</span>
        </div>
    `).join('');
}

function selectCountry(countryName, countryCode, countryId) {
    document.getElementById('officeCountry').value = countryName;
    document.getElementById('officeCountryCode').value = countryCode || '';
    document.getElementById('officeCountryId').value = countryId || '';
    document.getElementById('countrySelection').textContent = countryName;
    document.getElementById('countrySelection').classList.remove('placeholder');
    document.getElementById('countryDropdown').classList.remove('open');

    // Clear state selection when country changes
    document.getElementById('officeState').value = '';
    document.getElementById('officeStateCode').value = '';
    document.getElementById('officeStateId').value = '';

    // Compliance-first: Update state dropdown based on selected country
    updateStateDropdownForCountry(countryName);
}

function filterCountries() {
    const searchValue = document.getElementById('countrySearch').value;
    renderCountryOptions(searchValue);
}

// ==================== Compliance-First: State Dropdown Functions ====================

function updateStateDropdownForCountry(countryName) {
    const stateDropdown = document.getElementById('stateDropdown');
    const stateSelection = document.getElementById('stateSelection');
    const officeState = document.getElementById('officeState');

    if (!stateDropdown || !stateSelection || !officeState) return;

    // Get states with tax rules configured for this country
    const availableStates = getStatesForCountry(countryName);

    if (availableStates.length === 0) {
        // No states configured - show message
        stateDropdown.classList.add('disabled');
        stateSelection.textContent = 'No states configured';
        stateSelection.classList.add('placeholder');
        officeState.value = '';
    } else {
        // States available - enable dropdown
        stateDropdown.classList.remove('disabled');
        stateSelection.textContent = 'Select State';
        stateSelection.classList.add('placeholder');
        officeState.value = '';
    }

    // Re-render state options
    renderStateOptions('');
}

function renderStateOptions(filter = '') {
    const container = document.getElementById('stateOptions');
    if (!container) return;

    const selectedValue = document.getElementById('officeState')?.value || '';
    const filterLower = filter.toLowerCase();

    // Get country and its states
    const countryName = document.getElementById('officeCountry')?.value || '';
    const availableStates = getStatesForCountry(countryName);

    const filtered = availableStates.filter(s =>
        s.state_name?.toLowerCase().includes(filterLower) ||
        s.state_code?.toLowerCase().includes(filterLower)
    );

    if (availableStates.length === 0) {
        container.innerHTML = '<div class="dropdown-no-match">No states with tax rules configured for this country</div>';
        return;
    }

    if (filtered.length === 0) {
        container.innerHTML = '<div class="dropdown-no-match">No states found</div>';
        return;
    }

    container.innerHTML = filtered.map(s => `
        <div class="dropdown-option ${s.state_name === selectedValue ? 'selected' : ''}"
             onclick="selectState('${escapeHtml(s.state_name)}', '${escapeHtml(s.state_code || '')}', '${s.id || ''}')">
            <span class="dropdown-option-text">${escapeHtml(s.state_name)}</span>
            <span class="dropdown-option-subtext">${s.state_code || ''}</span>
        </div>
    `).join('');
}

function selectState(stateName, stateCode, stateId) {
    document.getElementById('officeState').value = stateName;
    document.getElementById('officeStateCode').value = stateCode || '';
    document.getElementById('officeStateId').value = stateId || '';
    document.getElementById('stateSelection').textContent = stateName;
    document.getElementById('stateSelection').classList.remove('placeholder');
    document.getElementById('stateDropdown').classList.remove('open');
}

function filterStates() {
    const searchValue = document.getElementById('stateSearch')?.value || '';
    renderStateOptions(searchValue);
}

function toggleStateDropdown() {
    const stateDropdown = document.getElementById('stateDropdown');
    if (!stateDropdown || stateDropdown.classList.contains('disabled')) return;

    const isOpen = stateDropdown.classList.contains('open');

    // Close other dropdowns
    document.querySelectorAll('.searchable-dropdown.open').forEach(d => {
        if (d.id !== 'stateDropdown') d.classList.remove('open');
    });

    if (isOpen) {
        stateDropdown.classList.remove('open');
    } else {
        stateDropdown.classList.add('open');
        const searchInput = document.getElementById('stateSearch');
        if (searchInput) {
            searchInput.value = '';
            searchInput.focus();
            renderStateOptions('');
        }
    }
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
function initOfficeModalDropdowns(selectedTimezone = 'Asia/Kolkata', selectedCountry = 'India', selectedState = '') {
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

    // Initialize state dropdown (compliance-first)
    const stateDropdown = document.getElementById('stateDropdown');
    const stateSelection = document.getElementById('stateSelection');
    const officeStateInput = document.getElementById('officeState');

    if (stateDropdown && stateSelection && officeStateInput) {
        const availableStates = getStatesForCountry(selectedCountry);

        if (availableStates.length === 0) {
            stateDropdown.classList.add('disabled');
            stateSelection.textContent = 'No states configured';
            stateSelection.classList.add('placeholder');
            officeStateInput.value = '';
        } else if (selectedState) {
            stateDropdown.classList.remove('disabled');
            officeStateInput.value = selectedState;
            stateSelection.textContent = selectedState;
            stateSelection.classList.remove('placeholder');
        } else {
            stateDropdown.classList.remove('disabled');
            officeStateInput.value = '';
            stateSelection.textContent = 'Select State';
            stateSelection.classList.add('placeholder');
        }
    }

    renderTimezoneOptions();
    renderCountryOptions();
    renderStateOptions();
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

/**
 * Check if compliance setup is complete
 * Returns true if compliance is complete, false otherwise
 */
async function checkComplianceStatus() {
    try {
        const response = await api.request('/hrms/dashboard/setup-status');
        if (response && response.is_compliance_complete !== undefined) {
            return response.is_compliance_complete;
        }
        // If we can't determine compliance status, allow access (fail open for UX)
        console.warn('Could not determine compliance status, allowing access');
        return true;
    } catch (error) {
        console.error('Error checking compliance status:', error);
        // If API fails, allow access (fail open) but log the error
        return true;
    }
}

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

        // CRITICAL: Check if compliance setup is complete before allowing organization setup
        const complianceComplete = await checkComplianceStatus();
        if (!complianceComplete) {
            showToast('Please complete Compliance setup first before configuring Organization', 'error');
            window.location.href = 'compliance.html';
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

        // Initialize searchable dropdowns with retry for script loading timing
        initSearchableDropdownsWithRetry();

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
    // Support both sidebar-btn (new) and tab-btn (legacy) selectors
    const tabBtns = document.querySelectorAll('.sidebar-btn[data-tab], .tab-btn[data-tab]');
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
        loadHolidays(),
        loadComplianceCountries(),
        loadComplianceStates()
    ]);

    // Re-populate dropdowns after all data is loaded (fixes race condition)
    // This ensures office dropdown has data when designations/shifts/etc tabs load
    populateOfficeSelects();
    populateDepartmentSelects();
    populateRosterFilters();

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

// ==================== Compliance-First: Load Countries & States ====================

async function loadComplianceCountries() {
    try {
        // Use the global countries API endpoint
        const response = await api.request('/hrms/countries');
        complianceCountries = response || [];
        console.log('Countries loaded:', complianceCountries.length);
    } catch (error) {
        console.error('Error loading countries:', error);
        complianceCountries = [];
    }
}

async function loadComplianceStates() {
    try {
        // Load all states from the global countries API
        const response = await api.request('/hrms/countries/states');
        complianceStates = response || [];
        console.log('States loaded:', complianceStates.length, complianceStates.map(s => s.state_name));
    } catch (error) {
        console.error('Error loading states:', error);
        complianceStates = [];
    }
}

// Get states for a specific country
function getStatesForCountry(countryIdOrName) {
    if (!countryIdOrName) return [];

    // Find the country by ID, name, or code
    const country = complianceCountries.find(c =>
        c.id === countryIdOrName ||
        c.country_name?.toLowerCase() === countryIdOrName.toLowerCase() ||
        c.country_code?.toLowerCase() === countryIdOrName.toLowerCase()
    );

    if (!country) return [];

    // Filter states that belong to this country
    return complianceStates.filter(s => s.country_id === country.id);
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
    const activeOffices = offices.filter(o => o.is_active);

    // Initialize office selection - auto-select first or use persisted
    const selectedOfficeId = HrmsOfficeSelection.initializeSelection(activeOffices);

    // FILTER dropdowns - NO "All Offices", auto-select first office
    const filterDropdowns = ['departmentOffice', 'designationOffice', 'shiftOffice', 'holidayOffice', 'structureOfficeFilter'];

    // FORM/MODAL dropdowns - Keep "Select Office" placeholder (user must explicitly choose)
    const formDropdowns = ['deptOffice', 'desigOffice', 'shiftOfficeId', 'structureOffice'];

    // SPECIAL: holidayOffices keeps "All Offices (National Holiday)" for national holidays
    const nationalHolidayDropdowns = ['holidayOffices'];

    // Populate FILTER dropdowns - auto-select first office
    filterDropdowns.forEach(id => {
        const options = HrmsOfficeSelection.buildOfficeOptions(activeOffices, { isFormDropdown: false });

        const dropdown = searchableDropdownInstances.get(id);
        if (dropdown) {
            dropdown.setOptions(options);
            if (selectedOfficeId) {
                dropdown.setValue(selectedOfficeId);
            }
        } else {
            const select = document.getElementById(id);
            if (select && select.tagName === 'SELECT') {
                select.innerHTML = HrmsOfficeSelection.buildOfficeOptionsHtml(activeOffices, selectedOfficeId, { isFormDropdown: false });
            }
        }
    });

    // Populate FORM dropdowns - keep "Select Office" placeholder
    formDropdowns.forEach(id => {
        const options = HrmsOfficeSelection.buildOfficeOptions(activeOffices, { isFormDropdown: true });

        const dropdown = searchableDropdownInstances.get(id);
        if (dropdown) {
            dropdown.setOptions(options);
        } else {
            const select = document.getElementById(id);
            if (select && select.tagName === 'SELECT') {
                select.innerHTML = HrmsOfficeSelection.buildOfficeOptionsHtml(activeOffices, null, { isFormDropdown: true });
            }
        }
    });

    // Populate NATIONAL HOLIDAY dropdown - keeps "All Offices (National Holiday)"
    nationalHolidayDropdowns.forEach(id => {
        const options = [
            { value: '', label: 'All Offices (National Holiday)' },
            ...activeOffices.map(o => ({ value: o.id, label: HrmsOfficeSelection.formatOfficeLabel(o) }))
        ];

        const dropdown = searchableDropdownInstances.get(id);
        if (dropdown) {
            dropdown.setOptions(options);
        } else {
            const select = document.getElementById(id);
            if (select && select.tagName === 'SELECT') {
                select.innerHTML = '<option value="">All Offices (National Holiday)</option>';
                activeOffices.forEach(office => {
                    select.innerHTML += `<option value="${escapeHtml(office.id)}">${escapeHtml(HrmsOfficeSelection.formatOfficeLabel(office))}</option>`;
                });
            }
        }
    });

    // Trigger initial filter updates with selected office
    if (selectedOfficeId) {
        // Update tables to show only selected office data
        updateDepartmentsTable();
        updateShiftsTable();
        updateHolidaysTable();
    }
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
    const officeFilter = getSearchableDropdownValue('departmentOffice');

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
    const officeFirstLabel = activeOffices.length === 0 ? 'No Offices' : 'All Offices';
    const officeOptions = [
        { value: '', label: officeFirstLabel },
        ...activeOffices.map(o => ({ value: o.id, label: o.office_name }))
    ];

    // Update searchable dropdown if exists, otherwise fallback to select
    const officeDropdown = searchableDropdownInstances.get('designationOffice');
    if (officeDropdown) {
        officeDropdown.setOptions(officeOptions);
    } else {
        const officeFilterSelect = document.getElementById('designationOffice');
        if (officeFilterSelect && officeFilterSelect.tagName === 'SELECT') {
            officeFilterSelect.innerHTML = `<option value="">${officeFirstLabel}</option>`;
            activeOffices.forEach(office => {
                officeFilterSelect.innerHTML += `<option value="${escapeHtml(office.id)}">${escapeHtml(office.office_name)}</option>`;
            });
        }
    }

    // Department filter dropdown - with "All Departments" option
    const deptFirstLabel = activeDepts.length === 0 ? 'No Departments' : 'All Departments';
    const deptOptions = [
        { value: '', label: deptFirstLabel },
        ...activeDepts.map(d => ({ value: d.id, label: d.department_name }))
    ];

    // Update searchable dropdown if exists, otherwise fallback to select
    const deptDropdown = searchableDropdownInstances.get('designationDepartment');
    if (deptDropdown) {
        deptDropdown.setOptions(deptOptions);
    } else {
        const filterSelect = document.getElementById('designationDepartment');
        if (filterSelect && filterSelect.tagName === 'SELECT') {
            filterSelect.innerHTML = `<option value="">${deptFirstLabel}</option>`;
            activeDepts.forEach(dept => {
                filterSelect.innerHTML += `<option value="${escapeHtml(dept.id)}">${escapeHtml(dept.department_name)}</option>`;
            });
        }
    }

    // Trigger filter update after dropdown is populated
    updateDesignationsTable();

    // Modal dropdown - requires specific department selection (not converted to searchable)
    const modalSelect = document.getElementById('desigDepartment');
    if (modalSelect && modalSelect.tagName === 'SELECT') {
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
    const officeFilter = getSearchableDropdownValue('departmentOffice');

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
    const officeFilter = getSearchableDropdownValue('designationOffice');
    const deptFilter = getSearchableDropdownValue('designationDepartment');

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
    const officeFilter = getSearchableDropdownValue('shiftOffice');

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

/**
 * Update the roster shift filter dropdown based on selected office
 * Shifts are office-specific, so when office changes, shift options must be filtered
 */
function updateRosterShiftFilter(officeId) {
    // Filter shifts by the selected office
    const filteredShifts = shifts.filter(s => s.is_active && (!s.office_id || s.office_id === officeId));

    let shiftOptions;
    let selectedShiftId = null;

    if (filteredShifts.length > 0) {
        shiftOptions = filteredShifts.map(s => ({ value: s.id, label: s.shift_name }));
        selectedShiftId = filteredShifts[0].id;
    } else {
        shiftOptions = [{ value: '', label: 'No shifts for this office' }];
    }

    // Update the shift dropdown
    const shiftDropdown = searchableDropdownInstances.get('rosterShift');
    if (shiftDropdown) {
        shiftDropdown.setOptions(shiftOptions);
        if (selectedShiftId) {
            shiftDropdown.setValue(selectedShiftId);
        }
    } else {
        const shiftSelect = document.getElementById('rosterShift');
        if (shiftSelect && shiftSelect.tagName === 'SELECT') {
            shiftSelect.innerHTML = filteredShifts.map(shift => {
                const selected = shift.id === selectedShiftId ? ' selected' : '';
                return `<option value="${escapeHtml(shift.id)}"${selected}>${escapeHtml(shift.shift_name)}</option>`;
            }).join('') || '<option value="">No shifts for this office</option>';
        }
    }
}

function updateRostersTable() {
    const tbody = document.getElementById('rostersTable');
    if (!tbody) return;

    const searchTerm = document.getElementById('rosterSearch')?.value?.toLowerCase() || '';
    const officeFilter = getSearchableDropdownValue('rosterOffice');
    const shiftFilter = getSearchableDropdownValue('rosterShift');

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
    const activeOffices = offices.filter(o => o.is_active);

    // Initialize office selection - auto-select first or use persisted
    const selectedOfficeId = HrmsOfficeSelection.initializeSelection(activeOffices);

    // Office filter options - NO "All Offices"
    const officeOptions = HrmsOfficeSelection.buildOfficeOptions(activeOffices, { isFormDropdown: false });

    // Update office dropdown
    const officeDropdown = searchableDropdownInstances.get('rosterOffice');
    if (officeDropdown) {
        officeDropdown.setOptions(officeOptions);
        if (selectedOfficeId) {
            officeDropdown.setValue(selectedOfficeId);
        }
    } else {
        const officeSelect = document.getElementById('rosterOffice');
        if (officeSelect && officeSelect.tagName === 'SELECT') {
            officeSelect.innerHTML = HrmsOfficeSelection.buildOfficeOptionsHtml(activeOffices, selectedOfficeId, { isFormDropdown: false });
        }
    }

    // Filter shifts by selected office - shifts belong to specific offices
    const filteredShifts = shifts.filter(s => s.is_active && (!s.office_id || s.office_id === selectedOfficeId));

    // Shift filter options - NO "All Shifts", auto-select first shift for this office
    let shiftOptions;
    let selectedShiftId = null;
    if (filteredShifts.length > 0) {
        shiftOptions = filteredShifts.map(s => ({ value: s.id, label: s.shift_name }));
        selectedShiftId = filteredShifts[0].id;
    } else {
        shiftOptions = [{ value: '', label: 'No shifts for this office' }];
    }

    // Update shift dropdown
    const shiftDropdown = searchableDropdownInstances.get('rosterShift');
    if (shiftDropdown) {
        shiftDropdown.setOptions(shiftOptions);
        if (selectedShiftId) {
            shiftDropdown.setValue(selectedShiftId);
        }
    } else {
        const shiftSelect = document.getElementById('rosterShift');
        if (shiftSelect && shiftSelect.tagName === 'SELECT') {
            shiftSelect.innerHTML = filteredShifts.map(shift => {
                const selected = shift.id === selectedShiftId ? ' selected' : '';
                return `<option value="${escapeHtml(shift.id)}"${selected}>${escapeHtml(shift.shift_name)}</option>`;
            }).join('') || '<option value="">No shifts for this office</option>';
        }
    }

    // Update roster table with selected office/shift
    updateRostersTable();
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
        const year = getHolidayYear();
        const response = await api.request(`/hrms/holidays?year=${year}`);
        holidays = Array.isArray(response) ? response : (response?.data || []);
        updateHolidaysTable();
    } catch (error) {
        console.error('Error loading holidays:', error);
    }
}

function updateHolidaysTable() {
    const tbody = document.getElementById('holidaysTable');
    const officeFilter = getSearchableDropdownValue('holidayOffice');
    const typeFilter = getSearchableDropdownValue('holidayType');

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

        // Build employee options
        const employeeOptions = [
            { value: '', label: 'Select Employee' },
            ...employees.map(emp => {
                const empName = `${emp.first_name || ''} ${emp.last_name || ''}`.trim() || emp.employee_code;
                return { value: emp.id, label: empName };
            })
        ];

        // Update searchable dropdown if exists, otherwise fallback to select
        const dropdown = searchableDropdownInstances.get('deptHead');
        if (dropdown) {
            dropdown.setOptions(employeeOptions);
        } else {
            const select = document.getElementById('deptHead');
            if (select && select.tagName === 'SELECT') {
                select.innerHTML = '<option value="">Select Employee</option>';
                employees.forEach(emp => {
                    const empName = `${emp.first_name || ''} ${emp.last_name || ''}`.trim() || emp.employee_code;
                    select.innerHTML += `<option value="${escapeHtml(emp.id)}">${escapeHtml(empName)}</option>`;
                });
            }
        }

        // Also update rosterEmployee dropdown
        populateRosterEmployeeSelect();
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

    // Clear state fields
    document.getElementById('officeState').value = '';
    document.getElementById('officeStateCode').value = '';
    document.getElementById('officeStateId').value = '';

    // Set default country to India (find India from compliance countries)
    const india = complianceCountries.find(c => c.country_code === 'IN');
    document.getElementById('officeCountry').value = 'India';
    document.getElementById('officeCountryCode').value = 'IN';
    document.getElementById('officeCountryId').value = india?.id || '';

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

    // Initialize searchable dropdowns with office values (including state)
    initOfficeModalDropdowns(office.timezone || 'Asia/Kolkata', office.country || 'India', office.state || '');

    // Set state fields (including FK state_id)
    document.getElementById('officeState').value = office.state || '';
    document.getElementById('officeStateCode').value = office.state_code || '';
    document.getElementById('officeStateId').value = office.state_id || '';

    // Set country fields (including FK country_id)
    document.getElementById('officeCountry').value = office.country || '';
    document.getElementById('officeCountryCode').value = office.country_code || '';
    document.getElementById('officeCountryId').value = office.country_id || '';

    document.getElementById('officeAddress').value = office.address_line1 || '';
    document.getElementById('officeCity').value = office.city || '';
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
    // Build employee options
    const employeeOptions = [
        { value: '', label: 'Select Employee' },
        ...employees.map(emp => {
            const name = `${emp.first_name || ''} ${emp.last_name || ''}`.trim() || emp.employee_code;
            return { value: emp.id, label: `${name} (${emp.employee_code || ''})` };
        })
    ];

    // Update searchable dropdown if exists, otherwise fallback to select
    const dropdown = searchableDropdownInstances.get('rosterEmployee');
    if (dropdown) {
        dropdown.setOptions(employeeOptions);
    } else {
        const select = document.getElementById('rosterEmployee');
        if (select && select.tagName === 'SELECT') {
            select.innerHTML = '<option value="">Select Employee</option>';
            employees.forEach(emp => {
                const name = `${emp.first_name || ''} ${emp.last_name || ''}`.trim() || emp.employee_code;
                select.innerHTML += `<option value="${escapeHtml(emp.id)}">${escapeHtml(name)} (${escapeHtml(emp.employee_code || '')})</option>`;
            });
        }
    }
}

function populateRosterShiftSelect() {
    const activeShifts = shifts.filter(s => s.is_active);

    // Build shift options
    const shiftOptions = [
        { value: '', label: 'Select Shift' },
        ...activeShifts.map(s => ({ value: s.id, label: `${s.shift_name} (${s.shift_code})` }))
    ];

    // Update searchable dropdown if exists, otherwise fallback to select
    const dropdown = searchableDropdownInstances.get('rosterShiftId');
    if (dropdown) {
        dropdown.setOptions(shiftOptions);
    } else {
        const select = document.getElementById('rosterShiftId');
        if (select && select.tagName === 'SELECT') {
            select.innerHTML = '<option value="">Select Shift</option>';
            activeShifts.forEach(shift => {
                select.innerHTML += `<option value="${escapeHtml(shift.id)}">${escapeHtml(shift.shift_name)} (${escapeHtml(shift.shift_code)})</option>`;
            });
        }
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

        // Get country_id and state_id (required for compliance-driven payroll)
        const countryId = document.getElementById('officeCountryId').value;
        const stateId = document.getElementById('officeStateId').value;

        const data = {
            office_name: document.getElementById('officeName').value,
            office_code: document.getElementById('officeCode').value,
            // Auto-derive is_headquarters from office_type (dropdown has "head" option)
            is_headquarters: officeTypeVal === 'head',
            office_type: officeTypeVal,
            timezone: document.getElementById('officeTimezone').value,
            address_line1: document.getElementById('officeAddress').value,
            city: document.getElementById('officeCity').value,
            // FK references to countries and country_states tables (REQUIRED for compliance)
            country_id: countryId || null,
            state_id: stateId || null,
            // Deprecated text fields - maintained for backward compatibility
            state: document.getElementById('officeState').value || null,
            state_code: document.getElementById('officeStateCode').value || null,
            country: document.getElementById('officeCountry').value,
            country_code: document.getElementById('officeCountryCode').value || null,
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

    // Validate level - 0 is reserved for superadmin
    const level = parseInt(document.getElementById('desigLevel').value) || 1;
    if (level < 1) {
        showToast('Level must be 1 or higher. Level 0 is reserved for system use.', 'error');
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
            level: level,
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
    const confirmed = await Confirm.show({
        title: 'Delete Holiday',
        message: 'Are you sure you want to delete this holiday?',
        type: 'danger',
        confirmText: 'Delete',
        cancelText: 'Cancel'
    });

    if (!confirmed) return;

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
    const confirmed = await Confirm.show({
        title: 'Delete Roster',
        message: 'Are you sure you want to delete this roster assignment?',
        type: 'danger',
        confirmText: 'Delete',
        cancelText: 'Cancel'
    });

    if (!confirmed) return;

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
    const currentYear = new Date().getFullYear();

    // Year dropdown options
    const yearOptions = [];
    for (let y = currentYear - 1; y <= currentYear + 2; y++) {
        yearOptions.push({ value: y.toString(), label: y.toString() });
    }

    // Update searchable dropdown if exists, otherwise fallback to select
    const yearDropdown = searchableDropdownInstances.get('bulkHolidayYear');
    if (yearDropdown) {
        yearDropdown.setOptions(yearOptions);
        yearDropdown.setValue(currentYear.toString());
    } else {
        const yearSelect = document.getElementById('bulkHolidayYear');
        if (yearSelect && yearSelect.tagName === 'SELECT') {
            yearSelect.innerHTML = '';
            for (let y = currentYear - 1; y <= currentYear + 2; y++) {
                yearSelect.innerHTML += `<option value="${y}" ${y === currentYear ? 'selected' : ''}>${y}</option>`;
            }
        }
    }

    // Office dropdown options
    const officeOptions = [
        { value: '', label: 'All Offices' },
        ...offices.map(o => ({ value: o.id, label: o.office_name || o.name }))
    ];

    // Update searchable dropdown if exists, otherwise fallback to select
    const officeDropdown = searchableDropdownInstances.get('bulkHolidayOffice');
    if (officeDropdown) {
        officeDropdown.setOptions(officeOptions);
        officeDropdown.setValue('');
    } else {
        const officeSelect = document.getElementById('bulkHolidayOffice');
        if (officeSelect && officeSelect.tagName === 'SELECT') {
            officeSelect.innerHTML = '<option value="">All Offices</option>';
            offices.forEach(office => {
                officeSelect.innerHTML += `<option value="${office.id}">${office.office_name || office.name}</option>`;
            });
        }
    }

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
    // Shift dropdown options
    const shiftOptions = [
        { value: '', label: 'Select Shift' },
        ...shifts.map(s => ({ value: s.id, label: s.shift_name || s.name }))
    ];

    // Update searchable dropdown if exists, otherwise fallback to select
    const shiftDropdown = searchableDropdownInstances.get('bulkRosterShift');
    if (shiftDropdown) {
        shiftDropdown.setOptions(shiftOptions);
        shiftDropdown.setValue('');
    } else {
        const shiftSelect = document.getElementById('bulkRosterShift');
        if (shiftSelect && shiftSelect.tagName === 'SELECT') {
            shiftSelect.innerHTML = '<option value="">Select Shift</option>';
            shifts.forEach(shift => {
                shiftSelect.innerHTML += `<option value="${shift.id}">${shift.shift_name || shift.name}</option>`;
            });
        }
    }

    // Roster type dropdown - reset value
    const typeDropdown = searchableDropdownInstances.get('bulkRosterType');
    if (typeDropdown) {
        typeDropdown.setValue('scheduled');
    } else {
        const typeSelect = document.getElementById('bulkRosterType');
        if (typeSelect && typeSelect.tagName === 'SELECT') {
            typeSelect.value = 'scheduled';
        }
    }

    // Department filter options
    const deptOptions = [
        { value: '', label: 'All Departments' },
        ...departments.map(d => ({ value: d.id, label: d.department_name || d.name }))
    ];

    // Update searchable dropdown if exists, otherwise fallback to select
    const deptDropdown = searchableDropdownInstances.get('bulkRosterDepartmentFilter');
    if (deptDropdown) {
        deptDropdown.setOptions(deptOptions);
        deptDropdown.setValue('');
    } else {
        const deptFilter = document.getElementById('bulkRosterDepartmentFilter');
        if (deptFilter && deptFilter.tagName === 'SELECT') {
            deptFilter.innerHTML = '<option value="">All Departments</option>';
            departments.forEach(dept => {
                deptFilter.innerHTML += `<option value="${dept.id}">${dept.department_name || dept.name}</option>`;
            });
        }
    }

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
    const deptFilter = getSearchableDropdownValue('bulkRosterDepartmentFilter');

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
    const shiftId = getSearchableDropdownValue('bulkRosterShift');
    const rosterType = getSearchableDropdownValue('bulkRosterType') || 'scheduled';
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
    // Note: holidayYear picker has its own onChange callback in initHolidayYearPicker()
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

// ============================================================================
// COLLAPSIBLE SIDEBAR NAVIGATION
// ============================================================================

function setupSidebar() {
    const toggle = document.getElementById('sidebarToggle');
    const sidebar = document.getElementById('organizationSidebar');
    const activeTabName = document.getElementById('activeTabName');
    const container = document.querySelector('.hrms-container');

    if (!toggle || !sidebar) return;

    // Tab name mapping for display
    const tabNames = {
        'offices': 'Offices',
        'departments': 'Departments',
        'designations': 'Designations',
        'shifts': 'Shifts',
        'shift-rosters': 'Shift Rosters',
        'holidays': 'Holidays'
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

// ============================================
// SignalR Real-Time Event Handlers
// ============================================

/**
 * Called when organization structure is updated (from hrms-signalr.js)
 */
function onOrganizationUpdated(data) {
    console.log('[Organization] Update received:', data);

    // Handle both camelCase (from SignalR) and PascalCase property names
    const entityType = data.entityType || data.EntityType;
    const action = data.action || data.Action;
    const entityName = data.entityName || data.EntityName || entityType;

    // Show toast notification only if we have valid data
    if (entityType && action) {
        let message = '';
        switch(action) {
            case 'created':
                message = `${entityType} "${entityName}" was created`;
                break;
            case 'updated':
                message = `${entityType} "${entityName}" was updated`;
                break;
            case 'deleted':
                message = `${entityType} "${entityName}" was deleted`;
                break;
            case 'bulk_created':
                message = `${entityName} were created`;
                break;
            default:
                message = `${entityType} was ${action}`;
        }
        showToast(message, 'info');
    }

    // Reload the relevant data based on entity type
    switch(entityType) {
        case 'office':
            loadOffices();
            break;
        case 'department':
            loadDepartments();
            break;
        case 'designation':
            loadDesignations();
            break;
        case 'shift':
        case 'shift_roster':
            loadShifts();
            break;
        case 'holiday':
            loadHolidays();
            break;
        default:
            // Reload current tab data
            break;
    }
}

