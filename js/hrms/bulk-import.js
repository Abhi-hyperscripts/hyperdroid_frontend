/**
 * Bulk Employee Import Module
 * Handles Excel file upload, validation, and two-phase import process
 */

// Global state
let parsedData = [];
let lookupData = {
    offices: [],
    departments: [],
    designations: [],
    shifts: [],
    salaryStructures: []
};
let importResults = {
    phase1: null, // User creation results
    phase2: null  // Employee creation results
};

// Template column definitions - using codes for unique identification
const TEMPLATE_COLUMNS = [
    { key: 'email', label: 'Email', required: true },
    { key: 'password', label: 'Password', required: false, hint: 'Leave empty to generate random' },
    { key: 'first_name', label: 'First Name', required: true },
    { key: 'last_name', label: 'Last Name', required: true },
    { key: 'employee_code', label: 'Employee Code', required: false, hint: 'Leave empty to auto-generate' },
    { key: 'office_code', label: 'Office Code', required: true },
    { key: 'department_code', label: 'Department Code', required: true },
    { key: 'designation_code', label: 'Designation Code', required: true },
    { key: 'shift_code', label: 'Shift Code', required: true },
    { key: 'salary_structure_code', label: 'Salary Structure Code', required: true },
    { key: 'date_of_joining', label: 'Date of Joining', required: true, format: 'YYYY-MM-DD' },
    { key: 'date_of_birth', label: 'Date of Birth', required: true, format: 'YYYY-MM-DD' },
    { key: 'ctc', label: 'Annual CTC', required: true },
    { key: 'employment_type', label: 'Employment Type', required: false, default: 'full-time' },
    { key: 'gender', label: 'Gender', required: false },
    { key: 'blood_group', label: 'Blood Group', required: false, hint: 'A+, A-, B+, B-, AB+, AB-, O+, O-' },
    { key: 'work_phone', label: 'Work Phone', required: true }
];

// Initialize on page load
document.addEventListener('DOMContentLoaded', async () => {
    console.log('[BulkImport] Initializing...');

    // Check authentication
    if (!api.isAuthenticated()) {
        window.location.href = '../login.html';
        return;
    }

    // Initialize navigation
    if (typeof Navigation !== 'undefined') {
        Navigation.init();
    }

    // Setup drag and drop
    setupDragAndDrop();

    // Load lookup data
    await loadLookupData();

    console.log('[BulkImport] Initialized');
});

/**
 * Setup drag and drop handlers
 */
function setupDragAndDrop() {
    const dropZone = document.getElementById('dropZone');

    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        dropZone.addEventListener(eventName, preventDefaults, false);
    });

    ['dragenter', 'dragover'].forEach(eventName => {
        dropZone.addEventListener(eventName, () => dropZone.classList.add('drag-over'), false);
    });

    ['dragleave', 'drop'].forEach(eventName => {
        dropZone.addEventListener(eventName, () => dropZone.classList.remove('drag-over'), false);
    });

    dropZone.addEventListener('drop', handleDrop, false);
}

function preventDefaults(e) {
    e.preventDefault();
    e.stopPropagation();
}

function handleDrop(e) {
    const files = e.dataTransfer.files;
    if (files.length > 0) {
        handleFile(files[0]);
    }
}

/**
 * Load lookup data for validation
 */
async function loadLookupData() {
    try {
        const [offices, departments, designations, shifts, salaryStructures] = await Promise.all([
            api.request('/hrms/offices'),
            api.request('/hrms/departments'),
            api.request('/hrms/designations'),
            api.request('/hrms/shifts'),
            api.request('/hrms/payroll/structures')
        ]);

        lookupData.offices = offices || [];
        lookupData.departments = departments || [];
        lookupData.designations = designations || [];
        lookupData.shifts = shifts || [];
        lookupData.salaryStructures = salaryStructures || [];

        console.log('[BulkImport] Lookup data loaded:', {
            offices: lookupData.offices.length,
            departments: lookupData.departments.length,
            designations: lookupData.designations.length,
            shifts: lookupData.shifts.length,
            salaryStructures: lookupData.salaryStructures.length
        });
    } catch (error) {
        console.error('[BulkImport] Failed to load lookup data:', error);
        showToast('Failed to load lookup data. Please refresh the page.', 'error');
    }
}

/**
 * Download Excel template
 */
function downloadTemplate() {
    // Create workbook with headers
    const wb = XLSX.utils.book_new();

    // Create header row
    const headers = TEMPLATE_COLUMNS.map(col => col.label);
    const hints = TEMPLATE_COLUMNS.map(col => col.hint || (col.required ? 'Required' : 'Optional'));

    // Sample data row - uses codes for department, designation, shift, salary structure
    const sampleData = [
        'john.doe@company.com',
        '', // Password - leave empty
        'John',
        'Doe',
        '', // Employee code - auto-generate
        'MUM-HQ',
        'ENG',        // Department code
        'SE',         // Designation code
        'GEN-DAY',    // Shift code
        'MUM-STD',    // Salary structure code
        '2026-01-15',
        '1990-05-20',
        '1200000',
        'full-time',
        'Male',
        '+91-9876543210'
    ];

    const wsData = [headers, hints, sampleData];
    const ws = XLSX.utils.aoa_to_sheet(wsData);

    // Set column widths
    ws['!cols'] = TEMPLATE_COLUMNS.map(() => ({ wch: 20 }));

    XLSX.utils.book_append_sheet(wb, ws, 'Employees');

    // Download
    XLSX.writeFile(wb, 'bulk-import-template.xlsx');
    showToast('Template downloaded successfully', 'success');
}

/**
 * Handle file selection
 */
function handleFileSelect(event) {
    const file = event.target.files[0];
    if (file) {
        handleFile(file);
    }
}

/**
 * Process uploaded file
 */
async function handleFile(file) {
    // Validate file type
    const validTypes = ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                        'application/vnd.ms-excel',
                        'text/csv'];

    if (!validTypes.includes(file.type) && !file.name.match(/\.(xlsx|xls|csv)$/i)) {
        showToast('Please upload an Excel or CSV file', 'error');
        return;
    }

    // Show selected file
    document.getElementById('selectedFile').style.display = 'flex';
    document.getElementById('fileName').textContent = file.name;
    document.getElementById('dropZone').style.display = 'none';

    try {
        // Read file
        const data = await readExcelFile(file);
        parsedData = parseExcelData(data);

        console.log('[BulkImport] Parsed data:', parsedData.length, 'rows');

        if (parsedData.length === 0) {
            showToast('No data found in the file', 'error');
            clearFile();
            return;
        }

        if (parsedData.length > 100) {
            showToast('Maximum 100 employees per file. Please split the file.', 'error');
            clearFile();
            return;
        }

        // Validate data locally first
        validateDataLocally();

        // Validate against backend (checks existing emails and employee codes in DB)
        showToast('Validating data...', 'info');
        await validateDataWithBackend();

        // Go to preview step
        goToStep(2);

    } catch (error) {
        console.error('[BulkImport] Error reading file:', error);
        showToast('Error reading file: ' + error.message, 'error');
        clearFile();
    }
}

/**
 * Read Excel file using SheetJS
 */
function readExcelFile(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();

        reader.onload = (e) => {
            try {
                const data = new Uint8Array(e.target.result);
                const workbook = XLSX.read(data, { type: 'array' });
                const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
                const jsonData = XLSX.utils.sheet_to_json(firstSheet, { header: 1 });
                resolve(jsonData);
            } catch (error) {
                reject(error);
            }
        };

        reader.onerror = () => reject(new Error('Failed to read file'));
        reader.readAsArrayBuffer(file);
    });
}

/**
 * Parse Excel data to structured format
 */
function parseExcelData(data) {
    if (data.length < 2) return []; // Need at least header + 1 data row

    const headers = data[0].map(h => String(h || '').trim().toLowerCase());
    const results = [];

    // Map headers to our expected columns
    const columnMap = {};
    TEMPLATE_COLUMNS.forEach(col => {
        const idx = headers.findIndex(h =>
            h === col.label.toLowerCase() ||
            h === col.key.toLowerCase() ||
            h.replace(/[_\s]/g, '') === col.key.replace(/[_\s]/g, '')
        );
        if (idx !== -1) {
            columnMap[col.key] = idx;
        }
    });

    // Skip header row (and optional hints row)
    const startRow = data[1] && data[1].every(cell =>
        String(cell || '').toLowerCase().includes('required') ||
        String(cell || '').toLowerCase().includes('optional')
    ) ? 2 : 1;

    for (let i = startRow; i < data.length; i++) {
        const row = data[i];
        if (!row || row.every(cell => !cell)) continue; // Skip empty rows

        const item = {
            RowNumber: i + 1, // 1-based for Excel reference
            errors: [],
            warnings: []
        };

        TEMPLATE_COLUMNS.forEach(col => {
            const idx = columnMap[col.key];
            let value = idx !== undefined ? row[idx] : undefined;

            // Convert dates if needed
            if (col.format === 'YYYY-MM-DD' && value) {
                if (typeof value === 'number') {
                    // Excel date serial number
                    const date = XLSX.SSF.parse_date_code(value);
                    value = `${date.y}-${String(date.m).padStart(2, '0')}-${String(date.d).padStart(2, '0')}`;
                } else if (typeof value === 'string') {
                    // Try to parse various date formats
                    const parsed = new Date(value);
                    if (!isNaN(parsed)) {
                        value = parsed.toISOString().split('T')[0];
                    }
                }
            }

            item[col.key] = value !== undefined ? String(value || '').trim() : '';
        });

        results.push(item);
    }

    return results;
}

/**
 * Find unique match - returns null if no match, the item if exactly one match, or throws error if multiple matches
 */
function findUniqueMatch(array, predicate, fieldName, searchValue) {
    const matches = array.filter(predicate);
    if (matches.length === 0) {
        return { match: null, error: `${fieldName} not found: ${searchValue}` };
    }
    if (matches.length > 1) {
        return { match: null, error: `Multiple ${fieldName.toLowerCase()}s found matching '${searchValue}'. Please be more specific.` };
    }
    return { match: matches[0], error: null };
}

/**
 * Validate data locally before sending to server
 */
function validateDataLocally() {
    const seenEmails = new Set();
    const seenCodes = new Set();

    parsedData.forEach(item => {
        item.errors = [];
        item.warnings = [];

        // Required field validation
        if (!item.email) item.errors.push('Email is required');
        else if (!item.email.includes('@')) item.errors.push('Invalid email format');
        else if (seenEmails.has(item.email.toLowerCase())) item.errors.push('Duplicate email in file');
        else seenEmails.add(item.email.toLowerCase());

        if (!item.first_name) item.errors.push('First name is required');
        if (!item.last_name) item.errors.push('Last name is required');
        if (!item.date_of_joining) item.errors.push('Date of joining is required');
        if (!item.date_of_birth) item.errors.push('Date of birth is required');
        if (!item.work_phone) item.errors.push('Work phone is required');

        if (!item.ctc) item.errors.push('CTC is required');
        else if (isNaN(parseFloat(item.ctc)) || parseFloat(item.ctc) <= 0) {
            item.errors.push('CTC must be a positive number');
        }

        // Lookup validation with multiple match detection
        if (!item.office_code) {
            item.errors.push('Office code is required');
        } else {
            const result = findUniqueMatch(
                lookupData.offices,
                o => o.office_code?.toLowerCase() === item.office_code.toLowerCase(),
                'Office',
                item.office_code
            );
            if (result.error) {
                item.errors.push(result.error);
            } else {
                item.office_id = result.match.id;
            }
        }

        if (!item.department_code) {
            item.errors.push('Department code is required');
        } else {
            // Case-insensitive match by code
            const result = findUniqueMatch(
                lookupData.departments,
                d => d.department_code?.toLowerCase() === item.department_code.toLowerCase(),
                'Department',
                item.department_code
            );
            if (result.error) {
                item.errors.push(result.error);
            } else {
                item.department_id = result.match.id;
                item.department_name = result.match.department_name; // Store for display
            }
        }

        if (!item.designation_code) {
            item.errors.push('Designation code is required');
        } else {
            // Case-insensitive match by code
            const result = findUniqueMatch(
                lookupData.designations,
                d => d.designation_code?.toLowerCase() === item.designation_code.toLowerCase(),
                'Designation',
                item.designation_code
            );
            if (result.error) {
                item.errors.push(result.error);
            } else {
                item.designation_id = result.match.id;
                item.designation_name = result.match.designation_name; // Store for display
            }
        }

        if (!item.shift_code) {
            item.errors.push('Shift code is required');
        } else {
            // Find shift by code that belongs to the selected office (office_id must be resolved first)
            // Case-insensitive match by code
            const result = findUniqueMatch(
                lookupData.shifts,
                s => s.shift_code?.toLowerCase() === item.shift_code.toLowerCase() &&
                     s.office_id === item.office_id,
                'Shift',
                item.shift_code
            );
            if (result.error) {
                // Try finding any shift with that code for a better error message
                const anyShift = lookupData.shifts.find(s =>
                    s.shift_code?.toLowerCase() === item.shift_code.toLowerCase()
                );
                if (anyShift && item.office_id) {
                    item.errors.push(`Shift '${item.shift_code}' not found in office ${item.office_code}`);
                } else if (!item.office_id) {
                    item.errors.push(`Cannot validate shift - office must be valid first`);
                } else {
                    item.errors.push(`Shift not found: ${item.shift_code}`);
                }
            } else {
                item.shift_id = result.match.id;
                item.shift_name = result.match.shift_name; // Store for display
            }
        }

        // Salary structure validation - must belong to selected office
        if (!item.salary_structure_code) {
            item.errors.push('Salary structure code is required');
        } else {
            // Find salary structure by code that belongs to the selected office
            const result = findUniqueMatch(
                lookupData.salaryStructures,
                s => s.structure_code?.toLowerCase() === item.salary_structure_code.toLowerCase() &&
                     s.office_id === item.office_id,
                'Salary Structure',
                item.salary_structure_code
            );
            if (result.error) {
                // Try finding any structure with that code for a better error message
                const anyStructure = lookupData.salaryStructures.find(s =>
                    s.structure_code?.toLowerCase() === item.salary_structure_code.toLowerCase()
                );
                if (anyStructure && item.office_id) {
                    item.errors.push(`Salary structure '${item.salary_structure_code}' not found in office ${item.office_code}`);
                } else if (!item.office_id) {
                    item.errors.push(`Cannot validate salary structure - office must be valid first`);
                } else {
                    item.errors.push(`Salary structure not found: ${item.salary_structure_code}`);
                }
            } else {
                item.salary_structure_id = result.match.id;
                item.salary_structure_name = result.match.structure_name; // Store for display
            }
        }

        // Employee code duplicate check within file
        if (item.employee_code) {
            if (seenCodes.has(item.employee_code.toLowerCase())) {
                item.errors.push('Duplicate employee code in file');
            } else {
                seenCodes.add(item.employee_code.toLowerCase());
            }
        } else {
            item.warnings.push('Employee code will be auto-generated');
        }

        // Password warning
        if (!item.password) {
            item.warnings.push('Password will be auto-generated');
        }
    });

    updatePreviewTable();
}

/**
 * Validate data against backend (checks existing users and employee codes)
 */
async function validateDataWithBackend() {
    // Only validate rows that passed local validation
    const rowsToValidate = parsedData.filter(r => r.errors.length === 0);

    if (rowsToValidate.length === 0) {
        console.log('[BulkImport] No valid rows to validate with backend');
        return;
    }

    try {
        const validateRequest = {
            Employees: rowsToValidate.map(item => ({
                RowNumber: item.RowNumber,
                email: item.email,
                first_name: item.first_name,
                last_name: item.last_name,
                employee_code: item.employee_code || null,
                office_id: item.office_id,
                department_id: item.department_id,
                designation_id: item.designation_id,
                shift_id: item.shift_id,
                salary_structure_id: item.salary_structure_id,
                salary_structure_code: item.salary_structure_code,
                date_of_joining: item.date_of_joining || null,
                date_of_birth: item.date_of_birth || null,
                ctc: parseFloat(item.ctc),
                employment_type: item.employment_type || 'full-time',
                gender: item.gender || null,
                blood_group: item.blood_group || null,
                work_phone: item.work_phone
            }))
        };

        console.log('[BulkImport] Validating with backend...', validateRequest);
        const response = await api.request('/hrms/employees/bulk/validate', {
            method: 'POST',
            body: JSON.stringify(validateRequest)
        });

        console.log('[BulkImport] Backend validation response:', response);

        // Merge backend validation results into our data
        if (response.results) {
            response.results.forEach(result => {
                const row = parsedData.find(r => r.RowNumber === result.rowNumber);
                if (row) {
                    // Add backend errors
                    if (result.errors && result.errors.length > 0) {
                        result.errors.forEach(err => {
                            if (!row.errors.includes(err)) {
                                row.errors.push(err);
                            }
                        });
                    }
                    // Add backend warnings
                    if (result.warnings && result.warnings.length > 0) {
                        result.warnings.forEach(warn => {
                            if (!row.warnings.includes(warn)) {
                                row.warnings.push(warn);
                            }
                        });
                    }
                }
            });
        }

        // Handle global errors
        if (response.globalErrors && response.globalErrors.length > 0) {
            showToast(response.globalErrors.join('. '), 'error');
        }

        // Update preview with merged results
        updatePreviewTable();

    } catch (error) {
        console.error('[BulkImport] Backend validation failed:', error);
        showToast('Backend validation failed: ' + error.message, 'warning');
        // Continue with local validation only - backend validation is optional enhancement
    }
}

/**
 * Update preview table with parsed data
 */
function updatePreviewTable() {
    const tbody = document.getElementById('previewTableBody');
    const validCount = parsedData.filter(r => r.errors.length === 0).length;
    const invalidCount = parsedData.filter(r => r.errors.length > 0).length;

    // Update stats (new structure)
    document.getElementById('totalRows').textContent = parsedData.length;
    document.getElementById('validRows').textContent = validCount;
    document.getElementById('invalidRows').textContent = invalidCount;

    // Enable/disable import button
    document.getElementById('startImportBtn').disabled = validCount === 0;

    // Build table rows with new structure
    tbody.innerHTML = parsedData.map(item => {
        const hasErrors = item.errors.length > 0;
        const hasWarnings = item.warnings.length > 0;

        let statusBadge = '';
        if (hasErrors) {
            statusBadge = '<span class="status-badge status-error">Error</span>';
        } else if (hasWarnings) {
            statusBadge = '<span class="status-badge status-warning">Warning</span>';
        } else {
            statusBadge = '<span class="status-badge status-valid">Valid</span>';
        }

        // Build messages HTML with icons
        let messagesHtml = '';
        if (item.errors.length > 0 || item.warnings.length > 0) {
            messagesHtml = '<div class="cell-errors">';
            item.errors.forEach(e => {
                messagesHtml += `<div class="cell-error">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
                        <circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>
                    </svg>
                    ${escapeHtml(e)}
                </div>`;
            });
            item.warnings.forEach(w => {
                messagesHtml += `<div class="cell-warning">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
                        <path d="M12 9v4"/><circle cx="12" cy="17" r="1"/>
                    </svg>
                    ${escapeHtml(w)}
                </div>`;
            });
            messagesHtml += '</div>';
        } else {
            messagesHtml = '<span style="color: var(--color-success);">Ready to import</span>';
        }

        const rowClass = hasErrors ? 'row-error' : (hasWarnings ? 'row-warning' : 'row-valid');

        return `
            <tr class="${rowClass}">
                <td>${item.RowNumber}</td>
                <td>${statusBadge}</td>
                <td>${escapeHtml(item.email || '-')}</td>
                <td>${escapeHtml(item.first_name || '-')}</td>
                <td>${escapeHtml(item.last_name || '-')}</td>
                <td>${escapeHtml(item.employee_code || '(auto)')}</td>
                <td>${escapeHtml(item.office_code || '-')}</td>
                <td>${escapeHtml(item.department_code || '-')}</td>
                <td>${escapeHtml(item.designation_code || '-')}</td>
                <td>${escapeHtml(item.shift_code || '-')}</td>
                <td style="text-align: right; font-family: var(--font-family-mono);">${item.ctc ? formatCurrency(parseFloat(item.ctc)) : '-'}</td>
                <td>${formatDate(item.date_of_joining) || '-'}</td>
                <td>${formatDate(item.date_of_birth) || '-'}</td>
                <td>${escapeHtml(item.work_phone || '-')}</td>
                <td>${messagesHtml}</td>
            </tr>
        `;
    }).join('');
}

/**
 * Clear selected file
 */
function clearFile() {
    document.getElementById('fileInput').value = '';
    document.getElementById('selectedFile').style.display = 'none';
    document.getElementById('dropZone').style.display = 'block';
    parsedData = [];
}

/**
 * Navigate to a specific step
 */
function goToStep(step) {
    // Update step indicators (new stepper structure)
    document.querySelectorAll('.stepper-step').forEach(el => {
        const stepNum = parseInt(el.dataset.step);
        el.classList.remove('active', 'completed');
        if (stepNum < step) {
            el.classList.add('completed');
        } else if (stepNum === step) {
            el.classList.add('active');
        }
    });

    // Show/hide sections
    document.getElementById('uploadSection').style.display = step === 1 ? 'block' : 'none';
    document.getElementById('previewSection').style.display = step === 2 ? 'block' : 'none';
    document.getElementById('progressSection').style.display = step === 3 ? 'block' : 'none';
    document.getElementById('resultsSection').style.display = step === 4 ? 'block' : 'none';
}

/**
 * Start the import process - v3.3.5: Uses unified atomic import endpoint
 * This endpoint validates ALL data (Auth + HRMS) before creating anything,
 * and rolls back all created users if any employee creation fails.
 */
async function startImport() {
    // Filter valid rows only
    const validRows = parsedData.filter(r => r.errors.length === 0);

    if (validRows.length === 0) {
        showToast('No valid rows to import', 'error');
        return;
    }

    goToStep(3);

    // Reset progress - show unified import progress
    updatePhase1Progress(0, 0, 0, 'processing');
    document.getElementById('phase1Title').textContent = 'Unified Import';
    document.getElementById('phase1Desc').textContent = 'Creating users and employees atomically...';
    updatePhase2Progress(0, 0, 0, 'waiting');
    document.getElementById('phase2').style.opacity = '0.5';
    document.getElementById('phase2Title').textContent = 'Validation';
    document.getElementById('phase2Desc').textContent = 'Pre-import validation completed';

    try {
        // Use unified atomic import endpoint
        await executeUnifiedImport(validRows);

        // Show results
        goToStep(4);
        displayResults();

    } catch (error) {
        console.error('[BulkImport] Import failed:', error);
        showToast('Import failed: ' + error.message, 'error');
    }
}

/**
 * Execute unified atomic import - v3.3.5
 * Creates users in Auth AND employees in HRMS in a single atomic operation.
 * If any employee creation fails after users are created, all users are rolled back.
 */
async function executeUnifiedImport(validRows) {
    console.log('[BulkImport] Starting unified atomic import...');
    updatePhase1Progress(10, 0, 0, 'processing');

    // Prepare unified import request
    const employeesToImport = validRows.map(row => ({
        RowNumber: row.RowNumber,
        email: row.email,
        password: row.password || null, // null triggers auto-generation
        first_name: row.first_name,
        last_name: row.last_name,
        employee_code: row.employee_code || null,
        office_id: row.office_id,
        department_id: row.department_id,
        designation_id: row.designation_id,
        shift_id: row.shift_id,
        salary_structure_id: row.salary_structure_id,
        salary_structure_code: row.salary_structure_code,
        date_of_joining: row.date_of_joining || null,
        date_of_birth: row.date_of_birth || null,
        ctc: parseFloat(row.ctc),
        employment_type: row.employment_type || 'full-time',
        gender: row.gender || null,
        blood_group: row.blood_group || null,
        work_phone: row.work_phone
    }));

    try {
        updatePhase1Progress(30, 0, 0, 'processing');

        const response = await api.request('/hrms/employees/bulk-unified', {
            method: 'POST',
            body: JSON.stringify({
                Employees: employeesToImport,
                GeneratePasswords: true,
                DefaultRoles: ['HRMS_USER']
            })
        });

        console.log('[BulkImport] Unified import response:', response);

        importResults.unified = response;
        importResults.phase1 = response; // For backward compatibility with results display

        // Check if validation failed (no changes made)
        if (!response.validationSummary?.allPhasesValid) {
            const phase1Errors = response.validationSummary?.phase1ErrorCount || 0;
            const phase2Errors = response.validationSummary?.phase2ErrorCount || 0;
            updatePhase1Progress(100, 0, validRows.length, 'failed');
            updatePhase2Progress(100, 0, 0, 'completed');
            document.getElementById('phase2').style.opacity = '1';
            document.getElementById('phase2Status').textContent = `${phase1Errors + phase2Errors} validation errors`;

            // Mark all rows as failed
            validRows.forEach(row => {
                row.user_created = false;
                row.employee_created = false;
                row.user_error = 'Validation failed - entire import rejected';
            });

            // Map specific errors to rows
            if (response.validationErrors) {
                response.validationErrors.forEach(err => {
                    const match = err.match(/Row (\d+):/);
                    if (match) {
                        const rowNum = parseInt(match[1]);
                        const row = validRows.find(r => r.RowNumber === rowNum);
                        if (row) {
                            row.user_error = err;
                        }
                    }
                });
            }

            showToast('Validation failed. No changes made. Fix errors and retry.', 'error');
            return;
        }

        // Check if rollback occurred (server error during employee creation)
        if (response.rolledBackUsers > 0) {
            updatePhase1Progress(100, 0, validRows.length, 'failed');
            updatePhase2Progress(100, 0, 0, 'failed');
            document.getElementById('phase2').style.opacity = '1';
            document.getElementById('phase2Status').textContent = `${response.rolledBackUsers} users rolled back`;

            // Mark all rows as failed/rolled back
            validRows.forEach(row => {
                row.user_created = false;
                row.employee_created = false;
                row.user_error = 'Rolled back due to employee creation failures';
            });

            showToast(`Import failed. ${response.rolledBackUsers} users were rolled back. No partial state.`, 'error');
            return;
        }

        // Success!
        const created = response.totalCreated || 0;
        const failed = response.totalFailed || 0;

        updatePhase1Progress(100, created, failed, created > 0 ? 'completed' : 'failed');
        updatePhase2Progress(100, created, 0, 'completed');
        document.getElementById('phase2').style.opacity = '1';
        document.getElementById('phase2Status').textContent = 'All employees created';

        // Map results back to our data
        if (response.results) {
            response.results.forEach(result => {
                const row = validRows.find(r =>
                    r.email?.toLowerCase() === result.email?.toLowerCase() ||
                    r.RowNumber === result.rowNumber
                );
                if (row) {
                    row.user_created = result.success;
                    row.user_id = result.userId;
                    row.generated_password = result.generatedPassword;
                    row.employee_created = result.success;
                    row.employee_id = result.employeeId;
                    row.employee_code_result = result.employeeCode;
                    row.user_error = result.errorMessage;
                    row.employee_error = result.errorMessage;
                    row.was_rolled_back = result.wasRolledBack;
                }
            });
        }

        console.log('[BulkImport] Unified import complete:', { created, failed });

        if (created > 0) {
            showToast(`Successfully imported ${created} employees`, 'success');
        }

    } catch (error) {
        console.error('[BulkImport] Unified import error:', error);
        updatePhase1Progress(100, 0, validRows.length, 'failed');
        updatePhase2Progress(100, 0, 0, 'failed');
        document.getElementById('phase2').style.opacity = '1';

        validRows.forEach(row => {
            row.user_created = false;
            row.employee_created = false;
            row.user_error = error.message;
        });

        throw error;
    }
}

/**
 * Execute Phase 1: Create users in Auth service
 */
async function executePhase1(validRows) {
    console.log('[BulkImport] Phase 1: Creating users...');
    updatePhase1Progress(0, 0, 0, 'processing');

    // Prepare user creation request
    const usersToCreate = validRows.map(row => ({
        RowNumber: row.RowNumber,
        Email: row.email,
        Password: row.password || null, // null triggers auto-generation
        FirstName: row.first_name,
        LastName: row.last_name,
        Roles: ['HRMS_USER']
    }));

    try {
        const response = await api.request('/users/bulk', {
            method: 'POST',
            body: JSON.stringify({
                Users: usersToCreate,
                DefaultRoles: ['HRMS_USER'],
                GeneratePasswords: true
            })
        });

        importResults.phase1 = response;

        // ASP.NET Core returns camelCase JSON by default
        const created = response.totalCreated || 0;
        const failed = response.totalFailed || 0;

        updatePhase1Progress(100, created, failed,
            failed === 0 ? 'completed' : 'completed');

        // Map user IDs back to our data
        if (response.results) {
            response.results.forEach(result => {
                const row = validRows.find(r =>
                    r.email.toLowerCase() === result.email?.toLowerCase() ||
                    r.RowNumber === result.rowNumber
                );
                if (row) {
                    row.user_created = result.success;
                    row.user_id = result.userId;
                    row.generated_password = result.generatedPassword;
                    row.user_error = result.errorMessage;
                }
            });
        }

        console.log('[BulkImport] Phase 1 complete:', { created, failed });

    } catch (error) {
        console.error('[BulkImport] Phase 1 error:', error);
        updatePhase1Progress(100, 0, validRows.length, 'failed');
        validRows.forEach(row => {
            row.user_created = false;
            row.user_error = error.message;
        });
        throw error;
    }
}

/**
 * Execute Phase 2: Create employees in HRMS service
 */
async function executePhase2(validRows) {
    console.log('[BulkImport] Phase 2: Creating employees...');
    document.getElementById('phase2').style.opacity = '1';
    updatePhase2Progress(0, 0, 0, 'processing');

    // Filter rows where user was created successfully
    const rowsWithUsers = validRows.filter(r => r.user_created);

    if (rowsWithUsers.length === 0) {
        updatePhase2Progress(100, 0, 0, 'completed');
        console.log('[BulkImport] Phase 2: No users to create employees for');
        return;
    }

    // Prepare employee creation request
    const employeesToCreate = rowsWithUsers.map(row => ({
        RowNumber: row.RowNumber,
        email: row.email,
        employee_code: row.employee_code || null,
        office_id: row.office_id,
        department_id: row.department_id,
        designation_id: row.designation_id,
        shift_id: row.shift_id,
        salary_structure_id: row.salary_structure_id,
        salary_structure_code: row.salary_structure_code,
        date_of_joining: row.date_of_joining || null,
        date_of_birth: row.date_of_birth || null,
        ctc: parseFloat(row.ctc),
        employment_type: row.employment_type || 'full-time',
        gender: row.gender || null,
        blood_group: row.blood_group || null,
        work_phone: row.work_phone
    }));

    try {
        const response = await api.request('/hrms/employees/bulk', {
            method: 'POST',
            body: JSON.stringify({
                Employees: employeesToCreate
            })
        });

        importResults.phase2 = response;

        // ASP.NET Core returns camelCase JSON by default
        const created = response.totalCreated || 0;
        const failed = response.totalFailed || 0;

        updatePhase2Progress(100, created, failed,
            failed === 0 ? 'completed' : 'completed');

        // Map results back to our data
        if (response.results) {
            response.results.forEach(result => {
                const row = validRows.find(r =>
                    r.email.toLowerCase() === result.email?.toLowerCase() ||
                    r.RowNumber === result.rowNumber
                );
                if (row) {
                    row.employee_created = result.success;
                    row.employee_id = result.employeeId;
                    row.employee_code_result = result.employeeCode;
                    row.employee_error = result.errorMessage;
                }
            });
        }

        console.log('[BulkImport] Phase 2 complete:', { created, failed });

    } catch (error) {
        console.error('[BulkImport] Phase 2 error:', error);
        updatePhase2Progress(100, 0, rowsWithUsers.length, 'failed');
        rowsWithUsers.forEach(row => {
            row.employee_created = false;
            row.employee_error = error.message;
        });
    }
}

/**
 * Update Phase 1 progress UI
 */
function updatePhase1Progress(percent, created, failed, status) {
    const phase1 = document.getElementById('phase1');
    document.getElementById('phase1Progress').style.width = percent + '%';
    document.getElementById('phase1Status').textContent =
        status === 'processing' ? 'Processing...' :
        status === 'completed' ? 'Completed' :
        status === 'failed' ? 'Failed' : 'Waiting...';

    // Update phase class for styling
    phase1.classList.remove('phase-pending', 'phase-active', 'phase-complete', 'phase-error');
    if (status === 'processing') phase1.classList.add('phase-active');
    else if (status === 'completed') phase1.classList.add('phase-complete');
    else if (status === 'failed') phase1.classList.add('phase-error');

    document.getElementById('phase1Details').innerHTML = `
        <span class="detail-success">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>
            ${created} created
        </span>
        <span class="detail-failed">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            ${failed} failed
        </span>
    `;
}

/**
 * Update Phase 2 progress UI
 */
function updatePhase2Progress(percent, created, failed, status) {
    const phase2 = document.getElementById('phase2');
    document.getElementById('phase2Progress').style.width = percent + '%';
    document.getElementById('phase2Status').textContent =
        status === 'processing' ? 'Processing...' :
        status === 'completed' ? 'Completed' :
        status === 'failed' ? 'Failed' : 'Waiting...';

    // Update phase class for styling
    phase2.classList.remove('phase-pending', 'phase-active', 'phase-complete', 'phase-error');
    if (status === 'processing') phase2.classList.add('phase-active');
    else if (status === 'completed') phase2.classList.add('phase-complete');
    else if (status === 'failed') phase2.classList.add('phase-error');
    else phase2.classList.add('phase-pending');

    document.getElementById('phase2Details').innerHTML = `
        <span class="detail-success">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>
            ${created} created
        </span>
        <span class="detail-failed">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            ${failed} failed
        </span>
    `;
}

/**
 * Display final results
 */
function displayResults() {
    const successCount = parsedData.filter(r => r.employee_created).length;
    const failedCount = parsedData.filter(r => !r.employee_created && r.errors.length === 0).length;
    const skippedCount = parsedData.filter(r => r.errors.length > 0).length;

    // Update summary with new structure
    document.getElementById('resultSummary').innerHTML = `
        <div class="result-stat success">
            <span class="result-value">${successCount}</span>
            <span class="result-label">Imported</span>
        </div>
        ${failedCount > 0 ? `
        <div class="result-stat failed">
            <span class="result-value">${failedCount}</span>
            <span class="result-label">Failed</span>
        </div>` : ''}
    `;

    // Build results table with new structure
    const tbody = document.getElementById('resultsTableBody');
    tbody.innerHTML = parsedData.map(item => {
        const isSuccess = item.employee_created;
        const isSkipped = item.errors.length > 0;

        let statusBadge = '';
        if (isSuccess) {
            statusBadge = '<span class="status-badge status-valid">Success</span>';
        } else if (isSkipped) {
            statusBadge = '<span class="status-badge status-warning">Skipped</span>';
        } else {
            statusBadge = '<span class="status-badge status-error">Failed</span>';
        }

        const errors = [
            ...(item.errors || []),
            item.user_error ? `User: ${item.user_error}` : null,
            item.employee_error ? `Employee: ${item.employee_error}` : null
        ].filter(Boolean);

        // Build errors HTML
        let errorsHtml = '-';
        if (errors.length > 0) {
            errorsHtml = '<div class="cell-errors">' + errors.map(e =>
                `<div class="cell-error">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
                        <circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>
                    </svg>
                    ${escapeHtml(e)}
                </div>`
            ).join('') + '</div>';
        }

        const rowClass = isSuccess ? 'row-valid' : (isSkipped ? 'row-warning' : 'row-error');

        return `
            <tr class="${rowClass}">
                <td>${item.RowNumber}</td>
                <td>${statusBadge}</td>
                <td>${escapeHtml(item.email)}</td>
                <td>${escapeHtml((item.first_name || '') + ' ' + (item.last_name || ''))}</td>
                <td>${escapeHtml(item.employee_code_result || item.employee_code || '(auto)')}</td>
                <td style="text-align: center;">
                    ${item.user_created ?
                        '<span style="color: var(--color-success);">✓</span>' :
                        '<span style="color: var(--color-danger);">✗</span>'}
                </td>
                <td style="text-align: center;">
                    ${item.employee_created ?
                        '<span style="color: var(--color-success);">✓</span>' :
                        '<span style="color: var(--color-danger);">✗</span>'}
                </td>
                <td style="font-family: var(--font-family-mono); font-size: 11px;">
                    ${item.generated_password ? escapeHtml(item.generated_password) : '-'}
                </td>
                <td>${errorsHtml}</td>
            </tr>
        `;
    }).join('');

    // Show success message
    if (successCount > 0) {
        showToast(`Successfully imported ${successCount} employees!`, 'success');
    }
}

/**
 * Export results to Excel
 */
function exportResults() {
    const data = parsedData.map(item => ({
        'Row': item.RowNumber,
        'Email': item.email,
        'First Name': item.first_name,
        'Last Name': item.last_name,
        'Employee Code': item.employee_code_result || item.employee_code || '',
        'User Created': item.user_created ? 'Yes' : 'No',
        'Employee Created': item.employee_created ? 'Yes' : 'No',
        'Generated Password': item.generated_password || '',
        'Errors': [
            ...(item.errors || []),
            item.user_error || '',
            item.employee_error || ''
        ].filter(Boolean).join('; ')
    }));

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(data);
    XLSX.utils.book_append_sheet(wb, ws, 'Import Results');

    const timestamp = new Date().toISOString().split('T')[0];
    XLSX.writeFile(wb, `bulk-import-results-${timestamp}.xlsx`);
    showToast('Results exported successfully', 'success');
}

/**
 * Start over with a new import
 */
function startOver() {
    parsedData = [];
    importResults = { phase1: null, phase2: null };
    clearFile();
    goToStep(1);
}

// Utility functions
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function formatCurrency(amount) {
    return new Intl.NumberFormat('en-IN', {
        style: 'currency',
        currency: 'INR',
        maximumFractionDigits: 0
    }).format(amount);
}

function formatDate(dateString) {
    if (!dateString) return '';
    try {
        const date = new Date(dateString);
        if (isNaN(date.getTime())) return dateString;
        return date.toLocaleDateString('en-IN', {
            year: 'numeric',
            month: 'short',
            day: 'numeric'
        });
    } catch {
        return dateString;
    }
}

function showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;

    container.appendChild(toast);

    setTimeout(() => {
        toast.classList.add('toast-fade-out');
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}
