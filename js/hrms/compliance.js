/**
 * HRMS Statutory Compliance JavaScript
 * Simplified for Global Payroll - Country-agnostic compliance management
 */

let currentUser = null;
let companyInfo = null;
let countries = [];
let countryConfigs = [];
let selectedConfigFile = null;
let parsedConfigData = null;
let rawConfigJson = null;  // Store the raw JSON string for upload
let currentViewingConfig = null;

// ==================== Utility Functions ====================

function formatCurrency(amount, currencyCode = 'INR') {
    if (amount === null || amount === undefined) return '-';
    try {
        return new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: currencyCode,
            minimumFractionDigits: 0,
            maximumFractionDigits: 2
        }).format(amount);
    } catch {
        return `${currencyCode} ${amount.toLocaleString()}`;
    }
}

function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function showLoading() {
    const overlay = document.getElementById('loadingOverlay');
    if (overlay) overlay.style.display = 'flex';
}

function hideLoading() {
    const overlay = document.getElementById('loadingOverlay');
    if (overlay) overlay.style.display = 'none';
}

function formatDate(dateStr) {
    if (!dateStr) return '-';
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
    });
}

function formatDateTime(dateStr) {
    if (!dateStr) return '-';
    const date = new Date(dateStr);
    return date.toLocaleString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

// ==================== Page Initialization ====================

document.addEventListener('DOMContentLoaded', async function() {
    await loadNavigation();
    setupSidebar();
    setupTabs();
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

        // Load initial data
        await Promise.all([
            loadCompanyInfo(),
            loadCountryConfigs()
        ]);

        hideLoading();
    } catch (error) {
        console.error('Error initializing page:', error);
        showToast('Failed to load page data', 'error');
        hideLoading();
    }
}

// ==================== Sidebar & Tab Navigation ====================

function setupSidebar() {
    const toggle = document.getElementById('sidebarToggle');
    const sidebar = document.getElementById('organizationSidebar');
    const container = document.querySelector('.hrms-container');

    if (!toggle || !sidebar) return;

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

    // Close sidebar on Escape key
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && sidebar.classList.contains('open')) {
            toggle.classList.remove('active');
            sidebar.classList.remove('open');
            container?.classList.remove('sidebar-open');
        }
    });
}

function setupTabs() {
    const tabButtons = document.querySelectorAll('.sidebar-btn[data-tab]');
    const tabContents = document.querySelectorAll('.tab-content');
    const activeTabName = document.getElementById('activeTabName');

    tabButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            const tabId = btn.dataset.tab;

            // Update button states
            tabButtons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            // Update content visibility
            tabContents.forEach(content => {
                content.classList.toggle('active', content.id === tabId);
            });

            // Update active tab title
            if (activeTabName) {
                const label = btn.querySelector('.nav-label');
                activeTabName.textContent = label ? label.textContent : btn.textContent.trim();
            }

            // Close mobile sidebar
            const sidebar = document.getElementById('organizationSidebar');
            const overlay = document.getElementById('sidebarOverlay');
            if (window.innerWidth < 1024) {
                sidebar?.classList.remove('open');
                overlay?.classList.remove('active');
            }
        });
    });
}

// ==================== Company Info ====================

async function loadCompanyInfo() {
    try {
        const response = await api.request('/hrms/tenant-info');
        companyInfo = response;
        populateCompanyInfoForm(companyInfo);
    } catch (error) {
        console.error('Error loading company info:', error);
        // Not showing error toast - company info might not exist yet
    }
}

function populateCompanyInfoForm(info) {
    if (!info) return;

    // Basic Info
    const companyName = document.getElementById('companyName');
    const companyPan = document.getElementById('companyPan');
    const companyTan = document.getElementById('companyTan');
    const companyGstin = document.getElementById('companyGstin');

    if (companyName) companyName.value = info.company_name || '';
    if (companyPan) companyPan.value = info.pan || '';
    if (companyTan) companyTan.value = info.tan || '';
    if (companyGstin) companyGstin.value = info.gstin || '';

    // Statutory Registrations
    const pfEstablishmentId = document.getElementById('pfEstablishmentId');
    const esiEmployerCode = document.getElementById('esiEmployerCode');
    const ptRegistration = document.getElementById('ptRegistration');

    if (pfEstablishmentId) pfEstablishmentId.value = info.pf_establishment_id || '';
    if (esiEmployerCode) esiEmployerCode.value = info.esi_employer_code || '';
    if (ptRegistration) ptRegistration.value = info.pt_registration_number || '';

    // Bank Details
    const bankName = document.getElementById('bankName');
    const bankAccount = document.getElementById('bankAccount');
    const bankIfsc = document.getElementById('bankIfsc');

    if (bankName) bankName.value = info.bank_name || '';
    if (bankAccount) bankAccount.value = info.bank_account_number || '';
    if (bankIfsc) bankIfsc.value = info.bank_ifsc || '';

    // Authorized Signatory
    const signatoryName = document.getElementById('signatoryName');
    const signatoryDesignation = document.getElementById('signatoryDesignation');
    const signatoryPan = document.getElementById('signatoryPan');

    if (signatoryName) signatoryName.value = info.authorized_signatory_name || '';
    if (signatoryDesignation) signatoryDesignation.value = info.authorized_signatory_designation || '';
    if (signatoryPan) signatoryPan.value = info.authorized_signatory_pan || '';

    // Registered Address
    const registeredAddress = document.getElementById('registeredAddress');
    if (registeredAddress) registeredAddress.value = info.registered_address || '';

    // Update country info display if config exists
    updateCountryInfoDisplay();
}

function updateCountryInfoDisplay() {
    const countryInfoDisplay = document.getElementById('countryInfoDisplay');
    if (!countryInfoDisplay) return;

    if (countryConfigs && countryConfigs.length > 0) {
        const configList = countryConfigs.map(c => `
            <span class="country-badge">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
                    <polyline points="22 4 12 14.01 9 11.01"></polyline>
                </svg>
                ${escapeHtml(c.country_name)} (${escapeHtml(c.country_code)})
            </span>
        `).join('');

        countryInfoDisplay.innerHTML = `
            <p class="text-success">Country configurations loaded:</p>
            <div class="country-badges">${configList}</div>
        `;
    } else {
        countryInfoDisplay.innerHTML = `
            <p class="text-muted">No country configuration uploaded yet. Please go to "Country Configs" tab to upload one.</p>
        `;
    }
}

async function handleCompanyInfoSubmit(e) {
    e.preventDefault();

    const submitBtn = document.getElementById('saveCompanyInfoBtn');
    const btnText = submitBtn?.querySelector('.btn-text');
    const btnSpinner = submitBtn?.querySelector('.btn-spinner');

    try {
        if (submitBtn) submitBtn.disabled = true;
        if (btnText) btnText.style.display = 'none';
        if (btnSpinner) btnSpinner.style.display = 'inline-flex';

        const payload = {
            company_name: document.getElementById('companyName')?.value?.trim() || '',
            pan: document.getElementById('companyPan')?.value?.trim() || '',
            tan: document.getElementById('companyTan')?.value?.trim() || '',
            gstin: document.getElementById('companyGstin')?.value?.trim() || '',
            pf_establishment_id: document.getElementById('pfEstablishmentId')?.value?.trim() || '',
            esi_employer_code: document.getElementById('esiEmployerCode')?.value?.trim() || '',
            pt_registration_number: document.getElementById('ptRegistration')?.value?.trim() || '',
            bank_name: document.getElementById('bankName')?.value?.trim() || '',
            bank_account_number: document.getElementById('bankAccount')?.value?.trim() || '',
            bank_ifsc: document.getElementById('bankIfsc')?.value?.trim() || '',
            authorized_signatory_name: document.getElementById('signatoryName')?.value?.trim() || '',
            authorized_signatory_designation: document.getElementById('signatoryDesignation')?.value?.trim() || '',
            authorized_signatory_pan: document.getElementById('signatoryPan')?.value?.trim() || '',
            registered_address: document.getElementById('registeredAddress')?.value?.trim() || ''
        };

        if (!payload.company_name) {
            showToast('Company name is required', 'error');
            return;
        }

        await api.request('/hrms/tenant-info', {
            method: 'POST',
            body: JSON.stringify(payload)
        });

        showToast('Company information saved successfully', 'success');
        companyInfo = payload;

    } catch (error) {
        console.error('Error saving company info:', error);
        showToast(error.message || 'Failed to save company information', 'error');
    } finally {
        if (submitBtn) submitBtn.disabled = false;
        if (btnText) btnText.style.display = 'inline';
        if (btnSpinner) btnSpinner.style.display = 'none';
    }
}

// ==================== Country Configs ====================

async function loadCountryConfigs() {
    try {
        const response = await api.request('/hrms/statutory/configs');
        // Handle both array response and object with configs property
        if (Array.isArray(response)) {
            countryConfigs = response;
        } else if (response && Array.isArray(response.configs)) {
            countryConfigs = response.configs;
        } else if (response && typeof response === 'object') {
            // Single config object - wrap in array
            countryConfigs = [response];
        } else {
            countryConfigs = [];
        }
        renderCountryConfigs();
        updateCountryInfoDisplay();
    } catch (error) {
        console.error('Error loading country configs:', error);
        countryConfigs = [];
        renderCountryConfigs();
    }
}

function renderCountryConfigs() {
    const grid = document.getElementById('countryConfigsGrid');
    const emptyState = document.getElementById('configsEmptyState');

    if (!grid) return;

    if (!countryConfigs || countryConfigs.length === 0) {
        if (emptyState) emptyState.style.display = 'flex';
        // Clear any config cards but keep empty state
        const cards = grid.querySelectorAll('.country-config-card');
        cards.forEach(card => card.remove());
        return;
    }

    if (emptyState) emptyState.style.display = 'none';

    // Group configs by country
    // Note: API returns camelCase (countryCode) not snake_case (country_code)
    const configsByCountry = {};
    countryConfigs.forEach(config => {
        // Support both camelCase (from API) and snake_case (legacy)
        const countryCode = config.countryCode || config.country_code;
        const countryName = config.countryName || config.country_name;
        const key = countryCode || 'UNKNOWN';
        if (!configsByCountry[key]) {
            configsByCountry[key] = {
                country_code: countryCode,
                country_name: countryName,
                configs: []
            };
        }
        configsByCountry[key].configs.push(config);
    });

    // Clear existing cards
    const existingCards = grid.querySelectorAll('.country-config-card');
    existingCards.forEach(card => card.remove());

    // Render cards - matching CSS class names exactly
    Object.values(configsByCountry).forEach(country => {
        // Get the first config (summary data from API)
        const config = country.configs[0];

        // API returns camelCase: activeVersion, totalVersions, latestEffectiveFrom
        const version = config.activeVersion || config.version || '1.0';
        const totalVersions = config.totalVersions || country.configs.length;
        // For effective date, use latestEffectiveFrom (from summary) or effectiveFrom
        const effectiveDate = config.latestEffectiveFrom || config.effectiveFrom || config.effective_from;

        // Get country flag emoji from code
        const flagEmoji = getCountryFlag(country.country_code);

        const card = document.createElement('div');
        card.className = 'country-config-card';
        card.innerHTML = `
            <div class="config-card-header">
                <span class="config-country-flag">${flagEmoji}</span>
                <div class="config-country-info">
                    <h3>${escapeHtml(country.country_name || 'Unknown Country')}</h3>
                    <span class="config-country-code">${escapeHtml(country.country_code || 'N/A')}</span>
                </div>
                <span class="config-version-pill">v${escapeHtml(version)}</span>
            </div>
            <div class="config-card-stats">
                <div class="config-stat">
                    <span class="config-stat-value">${totalVersions}</span>
                    <span class="config-stat-label">Version${totalVersions !== 1 ? 's' : ''}</span>
                </div>
                <div class="config-stat">
                    <span class="config-stat-value">${config.hasActiveConfig ? '✓' : '–'}</span>
                    <span class="config-stat-label">Active</span>
                </div>
            </div>
            <div class="config-card-meta">
                <span class="config-effective-date">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                        <line x1="16" y1="2" x2="16" y2="6"></line>
                        <line x1="8" y1="2" x2="8" y2="6"></line>
                        <line x1="3" y1="10" x2="21" y2="10"></line>
                    </svg>
                    Effective: ${formatDate(effectiveDate)}
                </span>
                <div class="config-actions">
                    <button type="button" class="config-action-btn" onclick="viewConfig('${escapeHtml(country.country_code)}')" title="View configuration">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                            <circle cx="12" cy="12" r="3"></circle>
                        </svg>
                    </button>
                    <button type="button" class="config-action-btn" onclick="downloadConfigAsJson('${escapeHtml(country.country_code)}')" title="Download JSON">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                            <polyline points="7 10 12 15 17 10"></polyline>
                            <line x1="12" y1="15" x2="12" y2="3"></line>
                        </svg>
                    </button>
                </div>
            </div>
        `;
        grid.insertBefore(card, emptyState);
    });
}

// Get country flag emoji from ISO 3166-1 alpha-2 country code
function getCountryFlag(countryCode) {
    if (!countryCode || countryCode.length !== 2) return '🌍';
    const codePoints = countryCode
        .toUpperCase()
        .split('')
        .map(char => 127397 + char.charCodeAt(0));
    return String.fromCodePoint(...codePoints);
}

// Count states from config data
function countStates(config) {
    if (!config) return 0;
    // Check config_data first (from API response)
    const data = config.config_data || config;
    if (data.states && Array.isArray(data.states)) {
        return data.states.length;
    }
    return 0;
}

async function refreshCountryConfigs() {
    showLoading();
    await loadCountryConfigs();
    hideLoading();
    showToast('Configurations refreshed', 'success');
}

// ==================== Config Upload Modal ====================

function openConfigUploadModal() {
    const modal = document.getElementById('configUploadModal');
    if (modal) {
        modal.classList.add('active');
        clearSelectedFile();
    }
}

function closeConfigUploadModal() {
    const modal = document.getElementById('configUploadModal');
    if (modal) {
        modal.classList.remove('active');
        clearSelectedFile();
    }
}

function handleConfigFileSelect(event) {
    const file = event.target.files?.[0];
    if (file) {
        processConfigFile(file);
    }
}

function handleConfigFileDrop(event) {
    event.preventDefault();
    event.stopPropagation();

    const uploadZone = document.getElementById('configUploadZone');
    uploadZone?.classList.remove('drag-over');

    const file = event.dataTransfer?.files?.[0];
    if (file) {
        processConfigFile(file);
    }
}

function handleConfigDragOver(event) {
    event.preventDefault();
    event.stopPropagation();
    const uploadZone = document.getElementById('configUploadZone');
    uploadZone?.classList.add('drag-over');
}

function handleConfigDragLeave(event) {
    event.preventDefault();
    event.stopPropagation();
    const uploadZone = document.getElementById('configUploadZone');
    uploadZone?.classList.remove('drag-over');
}

async function processConfigFile(file) {
    if (!file.name.endsWith('.json')) {
        showToast('Please select a JSON file', 'error');
        return;
    }

    selectedConfigFile = file;

    // Show file info
    const fileInfo = document.getElementById('selectedFileInfo');
    const fileName = document.getElementById('selectedFileName');
    const fileSize = document.getElementById('selectedFileSize');
    const uploadZone = document.getElementById('configUploadZone');

    if (fileInfo) fileInfo.style.display = 'flex';
    if (fileName) fileName.textContent = file.name;
    if (fileSize) fileSize.textContent = formatFileSize(file.size);
    if (uploadZone) uploadZone.style.display = 'none';

    // Parse and validate the file
    try {
        const text = await file.text();
        rawConfigJson = text;  // Store raw JSON for upload
        parsedConfigData = JSON.parse(text);

        // Validate required fields
        const validationResult = validateConfigData(parsedConfigData);
        showValidationResult(validationResult);

        if (validationResult.valid) {
            showConfigPreview(parsedConfigData);
            const uploadBtn = document.getElementById('uploadConfirmBtn');
            if (uploadBtn) uploadBtn.disabled = false;
        }
    } catch (error) {
        console.error('Error parsing config file:', error);
        rawConfigJson = null;
        showValidationResult({
            valid: false,
            errors: ['Invalid JSON format: ' + error.message]
        });
    }
}

function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function validateConfigData(data) {
    const errors = [];

    // Extract country info - support both flat and nested formats
    // Flat: country_code, country_name, effective_from
    // Nested: country.code, country.name, effective_period.from
    const countryCode = data.country_code || data.country?.code;
    const countryName = data.country_name || data.country?.name;
    const effectiveFrom = data.effective_from || data.effective_period?.from;

    // Check required fields
    if (!countryCode) {
        errors.push('Missing required field: country.code or country_code');
    }
    if (!countryName) {
        errors.push('Missing required field: country.name or country_name');
    }
    if (!effectiveFrom) {
        errors.push('Missing required field: effective_from or effective_period.from');
    }

    // Normalize data for downstream processing
    data.country_code = countryCode;
    data.country_name = countryName;
    data.effective_from = effectiveFrom;

    // Check for at least some statutory rules (support v3 schema format)
    const hasRules = data.pf || data.pf_rules || data.esi || data.esi_rules ||
                     data.pt || data.pt_rules || data.tax || data.tax_slabs ||
                     data.social_security || data.pension || data.contributions ||
                     data.statutory_deductions || data.deduction_order ||
                     data.statutory_charges || data.component_categories;

    if (!hasRules) {
        errors.push('Config should contain at least one statutory rule section (pf, esi, pt, tax, social_security, etc.)');
    }

    return {
        valid: errors.length === 0,
        errors: errors,
        data: data
    };
}

function showValidationResult(result) {
    const statusEl = document.getElementById('validationStatus');
    const errorsEl = document.getElementById('validationErrors');
    const errorsList = document.getElementById('errorsList');
    const iconEl = document.getElementById('validationIcon');
    const titleEl = document.getElementById('validationTitle');

    if (!statusEl) return;

    statusEl.style.display = 'block';

    if (result.valid) {
        if (iconEl) iconEl.innerHTML = `
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--color-success)" stroke-width="2">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
                <polyline points="22 4 12 14.01 9 11.01"></polyline>
            </svg>
        `;
        if (titleEl) titleEl.textContent = 'Validation Passed';
        titleEl?.classList.add('text-success');
        titleEl?.classList.remove('text-error');
        if (errorsEl) errorsEl.style.display = 'none';
    } else {
        if (iconEl) iconEl.innerHTML = `
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--color-error)" stroke-width="2">
                <circle cx="12" cy="12" r="10"></circle>
                <line x1="15" y1="9" x2="9" y2="15"></line>
                <line x1="9" y1="9" x2="15" y2="15"></line>
            </svg>
        `;
        if (titleEl) titleEl.textContent = 'Validation Failed';
        titleEl?.classList.remove('text-success');
        titleEl?.classList.add('text-error');

        if (errorsEl && errorsList) {
            errorsEl.style.display = 'block';
            errorsList.innerHTML = result.errors.map(err => `
                <div class="error-item">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <circle cx="12" cy="12" r="10"></circle>
                        <line x1="15" y1="9" x2="9" y2="15"></line>
                        <line x1="9" y1="9" x2="15" y2="15"></line>
                    </svg>
                    ${escapeHtml(err)}
                </div>
            `).join('');
        }
    }
}

function showConfigPreview(data) {
    const previewEl = document.getElementById('configPreview');
    const contentEl = document.getElementById('configPreviewContent');

    if (!previewEl || !contentEl) return;

    previewEl.style.display = 'block';

    // Build preview HTML
    let previewHtml = `
        <div class="preview-grid">
            <div class="preview-item">
                <span class="preview-label">Country</span>
                <span class="preview-value">${escapeHtml(data.country_name)} (${escapeHtml(data.country_code)})</span>
            </div>
            <div class="preview-item">
                <span class="preview-label">Version</span>
                <span class="preview-value">${escapeHtml(data.version || '1.0')}</span>
            </div>
            <div class="preview-item">
                <span class="preview-label">Effective From</span>
                <span class="preview-value">${formatDate(data.effective_from)}</span>
            </div>
        </div>
        <div class="preview-sections">
            <span class="preview-label">Included Sections:</span>
            <div class="section-tags">
    `;

    // Country-agnostic section detection using charge_type from globalSchemaV3
    // charge_type enum: income_tax, regional_tax, local_tax, retirement,
    //                   social_insurance, health_insurance, levy, benefit_accrual
    const sections = [];

    // globalSchemaV3 compliant configs use statutory_charges
    if (data.statutory_charges) {
        const chargeTypes = new Set();
        Object.values(data.statutory_charges).forEach(charge => {
            if (charge.charge_type) chargeTypes.add(charge.charge_type);
        });
        // Map charge_type to generic display labels
        if (chargeTypes.has('retirement')) sections.push('Retirement Fund');
        if (chargeTypes.has('health_insurance') || chargeTypes.has('social_insurance')) sections.push('Social Insurance');
        if (chargeTypes.has('regional_tax') || chargeTypes.has('local_tax')) sections.push('Regional Tax');
        if (chargeTypes.has('income_tax')) sections.push('Income Tax');
        if (chargeTypes.has('levy')) sections.push('Welfare Fund');
        if (chargeTypes.has('benefit_accrual')) sections.push('Benefit Accrual');
    } else {
        // Legacy config support (deprecated)
        if (data.pf || data.pf_rules) sections.push('Retirement Fund');
        if (data.esi || data.esi_rules) sections.push('Social Insurance');
        if (data.pt || data.pt_rules || data.professional_tax) sections.push('Regional Tax');
        if (data.lwf || data.lwf_rules) sections.push('Welfare Fund');
        if (data.tax || data.tax_slabs || data.income_tax) sections.push('Income Tax');
        if (data.social_security) sections.push('Social Insurance');
        if (data.pension) sections.push('Pension');
    }
    if (data.deduction_order) sections.push('Deduction Order');
    if (data.states) sections.push(`Jurisdictions (${data.states.length})`);

    previewHtml += sections.map(s => `<span class="section-tag">${escapeHtml(s)}</span>`).join('');
    previewHtml += '</div></div>';

    contentEl.innerHTML = previewHtml;
}

function clearSelectedFile() {
    selectedConfigFile = null;
    parsedConfigData = null;
    rawConfigJson = null;

    const fileInput = document.getElementById('configFileInput');
    const fileInfo = document.getElementById('selectedFileInfo');
    const uploadZone = document.getElementById('configUploadZone');
    const validationStatus = document.getElementById('validationStatus');
    const validationErrors = document.getElementById('validationErrors');
    const configPreview = document.getElementById('configPreview');
    const uploadBtn = document.getElementById('uploadConfirmBtn');

    if (fileInput) fileInput.value = '';
    if (fileInfo) fileInfo.style.display = 'none';
    if (uploadZone) uploadZone.style.display = 'block';
    if (validationStatus) validationStatus.style.display = 'none';
    if (validationErrors) validationErrors.style.display = 'none';
    if (configPreview) configPreview.style.display = 'none';
    if (uploadBtn) uploadBtn.disabled = true;
}

async function confirmConfigUpload() {
    if (!parsedConfigData || !rawConfigJson) {
        showToast('No configuration data to upload', 'error');
        return;
    }

    const uploadBtn = document.getElementById('uploadConfirmBtn');

    try {
        if (uploadBtn) {
            uploadBtn.disabled = true;
            uploadBtn.innerHTML = `
                <svg class="spinner" width="16" height="16" viewBox="0 0 24 24">
                    <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" fill="none" opacity="0.25"/>
                    <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" stroke-width="3" fill="none" stroke-linecap="round"/>
                </svg>
                Uploading...
            `;
        }

        // Send raw JSON wrapped in the expected DTO format
        await api.request('/hrms/statutory/configs/upload', {
            method: 'POST',
            body: JSON.stringify({ jsonContent: rawConfigJson })
        });

        showToast(`${parsedConfigData.country_name} configuration uploaded successfully`, 'success');
        closeConfigUploadModal();
        await loadCountryConfigs();

    } catch (error) {
        console.error('Error uploading config:', error);
        showToast(error.message || 'Failed to upload configuration', 'error');
    } finally {
        if (uploadBtn) {
            uploadBtn.disabled = false;
            uploadBtn.innerHTML = 'Upload Configuration';
        }
    }
}

// ==================== Config View Modal ====================

async function viewConfig(countryCode) {
    const modal = document.getElementById('configViewModal');
    if (!modal) return;

    try {
        showLoading();

        // Find config by country code (support both camelCase and snake_case)
        const config = countryConfigs.find(c =>
            (c.countryCode || c.country_code) === countryCode
        );
        if (!config) {
            showToast('Configuration not found', 'error');
            return;
        }

        // Fetch full config data - use country code, not ID
        const response = await api.request(`/hrms/statutory/configs/country/${countryCode}`);

        // API returns { success: true, config: {...} }
        const fullConfig = response.config || response;
        currentViewingConfig = fullConfig;

        // Update modal title
        const titleEl = document.getElementById('configViewTitle');
        const versionBadge = document.getElementById('configVersionBadge');

        // Support both camelCase and snake_case from API
        const configCountryName = fullConfig.countryName || fullConfig.country_name ||
                                  fullConfig.CountryName || 'Unknown';
        if (titleEl) titleEl.textContent = `${configCountryName} Configuration`;
        if (versionBadge) versionBadge.textContent = `v${fullConfig.version || fullConfig.Version || '1.0'}`;

        // Render config content
        renderConfigContent(fullConfig);

        modal.classList.add('active');
        hideLoading();

    } catch (error) {
        console.error('Error viewing config:', error);
        showToast('Failed to load configuration details', 'error');
        hideLoading();
    }
}

function renderConfigContent(config) {
    const tabsEl = document.getElementById('configTabs');
    const contentEl = document.getElementById('configContent');

    if (!tabsEl || !contentEl) return;

    // Get the inner config data (JSONB content) - support both camelCase and snake_case
    const configData = config.configData || config.ConfigData || config.config_data || config;

    // Schema-aware section detection - ALL sections from GlobalStatutorySchema.json
    const sections = [
        { id: 'overview', name: 'Overview', icon: '📋' }
    ];

    // Required schema sections (must show all for audit)
    if (configData.country) sections.push({ id: 'country', name: 'Country', icon: '🌍' });
    if (configData.effective_period) sections.push({ id: 'effective_period', name: 'Period', icon: '📅' });
    if (configData.tax_system) sections.push({ id: 'tax_system', name: 'Tax System', icon: '💰' });
    if (configData.social_contributions) sections.push({ id: 'social_contributions', name: 'Social', icon: '🏛️' });
    if (configData.regional_taxes) sections.push({ id: 'regional_taxes', name: 'Regional', icon: '🗺️' });
    if (configData.jurisdiction_resolution) sections.push({ id: 'jurisdiction', name: 'Rules', icon: '⚖️' });
    if (configData.deduction_order) sections.push({ id: 'deduction_order', name: 'Order', icon: '📊' });
    if (configData.ytd_tracking) sections.push({ id: 'ytd_tracking', name: 'YTD', icon: '📈' });
    if (configData.compliance_calendar) sections.push({ id: 'compliance_calendar', name: 'Calendar', icon: '🗓️' });

    // Country-agnostic: Build tabs from statutory_charges using charge_type enum
    if (configData.statutory_charges) {
        Object.entries(configData.statutory_charges).forEach(([code, charge]) => {
            const displayName = charge.display_name || code;
            sections.push({ id: `charge_${code}`, name: displayName, chargeData: charge });
        });
    } else {
        // Legacy section support (deprecated) - use generic labels
        if (configData.pf || configData.pf_rules) sections.push({ id: 'pf', name: 'Retirement' });
        if (configData.esi || configData.esi_rules) sections.push({ id: 'esi', name: 'Insurance' });
        if (configData.income_tax && !configData.tax_system) sections.push({ id: 'income_tax', name: 'Tax' });
    }
    if (configData.states) sections.push({ id: 'states', name: 'Jurisdictions' });

    // Render tabs - compact horizontal scrollable
    // Handle missing icons gracefully (country-agnostic: not all sections have icons)
    tabsEl.innerHTML = `<div class="config-tabs-scroll">${sections.map((s, i) => `
        <button type="button" class="config-tab ${i === 0 ? 'active' : ''}" data-section="${s.id}" title="${escapeHtml(s.name)}">
            ${s.icon ? `<span class="tab-icon">${s.icon}</span>` : ''}
            <span class="tab-name">${escapeHtml(s.name)}</span>
        </button>
    `).join('')}</div>`;

    // Add tab click handlers
    tabsEl.querySelectorAll('.config-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            tabsEl.querySelectorAll('.config-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            renderConfigSection(tab.dataset.section, config, configData);
        });
    });

    // Render first section
    renderConfigSection('overview', config, configData);
}

function renderConfigSection(sectionId, config, configData) {
    const contentEl = document.getElementById('configContent');
    if (!contentEl) return;

    let html = '';

    switch (sectionId) {
        case 'overview':
            html = renderOverviewSection(config, configData);
            break;
        case 'country':
            html = renderCountrySection(configData.country);
            break;
        case 'effective_period':
            html = renderEffectivePeriodSection(configData.effective_period);
            break;
        case 'tax_system':
            html = renderTaxSystemSection(configData.tax_system);
            break;
        case 'social_contributions':
            html = renderSocialContributionsSection(configData.social_contributions);
            break;
        case 'regional_taxes':
            html = renderRegionalTaxesSection(configData.regional_taxes);
            break;
        case 'jurisdiction':
            html = renderJurisdictionSection(configData.jurisdiction_resolution);
            break;
        case 'deduction_order':
            html = renderDeductionOrderSection(configData.deduction_order);
            break;
        case 'ytd_tracking':
            html = renderYtdTrackingSection(configData.ytd_tracking);
            break;
        case 'compliance_calendar':
            html = renderComplianceCalendarSection(configData.compliance_calendar);
            break;
        // Legacy sections with generic labels (deprecated - use statutory_charges)
        case 'pf':
            html = renderCompactDataSection('Retirement Fund', configData.pf || configData.pf_rules);
            break;
        case 'esi':
            html = renderCompactDataSection('Social Insurance', configData.esi || configData.esi_rules);
            break;
        case 'income_tax':
            html = renderCompactDataSection('Income Tax', configData.income_tax);
            break;
        case 'states':
            html = renderStatesSection(configData.states);
            break;
        default:
            // Handle dynamically created statutory_charges sections
            if (sectionId.startsWith('charge_') && configData.statutory_charges) {
                const chargeCode = sectionId.replace('charge_', '');
                const charge = configData.statutory_charges[chargeCode];
                if (charge) {
                    const displayName = charge.display_name || chargeCode;
                    html = renderCompactDataSection(displayName, charge);
                    break;
                }
            }
            html = '<div class="cfg-empty">Section not available</div>';
    }

    contentEl.innerHTML = html;
}

// ==================== Compact Config Section Renderers ====================
// All use CSS variables for theme awareness (see compliance.css)

function renderOverviewSection(config, configData) {
    // Get data from both outer config (metadata) and inner configData (JSONB)
    const countryName = config.countryName || config.country_name || configData.country?.name || 'Unknown';
    const countryCode = config.countryCode || config.country_code || configData.country?.code || '';
    const version = config.version || config.Version || configData.schema_version || '1.0';
    const effectiveFrom = config.effectiveFrom || config.effective_from || configData.effective_period?.from;
    const effectiveTo = config.effectiveTo || config.effective_to || configData.effective_period?.to;
    const currency = configData.country?.currency;

    // Count sections for summary
    const sectionCount = [
        configData.tax_system, configData.social_contributions, configData.regional_taxes,
        configData.jurisdiction_resolution, configData.deduction_order, configData.ytd_tracking
    ].filter(Boolean).length;

    return `
        <div class="cfg-overview">
            <div class="cfg-header-card">
                <div class="cfg-country-badge">${countryCode}</div>
                <div class="cfg-header-info">
                    <h3 class="cfg-title">${escapeHtml(countryName)}</h3>
                    <span class="cfg-version">v${escapeHtml(version)}</span>
                </div>
            </div>
            <div class="cfg-stats-grid">
                <div class="cfg-stat">
                    <span class="cfg-stat-value">${formatDate(effectiveFrom) || '-'}</span>
                    <span class="cfg-stat-label">Effective From</span>
                </div>
                <div class="cfg-stat">
                    <span class="cfg-stat-value">${effectiveTo ? formatDate(effectiveTo) : 'Current'}</span>
                    <span class="cfg-stat-label">Effective To</span>
                </div>
                ${currency ? `
                <div class="cfg-stat">
                    <span class="cfg-stat-value">${escapeHtml(currency.symbol || '')} ${escapeHtml(currency.code || '')}</span>
                    <span class="cfg-stat-label">Currency</span>
                </div>` : ''}
                <div class="cfg-stat">
                    <span class="cfg-stat-value">${sectionCount}</span>
                    <span class="cfg-stat-label">Config Sections</span>
                </div>
            </div>
            ${configData.country?.fiscal_year ? `
            <div class="cfg-fiscal">
                <span class="cfg-fiscal-label">Fiscal Year:</span>
                <span class="cfg-fiscal-value">Starts ${getMonthName(configData.country.fiscal_year.start_month)} ${configData.country.fiscal_year.start_day || 1}</span>
            </div>` : ''}
        </div>
    `;
}

function renderCountrySection(country) {
    if (!country) return '<div class="cfg-empty">No country data</div>';
    return `
        <div class="cfg-section">
            <div class="cfg-row-grid">
                <div class="cfg-field"><label>Code</label><span>${escapeHtml(country.code || '-')}</span></div>
                <div class="cfg-field"><label>Name</label><span>${escapeHtml(country.name || '-')}</span></div>
            </div>
            ${country.currency ? `
            <div class="cfg-subsection">
                <h5>Currency</h5>
                <div class="cfg-row-grid">
                    <div class="cfg-field"><label>Code</label><span>${escapeHtml(country.currency.code || '-')}</span></div>
                    <div class="cfg-field"><label>Symbol</label><span>${escapeHtml(country.currency.symbol || '-')}</span></div>
                    <div class="cfg-field"><label>Decimals</label><span>${country.currency.decimal_places ?? '-'}</span></div>
                </div>
            </div>` : ''}
            ${country.fiscal_year ? `
            <div class="cfg-subsection">
                <h5>Fiscal Year</h5>
                <div class="cfg-row-grid">
                    <div class="cfg-field"><label>Start Month</label><span>${getMonthName(country.fiscal_year.start_month)}</span></div>
                    <div class="cfg-field"><label>Start Day</label><span>${country.fiscal_year.start_day || 1}</span></div>
                </div>
            </div>` : ''}
        </div>
    `;
}

function renderEffectivePeriodSection(period) {
    if (!period) return '<div class="cfg-empty">No effective period data</div>';
    return `
        <div class="cfg-section">
            <div class="cfg-row-grid">
                <div class="cfg-field"><label>From</label><span class="cfg-date">${formatDate(period.from) || '-'}</span></div>
                <div class="cfg-field"><label>To</label><span class="cfg-date">${period.to ? formatDate(period.to) : '<em>Current</em>'}</span></div>
            </div>
        </div>
    `;
}

function renderTaxSystemSection(taxSystem) {
    if (!taxSystem) return '<div class="cfg-empty">No tax system data</div>';

    let html = `<div class="cfg-section">
        <div class="cfg-field"><label>Tax Code</label><span class="cfg-code">${escapeHtml(taxSystem.tax_code || '-')}</span></div>`;

    // Regimes
    if (taxSystem.regimes) {
        html += '<div class="cfg-subsection"><h5>Tax Regimes</h5><div class="cfg-regimes">';
        for (const [key, regime] of Object.entries(taxSystem.regimes)) {
            html += `
                <div class="cfg-regime-card">
                    <div class="cfg-regime-header">
                        <span class="cfg-regime-name">${escapeHtml(regime.name || key)}</span>
                        ${taxSystem.default_regime === key ? '<span class="cfg-badge-default">Default</span>' : ''}
                    </div>
                    ${regime.standard_deduction ? `<div class="cfg-field-inline"><label>Std Deduction</label><span>${formatCurrency(regime.standard_deduction.amount || regime.standard_deduction)}</span></div>` : ''}
                    ${regime.slabs ? `
                    <div class="cfg-slabs-compact">
                        <table class="cfg-table">
                            <thead><tr><th>From</th><th>To</th><th>Rate</th></tr></thead>
                            <tbody>${regime.slabs.map(s => `<tr><td>${formatCurrency(s.from)}</td><td>${s.to ? formatCurrency(s.to) : '∞'}</td><td>${s.rate_percent}%</td></tr>`).join('')}</tbody>
                        </table>
                    </div>` : ''}
                    ${regime.rebate ? `<div class="cfg-field-inline"><label>Rebate (${regime.rebate.section || '87A'})</label><span>Up to ${formatCurrency(regime.rebate.max_income_threshold)}, Max ${formatCurrency(regime.rebate.max_rebate_amount)}</span></div>` : ''}
                </div>`;
        }
        html += '</div></div>';
    }

    // Surcharge
    if (taxSystem.surcharge?.slabs) {
        html += `<div class="cfg-subsection"><h5>Surcharge Slabs</h5>
            <table class="cfg-table"><thead><tr><th>From</th><th>To</th><th>Rate</th></tr></thead>
            <tbody>${taxSystem.surcharge.slabs.map(s => `<tr><td>${formatCurrency(s.from)}</td><td>${s.to ? formatCurrency(s.to) : '∞'}</td><td>${s.rate_percent}%</td></tr>`).join('')}</tbody></table>
        </div>`;
    }

    // Cess
    if (taxSystem.cess) {
        html += `<div class="cfg-field"><label>Cess</label><span>${taxSystem.cess.rate_percent}% on ${escapeHtml(taxSystem.cess.applies_on || 'tax')}</span></div>`;
    }

    html += '</div>';
    return html;
}

function renderSocialContributionsSection(social) {
    if (!social?.contributions?.length) return '<div class="cfg-empty">No social contributions</div>';

    return `
        <div class="cfg-section">
            <div class="cfg-contributions">
                ${social.contributions.map(c => `
                    <div class="cfg-contrib-card">
                        <div class="cfg-contrib-header">
                            <span class="cfg-code">${escapeHtml(c.code)}</span>
                            <span class="cfg-contrib-name">${escapeHtml(c.name)}</span>
                            <span class="cfg-badge-type">${formatLabel(c.type || 'other')}</span>
                        </div>
                        <div class="cfg-contrib-rates">
                            <div class="cfg-rate-box employee">
                                <span class="cfg-rate-label">Employee</span>
                                <span class="cfg-rate-value">${c.employee_share?.rate_percent || 0}%</span>
                            </div>
                            <div class="cfg-rate-box employer">
                                <span class="cfg-rate-label">Employer</span>
                                <span class="cfg-rate-value">${c.employer_share?.rate_percent || 0}%</span>
                            </div>
                        </div>
                        ${c.wage_ceiling?.monthly ? `<div class="cfg-field-inline"><label>Wage Ceiling</label><span>${formatCurrency(c.wage_ceiling.monthly)}/mo</span></div>` : ''}
                        ${c.applicability?.wage_threshold?.monthly ? `<div class="cfg-field-inline"><label>Threshold</label><span>≤ ${formatCurrency(c.applicability.wage_threshold.monthly)}/mo</span></div>` : ''}
                        ${c.governing_body ? `<div class="cfg-field-inline"><label>Authority</label><span>${escapeHtml(c.governing_body)}</span></div>` : ''}
                    </div>
                `).join('')}
            </div>
        </div>
    `;
}

function renderRegionalTaxesSection(regionalTaxes) {
    if (!regionalTaxes || Object.keys(regionalTaxes).length === 0) return '<div class="cfg-empty">No regional taxes</div>';

    const jurisdictions = Object.entries(regionalTaxes);
    return `
        <div class="cfg-section">
            <div class="cfg-jurisdiction-count">${jurisdictions.length} Jurisdiction${jurisdictions.length > 1 ? 's' : ''}</div>
            <div class="cfg-jurisdictions">
                ${jurisdictions.map(([code, jur]) => `
                    <details class="cfg-jurisdiction">
                        <summary>
                            <span class="cfg-jur-code">${escapeHtml(code)}</span>
                            <span class="cfg-jur-name">${escapeHtml(jur.jurisdiction_name)}</span>
                            <span class="cfg-jur-count">${jur.taxes?.length || 0} tax${(jur.taxes?.length || 0) !== 1 ? 'es' : ''}</span>
                        </summary>
                        <div class="cfg-jur-taxes">
                            ${(jur.taxes || []).map(tax => `
                                <div class="cfg-tax-item">
                                    <div class="cfg-tax-header">
                                        <span class="cfg-code">${escapeHtml(tax.tax_code)}</span>
                                        <span>${escapeHtml(tax.tax_name)}</span>
                                    </div>
                                    <div class="cfg-tax-calc">
                                        ${renderCalculationMethod(tax.calculation)}
                                    </div>
                                    ${tax.frequency ? `<div class="cfg-field-inline"><label>Frequency</label><span>${formatLabel(tax.frequency)}</span></div>` : ''}
                                </div>
                            `).join('')}
                        </div>
                    </details>
                `).join('')}
            </div>
        </div>
    `;
}

function renderCalculationMethod(calc) {
    if (!calc) return '<span class="cfg-muted">No calculation</span>';

    let html = `<span class="cfg-calc-method">${formatLabel(calc.method || 'unknown')}</span>`;

    if (calc.slabs?.length) {
        html += `<table class="cfg-table-mini"><thead><tr><th>From</th><th>To</th><th>Amount</th></tr></thead><tbody>`;
        html += calc.slabs.map(s => `<tr><td>${formatCurrency(s.from)}</td><td>${s.to ? formatCurrency(s.to) : '∞'}</td><td>${s.amount !== undefined ? formatCurrency(s.amount) : (s.rate_percent + '%')}</td></tr>`).join('');
        html += '</tbody></table>';
    } else if (calc.rate_percent !== undefined) {
        html += ` <span class="cfg-rate">${calc.rate_percent}%</span>`;
        if (calc.basis) html += ` of ${formatLabel(calc.basis)}`;
    } else if (calc.fixed_amount !== undefined) {
        html += ` <span class="cfg-amount">${formatCurrency(calc.fixed_amount)}</span>`;
    }

    if (calc.max_amount) html += ` <span class="cfg-muted">(max ${formatCurrency(calc.max_amount)})</span>`;
    if (calc.exemption_threshold) html += ` <span class="cfg-muted">(exempt ≤ ${formatCurrency(calc.exemption_threshold)})</span>`;

    return html;
}

function renderJurisdictionSection(jurRes) {
    if (!jurRes?.bindings?.length) return '<div class="cfg-empty">No jurisdiction bindings</div>';

    return `
        <div class="cfg-section">
            <p class="cfg-description">Defines how taxes are resolved based on employee/office data.</p>
            <div class="cfg-bindings">
                ${jurRes.bindings.map(b => `
                    <div class="cfg-binding-card">
                        <div class="cfg-binding-header">
                            <span class="cfg-code">${escapeHtml(b.binding_id)}</span>
                            <span class="cfg-badge-type">${b.applies_to?.map(a => formatLabel(a)).join(', ') || '-'}</span>
                        </div>
                        <div class="cfg-binding-lookup">
                            <label>Lookup:</label>
                            <code>${escapeHtml(b.lookup_key?.primary?.path || '-')}</code>
                            ${b.lookup_key?.fallback ? `<span class="cfg-muted">fallback: ${escapeHtml(b.lookup_key.fallback.path)}</span>` : ''}
                        </div>
                        ${b.override_rules?.length ? `
                        <details class="cfg-overrides">
                            <summary>${b.override_rules.length} Override Rule${b.override_rules.length > 1 ? 's' : ''}</summary>
                            <ul>${b.override_rules.map(r => `<li><code>${escapeHtml(r.rule_id)}</code> - ${escapeHtml(r.resolution?.type || 'unknown')}</li>`).join('')}</ul>
                        </details>` : ''}
                    </div>
                `).join('')}
            </div>
        </div>
    `;
}

function renderDeductionOrderSection(dedOrder) {
    if (!dedOrder?.sequence?.length) return '<div class="cfg-empty">No deduction order</div>';

    return `
        <div class="cfg-section">
            <p class="cfg-description">Order in which deductions are calculated during payroll.</p>
            <table class="cfg-table">
                <thead><tr><th>#</th><th>Code</th><th>Name</th><th>Category</th><th>Tax Impact</th></tr></thead>
                <tbody>
                    ${dedOrder.sequence.map(d => `
                        <tr>
                            <td class="cfg-order">${d.order}</td>
                            <td><span class="cfg-code">${escapeHtml(d.deduction_code)}</span></td>
                            <td>${escapeHtml(d.deduction_name || '-')}</td>
                            <td><span class="cfg-badge-${d.category || 'other'}">${formatLabel(d.category || '-')}</span></td>
                            <td>${d.reduces_taxable_income ? '<span class="cfg-badge-yes">Reduces Tax</span>' : '<span class="cfg-badge-no">Post Tax</span>'}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
    `;
}

function renderYtdTrackingSection(ytd) {
    if (!ytd?.tracked_components?.length) return '<div class="cfg-empty">No YTD tracking</div>';

    return `
        <div class="cfg-section">
            <div class="cfg-row-grid">
                <div class="cfg-field"><label>Fiscal Reset</label><span>${ytd.fiscal_year_reset !== false ? 'Yes' : 'No'}</span></div>
                ${ytd.calendar_year_components?.length ? `<div class="cfg-field"><label>Calendar Year</label><span>${ytd.calendar_year_components.join(', ')}</span></div>` : ''}
            </div>
            <table class="cfg-table">
                <thead><tr><th>Code</th><th>Name</th><th>Type</th><th>Ceiling</th><th>Affects</th></tr></thead>
                <tbody>
                    ${ytd.tracked_components.map(c => `
                        <tr>
                            <td><span class="cfg-code">${escapeHtml(c.component_code)}</span></td>
                            <td>${escapeHtml(c.component_name || '-')}</td>
                            <td>${formatLabel(c.tracking_type || '-')}</td>
                            <td>${c.ceiling ? formatCurrency(c.ceiling) : '-'}</td>
                            <td>${c.affects?.map(a => formatLabel(a)).join(', ') || '-'}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
    `;
}

function renderComplianceCalendarSection(calendar) {
    if (!calendar) return '<div class="cfg-empty">No compliance calendar</div>';

    let html = '<div class="cfg-section">';

    if (calendar.returns?.length) {
        html += `<div class="cfg-subsection"><h5>Filing Returns</h5>
            <table class="cfg-table"><thead><tr><th>Code</th><th>Name</th><th>Frequency</th><th>Due Date</th></tr></thead><tbody>
            ${calendar.returns.map(r => `<tr><td><span class="cfg-code">${escapeHtml(r.return_code)}</span></td><td>${escapeHtml(r.name)}</td><td>${formatLabel(r.frequency)}</td><td>${formatLabel(r.due_date_rule)}</td></tr>`).join('')}
            </tbody></table></div>`;
    }

    if (calendar.payments?.length) {
        html += `<div class="cfg-subsection"><h5>Payment Deadlines</h5>
            <table class="cfg-table"><thead><tr><th>Code</th><th>Name</th><th>Frequency</th><th>Due Date</th></tr></thead><tbody>
            ${calendar.payments.map(p => `<tr><td><span class="cfg-code">${escapeHtml(p.payment_code)}</span></td><td>${escapeHtml(p.name)}</td><td>${formatLabel(p.frequency)}</td><td>${formatLabel(p.due_date_rule)}</td></tr>`).join('')}
            </tbody></table></div>`;
    }

    html += '</div>';
    return html;
}

function renderCompactDataSection(title, data) {
    if (!data) return `<div class="cfg-empty">No ${title.toLowerCase()} data</div>`;

    return `
        <div class="cfg-section">
            <div class="cfg-json-compact">
                ${renderObjectAsFields(data)}
            </div>
        </div>
    `;
}

function renderObjectAsFields(obj, depth = 0) {
    if (!obj || typeof obj !== 'object') return '';
    if (Array.isArray(obj)) {
        return `<div class="cfg-array">${obj.map((item, i) =>
            typeof item === 'object' ? `<div class="cfg-array-item"><span class="cfg-array-idx">${i + 1}</span>${renderObjectAsFields(item, depth + 1)}</div>`
            : `<span class="cfg-array-val">${escapeHtml(String(item))}</span>`
        ).join('')}</div>`;
    }

    return Object.entries(obj).map(([key, val]) => {
        const label = key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
        if (val && typeof val === 'object') {
            return `<details class="cfg-nested" ${depth < 1 ? 'open' : ''}><summary>${escapeHtml(label)}</summary>${renderObjectAsFields(val, depth + 1)}</details>`;
        }
        return `<div class="cfg-field"><label>${escapeHtml(label)}</label><span>${escapeHtml(String(val ?? '-'))}</span></div>`;
    }).join('');
}

function renderStatesSection(states) {
    if (!states?.length) return '<div class="cfg-empty">No states configured</div>';

    return `
        <div class="cfg-section">
            <div class="cfg-state-count">${states.length} State${states.length > 1 ? 's' : ''}</div>
            <div class="cfg-states-grid">
                ${states.map(s => `
                    <div class="cfg-state-chip">
                        <span class="cfg-state-code">${escapeHtml(s.state_code || s.code)}</span>
                        <span class="cfg-state-name">${escapeHtml(s.state_name || s.name)}</span>
                    </div>
                `).join('')}
            </div>
        </div>
    `;
}

// Helper functions
function getMonthName(month) {
    const months = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    return months[month] || month;
}

function formatCurrency(amount) {
    if (amount === null || amount === undefined) return '-';
    return new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(amount);
}

// Format label: convert snake_case to Title Case for display
function formatLabel(str) {
    if (!str) return '-';
    return str.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function closeConfigViewModal() {
    const modal = document.getElementById('configViewModal');
    if (modal) {
        modal.classList.remove('active');
        currentViewingConfig = null;
    }
}

// ==================== Config Download ====================

async function downloadConfigAsJson(countryCode) {
    try {
        // Find config (support both camelCase and snake_case)
        const config = countryConfigs.find(c =>
            (c.countryCode || c.country_code) === countryCode
        );
        if (!config) {
            showToast('Configuration not found', 'error');
            return;
        }

        // Fetch full config - use country code, not ID
        const response = await api.request(`/hrms/statutory/configs/country/${countryCode}`);

        // API returns { success: true, config: {...} }
        const fullConfig = response.config || response;

        // Create download (support both configData and config_data)
        const configData = fullConfig.configData || fullConfig.ConfigData ||
                          fullConfig.config_data || fullConfig;
        const blob = new Blob([JSON.stringify(configData, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${countryCode.toLowerCase()}-statutory-config.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        showToast('Configuration downloaded', 'success');
    } catch (error) {
        console.error('Error downloading config:', error);
        showToast('Failed to download configuration', 'error');
    }
}

function downloadCurrentConfig() {
    if (!currentViewingConfig) {
        showToast('No configuration loaded', 'error');
        return;
    }

    const countryCode = currentViewingConfig.countryCode || currentViewingConfig.country_code || 'config';
    const configData = currentViewingConfig.configData || currentViewingConfig.config_data || currentViewingConfig;
    const blob = new Blob([JSON.stringify(configData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${countryCode.toLowerCase()}-statutory-config.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    showToast('Configuration downloaded', 'success');
}

// ==================== Drag & Drop Setup ====================

document.addEventListener('DOMContentLoaded', () => {
    const uploadZone = document.getElementById('configUploadZone');
    if (uploadZone) {
        uploadZone.addEventListener('dragover', handleConfigDragOver);
        uploadZone.addEventListener('dragleave', handleConfigDragLeave);
        uploadZone.addEventListener('drop', handleConfigFileDrop);
    }
});
