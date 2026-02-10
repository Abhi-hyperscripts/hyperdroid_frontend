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
    const overlay = document.getElementById('sidebarOverlay');

    if (!toggle || !sidebar) return;

    // Open sidebar by default on desktop, ensure closed on mobile
    if (window.innerWidth > 1024) {
        toggle.classList.add('active');
        sidebar.classList.add('open');
        container?.classList.add('sidebar-open');
    } else {
        toggle.classList.remove('active');
        sidebar.classList.remove('open');
        container?.classList.remove('sidebar-open');
        overlay?.classList.remove('active');
    }

    // Toggle sidebar open/close
    toggle.addEventListener('click', () => {
        toggle.classList.toggle('active');
        sidebar.classList.toggle('open');
        container?.classList.toggle('sidebar-open');
        if (window.innerWidth <= 1024) {
            overlay?.classList.toggle('active');
        }
    });

    // Close sidebar when clicking overlay (mobile)
    overlay?.addEventListener('click', () => {
        toggle.classList.remove('active');
        sidebar.classList.remove('open');
        container?.classList.remove('sidebar-open');
        overlay?.classList.remove('active');
    });

    // Close sidebar on Escape key
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && sidebar.classList.contains('open')) {
            toggle.classList.remove('active');
            sidebar.classList.remove('open');
            container?.classList.remove('sidebar-open');
            overlay?.classList.remove('active');
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
        renderCountryTabs();  // v3.3.3: Render country tabs for statutory registrations
    } catch (error) {
        console.error('Error loading country configs:', error);
        countryConfigs = [];
        renderCountryConfigs();
        renderCountryTabs();  // v3.3.3: Also render tabs on error to show no-configs message
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

    // Schema-aware section detection - ALL sections from GlobalStatutorySchema v3.1.0
    // This modal is designed for viewing by Lawyers, CAs, and Government Agencies
    // NO ICONS - professional compliance document presentation
    const sections = [
        { id: 'overview', name: 'Overview' }
    ];

    // PUBLIC sections - shown to Lawyers, CAs, Government Agencies
    // INTERNAL sections (engine_semantics, precedence, roles, bindings, accumulation) are HIDDEN
    // to prevent exposing competitive/internal implementation details

    if (configData.country) sections.push({ id: 'country', name: 'Country' });
    if (configData.effective_period) sections.push({ id: 'effective_period', name: 'Effective Period' });
    if (configData.establishments) sections.push({ id: 'establishments', name: 'Establishment Types' });
    if (configData.jurisdictions) sections.push({ id: 'jurisdictions', name: 'Jurisdictions' });
    if (configData.eligibility_constraints) sections.push({ id: 'eligibility_constraints', name: 'Eligibility Criteria' });

    // Statutory Charges - ONE tab showing ALL charges (rates, caps, thresholds)
    if (configData.statutory_charges) {
        sections.push({ id: 'statutory_charges', name: 'Statutory Contributions' });
    }

    // Jurisdiction Data - shows all state/regional tax slabs (PT, LWF rates)
    if (configData.jurisdiction_data) sections.push({ id: 'jurisdiction_data', name: 'Regional Tax Slabs' });

    // Income Tax Regimes - shows tax slabs, rebates, deductions, surcharges, cess
    if (configData.tax_regimes) sections.push({ id: 'tax_regimes', name: 'Income Tax' });

    // Deduction Order - employees should know the order
    if (configData.deduction_order) sections.push({ id: 'deduction_order', name: 'Deduction Priority' });

    // Reporting requirements
    if (configData.reporting) sections.push({ id: 'reporting', name: 'Compliance Reporting' });

    // Legal References ONLY (not formulas/expressions which are internal)
    if (configData.engine_semantics?.formula_governance?.builtin_formulas) {
        sections.push({ id: 'legal_references', name: 'Legal References' });
    }

    // Legacy schema support
    if (configData.tax_system) sections.push({ id: 'tax_system', name: 'Tax System' });
    if (configData.social_contributions) sections.push({ id: 'social_contributions', name: 'Social' });
    if (configData.regional_taxes) sections.push({ id: 'regional_taxes', name: 'Regional' });
    if (configData.ytd_tracking) sections.push({ id: 'ytd_tracking', name: 'YTD' });
    if (configData.compliance_calendar) sections.push({ id: 'compliance_calendar', name: 'Calendar' });
    if (configData.jurisdiction_resolution) sections.push({ id: 'jurisdiction', name: 'Resolution' });
    if (configData.states) sections.push({ id: 'states', name: 'States' });

    // Render tabs - compact horizontal scrollable (no icons for professional presentation)
    tabsEl.innerHTML = `<div class="config-tabs-scroll">${sections.map((s, i) => `
        <button type="button" class="config-tab ${i === 0 ? 'active' : ''}" data-section="${s.id}" title="${escapeHtml(s.name)}">
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
        case 'engine_semantics':
            html = renderEngineSemanticsSection(configData.engine_semantics);
            break;
        case 'country':
            html = renderCountrySection(configData.country);
            break;
        case 'effective_period':
            html = renderEffectivePeriodSection(configData.effective_period);
            break;
        case 'establishments':
            html = renderEstablishmentsSection(configData.establishments);
            break;
        case 'jurisdictions':
            html = renderJurisdictionsListSection(configData.jurisdictions);
            break;
        case 'jurisdiction_precedence':
            html = renderJurisdictionPrecedenceSection(configData.jurisdiction_precedence);
            break;
        case 'eligibility_constraints':
            html = renderEligibilityConstraintsSection(configData.eligibility_constraints);
            break;
        case 'component_categories':
            html = renderComponentCategoriesSection(configData.component_categories);
            break;
        case 'statutory_roles':
            html = renderStatutoryRolesSection(configData.statutory_roles);
            break;
        case 'required_roles':
            html = renderRequiredRolesSection(configData.required_roles);
            break;
        case 'statutory_charges':
            html = renderStatutoryChargesSection(configData.statutory_charges, configData);
            break;
        case 'jurisdiction_data':
            html = renderJurisdictionDataSection(configData.jurisdiction_data, configData.jurisdictions);
            break;
        case 'tax_regimes':
            html = renderTaxRegimesSection(configData);
            break;
        case 'jurisdiction_bindings':
            html = renderJurisdictionBindingsSection(configData.jurisdiction_bindings);
            break;
        case 'deduction_order':
            html = renderDeductionOrderSection(configData.deduction_order);
            break;
        case 'accumulation_models':
            html = renderAccumulationModelsSection(configData.accumulation_models);
            break;
        case 'reporting':
            html = renderReportingSection(configData.reporting);
            break;
        case 'builtin_formulas':
            html = renderBuiltinFormulasSection(configData.engine_semantics?.formula_governance?.builtin_formulas);
            break;
        case 'legal_references':
            html = renderLegalReferencesOnlySection(configData.engine_semantics?.formula_governance?.builtin_formulas);
            break;
        // Legacy schema support
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
        case 'ytd_tracking':
            html = renderYtdTrackingSection(configData.ytd_tracking);
            break;
        case 'compliance_calendar':
            html = renderComplianceCalendarSection(configData.compliance_calendar);
            break;
        case 'states':
            html = renderStatesSection(configData.states);
            break;
        default:
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
    const fiscalYear = configData.country?.fiscal_year;

    // Count various items for statistics
    const jurisdictionCount = configData.jurisdiction_data ? Object.values(configData.jurisdiction_data).flat().length : 0;
    const stateCount = configData.states ? configData.states.length : 0;
    const componentCount = configData.component_categories ? Object.keys(configData.component_categories).length : 0;
    const taxRegimeCount = configData.tax_regimes ? Object.keys(configData.tax_regimes).length : 0;

    // Get compliance categories
    const complianceCategories = [];
    if (configData.component_categories) {
        Object.entries(configData.component_categories).forEach(([key, cat]) => {
            if (cat.display_name) complianceCategories.push(cat.display_name);
        });
    }

    // Build configuration highlights
    const highlights = [];
    if (configData.tax_regimes) highlights.push({ icon: '📊', label: 'Income Tax', desc: `${taxRegimeCount} tax regime${taxRegimeCount !== 1 ? 's' : ''}` });
    if (configData.component_categories) highlights.push({ icon: '📋', label: 'Statutory Components', desc: `${componentCount} categor${componentCount !== 1 ? 'ies' : 'y'}` });
    if (configData.jurisdiction_data) highlights.push({ icon: '🗺️', label: 'Regional Rules', desc: `${jurisdictionCount} jurisdiction${jurisdictionCount !== 1 ? 's' : ''}` });
    if (configData.states && stateCount > 0) highlights.push({ icon: '🏛️', label: 'States/Regions', desc: `${stateCount} state${stateCount !== 1 ? 's' : ''}` });
    if (configData.eligibility_constraints) highlights.push({ icon: '✓', label: 'Eligibility Rules', desc: 'Configured' });
    if (configData.deduction_order) highlights.push({ icon: '📑', label: 'Deduction Priority', desc: 'Configured' });
    if (configData.compliance_calendar) highlights.push({ icon: '📅', label: 'Compliance Calendar', desc: 'Configured' });
    if (configData.legal_references) highlights.push({ icon: '⚖️', label: 'Legal References', desc: 'Documented' });

    return `
        <div class="cfg-overview-v2">
            <!-- Hero Section -->
            <div class="cfg-hero">
                <div class="cfg-hero-left">
                    <div class="cfg-hero-badge">${getCountryFlag(countryCode)}</div>
                    <div class="cfg-hero-info">
                        <h2 class="cfg-hero-title">${escapeHtml(countryName)}</h2>
                        <div class="cfg-hero-meta">
                            <span class="cfg-hero-code">${escapeHtml(countryCode)}</span>
                            <span class="cfg-hero-version">v${escapeHtml(version)}</span>
                            <span class="cfg-hero-status">Active</span>
                        </div>
                    </div>
                </div>
                <div class="cfg-hero-right">
                    ${currency ? `
                    <div class="cfg-hero-currency">
                        <span class="cfg-currency-symbol">${escapeHtml(currency.symbol || '')}</span>
                        <span class="cfg-currency-code">${escapeHtml(currency.code || '')}</span>
                    </div>` : ''}
                </div>
            </div>

            <!-- Key Info Cards -->
            <div class="cfg-info-cards">
                <div class="cfg-info-card">
                    <div class="cfg-info-icon">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
                            <line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/>
                            <line x1="3" y1="10" x2="21" y2="10"/>
                        </svg>
                    </div>
                    <div class="cfg-info-content">
                        <span class="cfg-info-label">Effective Period</span>
                        <span class="cfg-info-value">${formatDate(effectiveFrom) || '-'}</span>
                        <span class="cfg-info-sub">${effectiveTo ? `to ${formatDate(effectiveTo)}` : 'Currently Active'}</span>
                    </div>
                </div>

                <div class="cfg-info-card">
                    <div class="cfg-info-icon">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <circle cx="12" cy="12" r="10"/>
                            <polyline points="12 6 12 12 16 14"/>
                        </svg>
                    </div>
                    <div class="cfg-info-content">
                        <span class="cfg-info-label">Fiscal Year</span>
                        <span class="cfg-info-value">${fiscalYear ? getMonthName(fiscalYear.start_month) : '-'}</span>
                        <span class="cfg-info-sub">${fiscalYear ? `Starts ${fiscalYear.start_day || 1}` : 'Not configured'}</span>
                    </div>
                </div>

                <div class="cfg-info-card">
                    <div class="cfg-info-icon">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M12 2L2 7l10 5 10-5-10-5z"/>
                            <path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/>
                        </svg>
                    </div>
                    <div class="cfg-info-content">
                        <span class="cfg-info-label">Configuration</span>
                        <span class="cfg-info-value">${highlights.length} Sections</span>
                        <span class="cfg-info-sub">Fully configured</span>
                    </div>
                </div>
            </div>

            <!-- Configuration Highlights -->
            ${highlights.length > 0 ? `
            <div class="cfg-highlights-section">
                <h4 class="cfg-section-title">Configuration Highlights</h4>
                <div class="cfg-highlights-grid">
                    ${highlights.map(h => `
                        <div class="cfg-highlight-card">
                            <span class="cfg-highlight-icon">${h.icon}</span>
                            <div class="cfg-highlight-content">
                                <span class="cfg-highlight-label">${h.label}</span>
                                <span class="cfg-highlight-desc">${h.desc}</span>
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>` : ''}

            <!-- Compliance Categories -->
            ${complianceCategories.length > 0 ? `
            <div class="cfg-categories-section">
                <h4 class="cfg-section-title">Statutory Compliance Categories</h4>
                <div class="cfg-categories-list">
                    ${complianceCategories.map(cat => `<span class="cfg-category-tag">${escapeHtml(cat)}</span>`).join('')}
                </div>
            </div>` : ''}

            <!-- Quick Summary -->
            <div class="cfg-summary-section">
                <h4 class="cfg-section-title">Quick Summary</h4>
                <p class="cfg-summary-text">
                    This configuration contains statutory compliance rules for <strong>${escapeHtml(countryName)}</strong>,
                    effective from <strong>${formatDate(effectiveFrom) || 'N/A'}</strong>.
                    ${jurisdictionCount > 0 ? ` It includes <strong>${jurisdictionCount}</strong> jurisdiction-specific rules` : ''}
                    ${stateCount > 0 ? ` across <strong>${stateCount}</strong> states/regions` : ''}.
                    ${taxRegimeCount > 0 ? ` <strong>${taxRegimeCount}</strong> tax regime${taxRegimeCount !== 1 ? 's are' : ' is'} configured for income tax calculations.` : ''}
                </p>
            </div>
        </div>
    `;
}

// Helper to get country flag emoji
function getCountryFlag(countryCode) {
    if (!countryCode || countryCode.length !== 2) return '🌐';
    const codePoints = countryCode
        .toUpperCase()
        .split('')
        .map(char => 127397 + char.charCodeAt(0));
    return String.fromCodePoint(...codePoints);
}

function renderCountrySection(country) {
    if (!country) return '<div class="cfg-empty">No country data</div>';

    const countryCode = country.code || '';
    const countryName = country.name || 'Unknown';
    const currencySymbol = country.currency?.symbol || '';
    const currencyCode = country.currency?.code || '';
    const fiscalMonth = getMonthName(country.fiscal_year?.start_month);
    const fiscalDay = country.fiscal_year?.start_day || 1;

    return `
        <div class="cfg-country-v2">
            <!-- Country Hero -->
            <div class="cfg-country-hero">
                <div class="cfg-country-flag">${getCountryFlag(countryCode)}</div>
                <div class="cfg-country-details">
                    <h2 class="cfg-country-name">${escapeHtml(countryName)}</h2>
                    <span class="cfg-country-code-badge">${escapeHtml(countryCode)}</span>
                </div>
            </div>

            <!-- Info Cards Grid -->
            <div class="cfg-country-cards">
                <!-- Currency Card -->
                <div class="cfg-country-card">
                    <div class="cfg-country-card-icon">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <circle cx="12" cy="12" r="10"/>
                            <path d="M12 6v12M9 9h6M9 15h6"/>
                        </svg>
                    </div>
                    <div class="cfg-country-card-content">
                        <span class="cfg-country-card-label">Currency</span>
                        <div class="cfg-country-card-value">
                            <span class="cfg-currency-large">${escapeHtml(currencySymbol)}</span>
                            <span class="cfg-currency-code">${escapeHtml(currencyCode)}</span>
                        </div>
                        ${country.currency?.decimal_places !== undefined ? `
                        <span class="cfg-country-card-sub">${country.currency.decimal_places} decimal places</span>
                        ` : ''}
                    </div>
                </div>

                <!-- Fiscal Year Card -->
                <div class="cfg-country-card">
                    <div class="cfg-country-card-icon">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
                            <line x1="16" y1="2" x2="16" y2="6"/>
                            <line x1="8" y1="2" x2="8" y2="6"/>
                            <line x1="3" y1="10" x2="21" y2="10"/>
                        </svg>
                    </div>
                    <div class="cfg-country-card-content">
                        <span class="cfg-country-card-label">Fiscal Year</span>
                        <div class="cfg-country-card-value">
                            <span class="cfg-fiscal-month">${fiscalMonth}</span>
                        </div>
                        <span class="cfg-country-card-sub">Starts on day ${fiscalDay}</span>
                    </div>
                </div>

                <!-- Region Card -->
                <div class="cfg-country-card">
                    <div class="cfg-country-card-icon">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <circle cx="12" cy="10" r="3"/>
                            <path d="M12 21.7C17.3 17 20 13 20 10a8 8 0 1 0-16 0c0 3 2.7 7 8 11.7z"/>
                        </svg>
                    </div>
                    <div class="cfg-country-card-content">
                        <span class="cfg-country-card-label">Region</span>
                        <div class="cfg-country-card-value">
                            <span class="cfg-region-name">${getRegionFromCountry(countryCode)}</span>
                        </div>
                        <span class="cfg-country-card-sub">ISO 3166-1 alpha-2</span>
                    </div>
                </div>
            </div>
        </div>
    `;
}

function getRegionFromCountry(code) {
    const regions = {
        'IN': 'South Asia',
        'ID': 'Southeast Asia',
        'MV': 'South Asia',
        'US': 'North America',
        'UK': 'Europe',
        'GB': 'Europe',
        'AE': 'Middle East',
        'SG': 'Southeast Asia',
        'AU': 'Oceania'
    };
    return regions[code] || 'International';
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

// Format label: convert snake_case/SCREAMING_SNAKE to Title Case for display
function formatLabel(str) {
    if (!str) return '-';
    return str
        .replace(/_/g, ' ')
        .toLowerCase()
        .replace(/\b\w/g, c => c.toUpperCase());
}

// Generic tax type icons - no country-specific logic, uses category from config or generic icons
function getTaxTypeIcon(category) {
    // Generic icons based on broad categories that work for any country
    const icons = {
        'retirement': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8"/><path d="M12 18V6"/></svg>`,
        'insurance': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/></svg>`,
        'tax': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>`,
        'benefit': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L15 8l7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1 3-6z"/></svg>`,
        'welfare': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`,
        'default': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/><path d="M9 21V9"/></svg>`
    };
    return icons[category] || icons.default;
}

// ==================== Comprehensive Section Renderers (v3.1.0) ====================
// These render EVERY detail from GlobalStatutorySchema for Lawyer/CA/Government viewing

function renderEngineSemanticsSection(engineSemantics) {
    if (!engineSemantics) return '<div class="cfg-empty">No engine semantics configured</div>';

    let html = '<div class="cfg-section">';

    // Engine Version
    html += `<div class="cfg-version-banner">Engine Version: ${escapeHtml(engineSemantics.engine_version || '1.0.0')}</div>`;

    // Condition Logic
    if (engineSemantics.condition_logic) {
        const cl = engineSemantics.condition_logic;
        html += `
        <div class="cfg-subsection">
            <h4>Condition Logic</h4>
            <div class="cfg-engine-grid">
                <div class="cfg-engine-card">
                    <div class="cfg-engine-label">Default Combinator</div>
                    <div class="cfg-engine-value">${escapeHtml(cl.default_combinator || 'AND')}</div>
                </div>
                <div class="cfg-engine-card">
                    <div class="cfg-engine-label">Group Evaluation Order</div>
                    <div class="cfg-engine-value">${formatLabel(cl.group_evaluation_order)}</div>
                </div>
                <div class="cfg-engine-card">
                    <div class="cfg-engine-label">Unknown Dimension Behavior</div>
                    <div class="cfg-engine-value">${formatLabel(cl.unknown_dimension_behavior)}</div>
                </div>
            </div>
            ${cl.evaluation_order ? `<div class="cfg-field"><label>Evaluation Order</label><span>${cl.evaluation_order.map(escapeHtml).join(' → ')}</span></div>` : ''}
        </div>`;
    }

    // Rounding Rules
    if (engineSemantics.rounding_rules) {
        const rr = engineSemantics.rounding_rules;
        html += `
        <div class="cfg-subsection">
            <h4>Rounding Rules</h4>
            <div class="cfg-engine-grid">
                <div class="cfg-engine-card">
                    <div class="cfg-engine-label">Default Method</div>
                    <div class="cfg-engine-value">${formatLabel(rr.default_method)}</div>
                </div>
                <div class="cfg-engine-card">
                    <div class="cfg-engine-label">Currency Precision</div>
                    <div class="cfg-engine-value">${rr.currency_precision ?? 2} decimals</div>
                </div>
                <div class="cfg-engine-card">
                    <div class="cfg-engine-label">Intermediate Precision</div>
                    <div class="cfg-engine-value">${rr.intermediate_precision ?? 4} decimals</div>
                </div>
            </div>
        </div>`;
    }

    // Null Handling
    if (engineSemantics.null_handling) {
        const nh = engineSemantics.null_handling;
        html += `
        <div class="cfg-subsection">
            <h4>Null Handling Behavior</h4>
            <div class="cfg-engine-grid">
                ${Object.entries(nh).map(([key, value]) => `
                    <div class="cfg-engine-card">
                        <div class="cfg-engine-label">${formatLabel(key)}</div>
                        <div class="cfg-engine-value cfg-engine-${value === 'error' ? 'error' : 'ok'}">${formatLabel(value)}</div>
                    </div>
                `).join('')}
            </div>
        </div>`;
    }

    // Conflict Resolution
    if (engineSemantics.conflict_resolution) {
        const cr = engineSemantics.conflict_resolution;
        html += `
        <div class="cfg-subsection">
            <h4>Conflict Resolution</h4>
            <div class="cfg-engine-grid">
                ${Object.entries(cr).map(([key, value]) => `
                    <div class="cfg-engine-card">
                        <div class="cfg-engine-label">${formatLabel(key)}</div>
                        <div class="cfg-engine-value">${formatLabel(value)}</div>
                    </div>
                `).join('')}
            </div>
        </div>`;
    }

    // Negative Value Handling
    if (engineSemantics.negative_value_handling) {
        const nvh = engineSemantics.negative_value_handling;
        html += `
        <div class="cfg-subsection">
            <h4>Negative Value Handling</h4>
            <div class="cfg-engine-grid">
                ${Object.entries(nvh).map(([key, value]) => `
                    <div class="cfg-engine-card">
                        <div class="cfg-engine-label">${formatLabel(key)}</div>
                        <div class="cfg-engine-value">${typeof value === 'boolean' ? (value ? 'Yes' : 'No') : formatLabel(String(value))}</div>
                    </div>
                `).join('')}
            </div>
        </div>`;
    }

    // Formula Governance
    if (engineSemantics.formula_governance) {
        const fg = engineSemantics.formula_governance;
        html += `
        <div class="cfg-subsection">
            <h4>Formula Governance</h4>
            <div class="cfg-field"><label>Validation Mode</label><span class="cfg-badge">${formatLabel(fg.validation_mode)}</span></div>
            <div class="cfg-field"><label>Custom Formula Policy</label><span class="cfg-badge cfg-badge-${fg.custom_formula_policy === 'forbidden' ? 'warn' : 'ok'}">${formatLabel(fg.custom_formula_policy)}</span></div>
            ${fg.registry_behavior ? `
            <div class="cfg-nested-section">
                <h5>Registry Behavior</h5>
                <div class="cfg-engine-grid">
                    <div class="cfg-engine-card">
                        <div class="cfg-engine-label">Require Country Prefix</div>
                        <div class="cfg-engine-value">${fg.registry_behavior.require_country_prefix ? 'Yes' : 'No'}</div>
                    </div>
                    <div class="cfg-engine-card">
                        <div class="cfg-engine-label">Version Pinning</div>
                        <div class="cfg-engine-value">${formatLabel(fg.registry_behavior.version_pinning)}</div>
                    </div>
                    <div class="cfg-engine-card">
                        <div class="cfg-engine-label">Allow Deprecated</div>
                        <div class="cfg-engine-value">${fg.registry_behavior.allow_deprecated_formulas ? 'Yes' : 'No'}</div>
                    </div>
                </div>
            </div>` : ''}
        </div>`;
    }

    html += '</div>';
    return html;
}

function renderEffectivePeriodSection(effectivePeriod) {
    if (!effectivePeriod) return '<div class="cfg-empty">No effective period defined</div>';

    const fromDate = formatDate(effectivePeriod.from);
    const toDate = effectivePeriod.to ? formatDate(effectivePeriod.to) : null;
    const isOngoing = !effectivePeriod.to;

    return `
        <div class="cfg-period-v2">
            <!-- Timeline Visual -->
            <div class="cfg-period-timeline">
                <div class="cfg-period-point cfg-period-start">
                    <div class="cfg-period-dot"></div>
                    <div class="cfg-period-content">
                        <span class="cfg-period-label">Effective From</span>
                        <span class="cfg-period-date">${fromDate || 'Not specified'}</span>
                        <span class="cfg-period-status">Configuration Started</span>
                    </div>
                </div>
                <div class="cfg-period-line ${isOngoing ? 'cfg-period-ongoing' : ''}"></div>
                <div class="cfg-period-point cfg-period-end ${isOngoing ? 'cfg-period-current' : ''}">
                    <div class="cfg-period-dot ${isOngoing ? 'cfg-period-pulse' : ''}"></div>
                    <div class="cfg-period-content">
                        <span class="cfg-period-label">Effective To</span>
                        <span class="cfg-period-date">${toDate || 'Ongoing'}</span>
                        <span class="cfg-period-status">${isOngoing ? 'Currently Active' : 'Configuration Ended'}</span>
                    </div>
                </div>
            </div>

            <!-- Status Banner -->
            <div class="cfg-period-status-banner ${isOngoing ? 'cfg-period-active' : 'cfg-period-ended'}">
                <div class="cfg-period-status-icon">
                    ${isOngoing ? `
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
                        <polyline points="22 4 12 14.01 9 11.01"/>
                    </svg>
                    ` : `
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <circle cx="12" cy="12" r="10"/>
                        <polyline points="12 6 12 12 16 14"/>
                    </svg>
                    `}
                </div>
                <div class="cfg-period-status-text">
                    <span class="cfg-period-status-title">${isOngoing ? 'Active Configuration' : 'Historical Configuration'}</span>
                    <span class="cfg-period-status-desc">${isOngoing ? 'This configuration is currently in effect for payroll calculations' : 'This configuration is no longer active'}</span>
                </div>
            </div>
        </div>
    `;
}

function renderEstablishmentsSection(establishments) {
    if (!establishments?.length) return '<div class="cfg-empty">No establishments configured</div>';

    let html = '<div class="cfg-establishments-v2">';
    html += `
        <div class="cfg-section-header">
            <div class="cfg-section-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
                    <polyline points="9 22 9 12 15 12 15 22"/>
                </svg>
            </div>
            <div class="cfg-section-info">
                <h3>${establishments.length} Establishment${establishments.length > 1 ? 's' : ''} Defined</h3>
                <p>Business entities registered for statutory compliance</p>
            </div>
        </div>
    `;

    html += '<div class="cfg-establishments-grid">';
    establishments.forEach((est, idx) => {
        html += `
        <div class="cfg-est-card-v2">
            <div class="cfg-est-header-v2">
                <div class="cfg-est-badge">${escapeHtml(est.establishment_code)}</div>
                <h4 class="cfg-est-name">${escapeHtml(est.establishment_name)}</h4>
            </div>
            <div class="cfg-est-body-v2">
                <div class="cfg-est-meta">
                    <div class="cfg-est-meta-item">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
                            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                            <circle cx="12" cy="7" r="4"/>
                        </svg>
                        <span>${escapeHtml(est.establishment_id)}</span>
                    </div>
                    <div class="cfg-est-meta-item">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
                            <circle cx="12" cy="10" r="3"/>
                            <path d="M12 21.7C17.3 17 20 13 20 10a8 8 0 1 0-16 0c0 3 2.7 7 8 11.7z"/>
                        </svg>
                        <span>${escapeHtml(est.jurisdiction_code)} (${formatLabel(est.jurisdiction_level)})</span>
                    </div>
                    <div class="cfg-est-meta-item">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
                            <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
                            <line x1="16" y1="2" x2="16" y2="6"/>
                            <line x1="8" y1="2" x2="8" y2="6"/>
                            <line x1="3" y1="10" x2="21" y2="10"/>
                        </svg>
                        <span>${formatDate(est.effective_from) || 'No date'}</span>
                    </div>
                </div>
                ${est.headcount_scope ? `
                <div class="cfg-est-section">
                    <h5 class="cfg-est-section-title">Headcount Scope</h5>
                    <div class="cfg-est-tags">
                        <span class="cfg-est-tag">${formatLabel(est.headcount_scope.counting_method)}</span>
                        <span class="cfg-est-tag ${est.headcount_scope.include_contractors ? 'cfg-tag-yes' : 'cfg-tag-no'}">Contractors: ${est.headcount_scope.include_contractors ? 'Yes' : 'No'}</span>
                        <span class="cfg-est-tag ${est.headcount_scope.include_interns ? 'cfg-tag-yes' : 'cfg-tag-no'}">Interns: ${est.headcount_scope.include_interns ? 'Yes' : 'No'}</span>
                    </div>
                </div>` : ''}
            </div>
        </div>`;
    });
    html += '</div>';

    html += '</div>';
    return html;
}

function renderJurisdictionsListSection(jurisdictions) {
    if (!jurisdictions?.length) return '<div class="cfg-empty">No jurisdictions defined</div>';

    // Group by level
    const byLevel = {};
    jurisdictions.forEach(j => {
        const level = j.level || 'other';
        if (!byLevel[level]) byLevel[level] = [];
        byLevel[level].push(j);
    });

    const levelIcons = {
        'country': '🌍',
        'state': '🏛️',
        'city': '🏙️',
        'district': '📍',
        'zone': '🗺️',
        'other': '📌'
    };

    let html = '<div class="cfg-jurisdictions-v2">';
    html += `
        <div class="cfg-section-header">
            <div class="cfg-section-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <circle cx="12" cy="10" r="3"/>
                    <path d="M12 21.7C17.3 17 20 13 20 10a8 8 0 1 0-16 0c0 3 2.7 7 8 11.7z"/>
                </svg>
            </div>
            <div class="cfg-section-info">
                <h3>${jurisdictions.length} Jurisdiction${jurisdictions.length > 1 ? 's' : ''}</h3>
                <p>Geographic regions with specific statutory rules</p>
            </div>
        </div>
    `;

    Object.entries(byLevel).forEach(([level, items]) => {
        const icon = levelIcons[level] || levelIcons['other'];
        html += `
        <div class="cfg-jurisdiction-group">
            <div class="cfg-jurisdiction-group-header">
                <span class="cfg-jurisdiction-level-icon">${icon}</span>
                <h4>${formatLabel(level)} Level</h4>
                <span class="cfg-jurisdiction-count">${items.length}</span>
            </div>
            <div class="cfg-jurisdiction-grid">
                ${items.map(j => `
                    <div class="cfg-jurisdiction-card-v2">
                        <span class="cfg-jurisdiction-code">${escapeHtml(j.code)}</span>
                        <div class="cfg-jurisdiction-info">
                            <span class="cfg-jurisdiction-name">${escapeHtml(j.name)}</span>
                            ${j.parent_code ? `<span class="cfg-jurisdiction-parent">Parent: ${escapeHtml(j.parent_code)}</span>` : ''}
                        </div>
                    </div>
                `).join('')}
            </div>
        </div>`;
    });

    html += '</div>';
    return html;
}

function renderJurisdictionPrecedenceSection(precedence) {
    if (!precedence) return '<div class="cfg-empty">No jurisdiction precedence rules</div>';

    let html = '<div class="cfg-section">';

    // Hierarchies by Country
    if (precedence.hierarchies_by_country) {
        html += '<div class="cfg-subsection"><h4>Hierarchies by Country</h4>';
        Object.entries(precedence.hierarchies_by_country).forEach(([country, data]) => {
            html += `
            <div class="cfg-precedence-card">
                <div class="cfg-precedence-header">${escapeHtml(country)}</div>
                <div class="cfg-field"><label>Hierarchy</label><span>${data.hierarchy?.map(escapeHtml).join(' → ') || '-'}</span></div>
                <div class="cfg-field"><label>Default Lookup Depth</label><span>${data.default_lookup_depth ?? '-'}</span></div>
            </div>`;
        });
        html += '</div>';
    }

    // Override Rules
    if (precedence.override_rules) {
        html += `
        <div class="cfg-subsection">
            <h4>Override Rules</h4>
            <div class="cfg-engine-grid">
                ${Object.entries(precedence.override_rules).map(([key, value]) => `
                    <div class="cfg-engine-card">
                        <div class="cfg-engine-label">${formatLabel(key)}</div>
                        <div class="cfg-engine-value">${formatLabel(value)}</div>
                    </div>
                `).join('')}
            </div>
        </div>`;
    }

    // Conflict Resolution
    if (precedence.conflict_resolution) {
        html += `
        <div class="cfg-subsection">
            <h4>Conflict Resolution</h4>
            <div class="cfg-engine-grid">
                <div class="cfg-engine-card">
                    <div class="cfg-engine-label">Same Level Conflict</div>
                    <div class="cfg-engine-value">${formatLabel(precedence.conflict_resolution.same_level_conflict)}</div>
                </div>
                <div class="cfg-engine-card">
                    <div class="cfg-engine-label">Missing Parent</div>
                    <div class="cfg-engine-value">${formatLabel(precedence.conflict_resolution.missing_parent)}</div>
                </div>
            </div>
            ${precedence.conflict_resolution.legality_constraints ? `
            <div class="cfg-nested-section">
                <h5>Legality Constraints</h5>
                <div class="cfg-engine-grid">
                    ${Object.entries(precedence.conflict_resolution.legality_constraints).map(([key, value]) => `
                        <div class="cfg-engine-card">
                            <div class="cfg-engine-label">${formatLabel(key)}</div>
                            <div class="cfg-engine-value">${Array.isArray(value) ? value.join(', ') : formatLabel(value)}</div>
                        </div>
                    `).join('')}
                </div>
            </div>` : ''}
        </div>`;
    }

    html += '</div>';
    return html;
}

function renderEligibilityConstraintsSection(constraints) {
    if (!constraints) return '<div class="cfg-empty">No eligibility constraints defined</div>';

    let html = '<div class="cfg-section">';

    // Global settings
    html += `
    <div class="cfg-subsection">
        <h4>Global Constraint Settings</h4>
        <div class="cfg-engine-grid">
            <div class="cfg-engine-card">
                <div class="cfg-engine-label">Forbid Root OR</div>
                <div class="cfg-engine-value">${constraints.forbid_root_or ? 'Yes' : 'No'}</div>
            </div>
            <div class="cfg-engine-card">
                <div class="cfg-engine-label">Max Nesting Depth</div>
                <div class="cfg-engine-value">${constraints.max_nesting_depth ?? 'Unlimited'}</div>
            </div>
            <div class="cfg-engine-card">
                <div class="cfg-engine-label">Validate at Load</div>
                <div class="cfg-engine-value">${constraints.validate_at_load ? 'Yes' : 'No'}</div>
            </div>
            <div class="cfg-engine-card">
                <div class="cfg-engine-label">Violation Behavior</div>
                <div class="cfg-engine-value cfg-engine-${constraints.violation_behavior === 'error' ? 'error' : 'ok'}">${formatLabel(constraints.violation_behavior)}</div>
            </div>
        </div>
    </div>`;

    // Disallowed Dimension Combinations
    if (constraints.disallow_dimension_combinations?.length) {
        html += `
        <div class="cfg-subsection">
            <h4>Disallowed Dimension Combinations</h4>
            <table class="cfg-table">
                <thead><tr><th>Dimension A</th><th>Dimension B</th><th>Reason</th></tr></thead>
                <tbody>
                    ${constraints.disallow_dimension_combinations.map(c => `
                        <tr>
                            <td><span class="cfg-code">${escapeHtml(c.dimension_a)}</span></td>
                            <td><span class="cfg-code">${escapeHtml(c.dimension_b)}</span></td>
                            <td>${escapeHtml(c.reason || '-')}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>`;
    }

    html += '</div>';
    return html;
}

function renderComponentCategoriesSection(categories) {
    if (!categories) return '<div class="cfg-empty">No component categories defined</div>';

    let html = '<div class="cfg-section">';

    // Render each category type
    ['earnings', 'deductions', 'employer_contributions'].forEach(catType => {
        const items = categories[catType];
        if (!items || Object.keys(items).length === 0) return;

        html += `
        <div class="cfg-subsection">
            <h4>${formatLabel(catType)} (${Object.keys(items).length})</h4>
            <div class="cfg-categories-grid">`;

        Object.entries(items).forEach(([code, data]) => {
            html += `
            <div class="cfg-category-card">
                <div class="cfg-category-header">
                    <span class="cfg-category-code">${escapeHtml(code)}</span>
                    ${data.is_system_managed ? '<span class="cfg-badge cfg-badge-system">System Managed</span>' : ''}
                </div>
                <div class="cfg-category-name">${escapeHtml(data.display_name || formatLabel(code))}</div>
                ${data.description ? `<div class="cfg-category-desc">${escapeHtml(data.description)}</div>` : ''}
                ${data.statutory_scheme ? `<div class="cfg-field"><label>Statutory Scheme</label><span class="cfg-badge">${escapeHtml(data.statutory_scheme)}</span></div>` : ''}
                ${data.constraints ? `
                <div class="cfg-category-constraints">
                    ${data.constraints.requires_flag ? `<span class="cfg-constraint">Requires: ${formatLabel(data.constraints.requires_flag)}</span>` : ''}
                    ${data.constraints.max_count ? `<span class="cfg-constraint">Max Count: ${data.constraints.max_count}</span>` : ''}
                </div>` : ''}
                ${data.auto_create ? `
                <details class="cfg-auto-create">
                    <summary>Auto-Create Component</summary>
                    <div class="cfg-auto-create-body">
                        <div class="cfg-field"><label>Code</label><span class="cfg-code">${escapeHtml(data.auto_create.component_code)}</span></div>
                        <div class="cfg-field"><label>Name</label><span>${escapeHtml(data.auto_create.component_name)}</span></div>
                        <div class="cfg-field"><label>Type</label><span>${formatLabel(data.auto_create.component_type)}</span></div>
                        <div class="cfg-field"><label>Calculation</label><span>${formatLabel(data.auto_create.calculation_type)}</span></div>
                        ${data.auto_create.calculation_base ? `<div class="cfg-field"><label>Calc Base</label><span>${formatLabel(data.auto_create.calculation_base)}</span></div>` : ''}
                        ${data.auto_create.default_percentage !== undefined ? `<div class="cfg-field"><label>Default %</label><span>${data.auto_create.default_percentage}%</span></div>` : ''}
                        ${data.auto_create.max_amount !== undefined ? `<div class="cfg-field"><label>Max Amount</label><span>${formatCurrency(data.auto_create.max_amount)}</span></div>` : ''}
                        <div class="cfg-field"><label>Taxable</label><span>${data.auto_create.is_taxable ? 'Yes' : 'No'}</span></div>
                        <div class="cfg-field"><label>Part of CTC</label><span>${data.auto_create.is_part_of_ctc ? 'Yes' : 'No'}</span></div>
                        <div class="cfg-field"><label>Part of Gross</label><span>${data.auto_create.is_part_of_gross ? 'Yes' : 'No'}</span></div>
                    </div>
                </details>` : ''}
            </div>`;
        });

        html += '</div></div>';
    });

    html += '</div>';
    return html;
}

function renderStatutoryRolesSection(roles) {
    if (!roles || Object.keys(roles).length === 0) return '<div class="cfg-empty">No statutory roles defined</div>';

    let html = '<div class="cfg-section">';
    html += `<div class="cfg-count-badge">${Object.keys(roles).length} Statutory Role${Object.keys(roles).length > 1 ? 's' : ''}</div>`;
    html += '<div class="cfg-roles-grid">';

    Object.entries(roles).forEach(([roleCode, roleData]) => {
        html += `
        <div class="cfg-role-card">
            <div class="cfg-role-header">
                <span class="cfg-role-code">${escapeHtml(roleCode)}</span>
                <span class="cfg-role-type">${formatLabel(roleData.role_type)}</span>
            </div>
            <div class="cfg-role-desc">${escapeHtml(roleData.description || '')}</div>
            ${roleData.legal_reference ? `<div class="cfg-legal-ref-inline">Legal: ${escapeHtml(roleData.legal_reference)}</div>` : ''}
            ${roleData.component_mapping ? `
            <div class="cfg-role-mapping">
                <span class="cfg-mapping-method">Method: ${formatLabel(roleData.component_mapping.method)}</span>
                ${roleData.component_mapping.includes ? `<div class="cfg-mapping-list">Includes: ${roleData.component_mapping.includes.map(escapeHtml).join(', ')}</div>` : ''}
                ${roleData.component_mapping.excludes ? `<div class="cfg-mapping-list">Excludes: ${roleData.component_mapping.excludes.map(escapeHtml).join(', ')}</div>` : ''}
                ${roleData.component_mapping.charge_categories ? `<div class="cfg-mapping-list">Categories: ${roleData.component_mapping.charge_categories.map(escapeHtml).join(', ')}</div>` : ''}
            </div>` : ''}
        </div>`;
    });

    html += '</div></div>';
    return html;
}

function renderRequiredRolesSection(requiredRoles) {
    if (!requiredRoles) return '<div class="cfg-empty">No required roles configuration</div>';

    let html = '<div class="cfg-section">';

    // Mandatory Mappings
    if (requiredRoles.mandatory_mappings?.length) {
        html += `
        <div class="cfg-subsection">
            <h4>Mandatory Role Mappings (${requiredRoles.mandatory_mappings.length})</h4>
            <table class="cfg-table">
                <thead><tr><th>Role Code</th><th>Severity</th><th>Min % of Gross</th><th>Max % of Gross</th><th>Enforcement</th></tr></thead>
                <tbody>
                    ${requiredRoles.mandatory_mappings.map(m => `
                        <tr>
                            <td><span class="cfg-code">${escapeHtml(m.role_code)}</span></td>
                            <td><span class="cfg-badge cfg-badge-${m.severity}">${formatLabel(m.severity)}</span></td>
                            <td>${m.role_ratio_constraints?.min_percent_of_gross ?? '-'}%</td>
                            <td>${m.role_ratio_constraints?.max_percent_of_gross ?? '-'}%</td>
                            <td>${formatLabel(m.role_ratio_constraints?.enforcement_mode) || '-'}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>`;
    }

    // Validation Behavior
    if (requiredRoles.validation_behavior) {
        const vb = requiredRoles.validation_behavior;
        html += `
        <div class="cfg-subsection">
            <h4>Validation Behavior</h4>
            <div class="cfg-engine-grid">
                <div class="cfg-engine-card">
                    <div class="cfg-engine-label">When to Validate</div>
                    <div class="cfg-engine-value">${formatLabel(vb.when_to_validate)}</div>
                </div>
            </div>
            ${vb.failure_mode_config ? `
            <div class="cfg-nested-section">
                <h5>Failure Mode Configuration</h5>
                <div class="cfg-engine-grid">
                    ${Object.entries(vb.failure_mode_config).map(([key, value]) => `
                        <div class="cfg-engine-card">
                            <div class="cfg-engine-label">${formatLabel(key)}</div>
                            <div class="cfg-engine-value">${formatLabel(value)}</div>
                        </div>
                    `).join('')}
                </div>
            </div>` : ''}
        </div>`;
    }

    // Global Config
    if (requiredRoles.role_ratio_global_config) {
        const gc = requiredRoles.role_ratio_global_config;
        html += `
        <div class="cfg-subsection">
            <h4>Role Ratio Global Configuration</h4>
            <div class="cfg-engine-grid">
                <div class="cfg-engine-card">
                    <div class="cfg-engine-label">Enable Ratio Validation</div>
                    <div class="cfg-engine-value">${gc.enable_ratio_validation ? 'Yes' : 'No'}</div>
                </div>
                <div class="cfg-engine-card">
                    <div class="cfg-engine-label">Default Enforcement</div>
                    <div class="cfg-engine-value">${formatLabel(gc.default_enforcement_mode)}</div>
                </div>
                <div class="cfg-engine-card">
                    <div class="cfg-engine-label">Gross Definition</div>
                    <div class="cfg-engine-value">${formatLabel(gc.gross_definition)}</div>
                </div>
            </div>
        </div>`;
    }

    html += '</div>';
    return html;
}

// PUBLIC LEGAL VIEW: Shows statutory contributions with legally required info only
// Hides internal enum codes (charge_type, payer, base_type, method) to protect competitive info
// Uses display_name from component_categories for user-friendly labels
function renderStatutoryChargesSection(charges, configData) {
    if (!charges || Object.keys(charges).length === 0) return '<div class="cfg-empty">No statutory charges defined</div>';

    // Build lookup: charge_code -> display_name from component_categories
    const displayNameLookup = buildChargeDisplayNameLookup(configData?.component_categories);

    let html = '<div class="cfg-section">';
    html += `<div class="cfg-count-badge">${Object.keys(charges).length} Statutory Contribution${Object.keys(charges).length > 1 ? 's' : ''}</div>`;
    html += '<div class="cfg-charges-grid cfg-legal-view">';

    Object.entries(charges).forEach(([chargeCode, charge]) => {
        // Get display name from component_categories or fallback to formatted charge code
        const displayName = displayNameLookup[chargeCode] || formatLabel(chargeCode.replace(/_/g, ' '));

        html += `
        <div class="cfg-charge-card cfg-legal-card">
            <div class="cfg-charge-header">
                <span class="cfg-charge-name">${escapeHtml(displayName)}</span>
            </div>

            <div class="cfg-charge-body">
                <!-- Wage Ceiling / Cap (legally required disclosure) -->
                ${charge.calculation?.cap ? `
                <div class="cfg-legal-field">
                    <label>Wage Ceiling</label>
                    <span class="cfg-legal-value">${formatCurrency(charge.calculation.cap.amount)}/month</span>
                </div>` : ''}

                <!-- Eligibility Thresholds (legally required) -->
                ${charge.eligibility?.conditions?.length ? `
                <div class="cfg-legal-section">
                    <label class="cfg-legal-section-label">Applicability</label>
                    <ul class="cfg-legal-list">
                        ${charge.eligibility.conditions.map(c => {
                            const dimensionLabel = getEligibilityDimensionLabel(c.dimension);
                            const valueLabel = Array.isArray(c.value) ? c.value.join(', ') : c.value;
                            const operatorLabel = getOperatorLabel(c.operator);
                            return `<li>${dimensionLabel} ${operatorLabel} ${valueLabel}</li>`;
                        }).join('')}
                    </ul>
                </div>` : ''}

                <!-- Proration Rule (important for employees) -->
                ${charge.period_behavior ? `
                <div class="cfg-legal-field">
                    <label>Partial Month</label>
                    <span class="cfg-legal-value">${charge.period_behavior.proration_allowed ? 'Prorated' : 'Full charge applies'}</span>
                </div>` : ''}

                <!-- Cost Allocation (who pays what - employees need to know) -->
                ${charge.cost_classification ? `
                <div class="cfg-legal-field">
                    <label>Cost Allocation</label>
                    <span class="cfg-legal-value">${getCostAllocationLabel(charge.cost_classification)}</span>
                </div>` : ''}

                <!-- Legal Notes (if available) -->
                ${charge.cost_classification?._comment ? `
                <div class="cfg-legal-note">${escapeHtml(charge.cost_classification._comment)}</div>` : ''}
            </div>
        </div>`;
    });

    html += '</div></div>';
    return html;
}

// Builds charge_code -> display_name lookup from component_categories
function buildChargeDisplayNameLookup(componentCategories) {
    const lookup = {};
    if (!componentCategories) return lookup;

    // Scan all category groups (earnings, deductions, employer_contributions, etc.)
    Object.values(componentCategories).forEach(categoryGroup => {
        if (typeof categoryGroup !== 'object') return;
        Object.values(categoryGroup).forEach(component => {
            if (component.auto_create?.charge_code && component.display_name) {
                lookup[component.auto_create.charge_code] = component.display_name;
            }
        });
    });
    return lookup;
}

// User-friendly labels for eligibility dimensions (no internal codes)
function getEligibilityDimensionLabel(dimension) {
    const labels = {
        'establishment_size': 'Establishment employees',
        'employment_type': 'Employment type',
        'monthly_gross': 'Monthly gross salary',
        'annual_income': 'Annual income',
        'years_of_service': 'Years of service',
        'age': 'Age',
        'is_covered_under_esic': 'ESI coverage',
        'employee_category': 'Employee category'
    };
    return labels[dimension] || formatLabel(dimension);
}

// User-friendly labels for operators
function getOperatorLabel(operator) {
    const labels = {
        '>=': 'at least',
        '<=': 'up to',
        '>': 'more than',
        '<': 'less than',
        '==': 'equals',
        '=': 'equals',
        'in': 'includes',
        'not_in': 'excludes'
    };
    return labels[operator] || operator;
}

// User-friendly cost allocation label
function getCostAllocationLabel(costClass) {
    const empPortion = costClass.employee_portion;
    const empPays = empPortion === 'deduction_from_gross';

    const erPortion = costClass.employer_portion;
    const erPays = erPortion === 'included_in_ctc' || erPortion === 'organizational_overhead';

    if (empPays && erPays) return 'Employee + Employer';
    if (empPays) return 'Employee only';
    if (erPays) return 'Employer only';
    return '-';
}

function getChargeTypeClass(type) {
    const classMap = {
        'retirement': 'retirement',
        'health_insurance': 'health',
        'social_insurance': 'health',
        'regional_tax': 'regional',
        'income_tax': 'income',
        'levy': 'levy',
        'benefit_accrual': 'benefit'
    };
    return classMap[type] || 'other';
}

function getChargeTypeInitial(type) {
    const initialMap = {
        'retirement': 'R',
        'health_insurance': 'H',
        'social_insurance': 'S',
        'regional_tax': 'T',
        'income_tax': 'I',
        'levy': 'L',
        'benefit_accrual': 'B'
    };
    return initialMap[type] || '?';
}

// ==================== Income Tax Regimes Section ====================
// Displays tax regimes (Old/New), slabs, rebates, deductions, surcharges, cess

function renderTaxRegimesSection(configData) {
    const taxRegimes = configData.tax_regimes;
    const deductions = configData.deductions;
    const surcharges = configData.surcharges;
    const cess = configData.cess;

    if (!taxRegimes || Object.keys(taxRegimes).length === 0) {
        return '<div class="cfg-empty">No income tax regime data available</div>';
    }

    let html = '<div class="cfg-section cfg-tax-regimes">';

    // Count total items
    const regimeCount = Object.keys(taxRegimes).length;
    html += `<div class="cfg-count-badge">${regimeCount} Tax Regime${regimeCount > 1 ? 's' : ''}</div>`;

    // Render each tax regime
    html += '<div class="cfg-regimes-grid">';
    for (const [regimeKey, regime] of Object.entries(taxRegimes)) {
        const isDefault = regime.is_default;
        html += `
            <div class="cfg-regime-card ${isDefault ? 'cfg-regime-default' : ''}">
                <div class="cfg-regime-header">
                    <h4>${escapeHtml(regime.regime_name || formatLabel(regimeKey))}</h4>
                    ${isDefault ? '<span class="cfg-badge-default">Default</span>' : ''}
                </div>
                ${regime.description ? `<p class="cfg-regime-desc">${escapeHtml(regime.description)}</p>` : ''}

                <div class="cfg-regime-details">
                    ${regime.standard_deduction ? `
                        <div class="cfg-detail-item">
                            <span class="cfg-detail-label">Standard Deduction</span>
                            <span class="cfg-detail-value">${formatCurrency(regime.standard_deduction)}</span>
                        </div>
                    ` : ''}

                    ${regime.rebate ? renderRebateSection(regime.rebate) : ''}

                    ${regime.slabs && regime.slabs.length > 0 ? renderTaxSlabs(regime.slabs, regime.regime_name) : ''}

                    ${regime.allowed_deductions && regime.allowed_deductions.length > 0 ? `
                        <div class="cfg-detail-section">
                            <h6>Allowed Deductions</h6>
                            <div class="cfg-deduction-tags">
                                ${regime.allowed_deductions.map(d => `<span class="cfg-deduction-tag">${escapeHtml(d)}</span>`).join('')}
                            </div>
                        </div>
                    ` : ''}
                </div>
            </div>
        `;
    }
    html += '</div>';

    // Render Chapter VI-A Deductions if available
    if (deductions && Object.keys(deductions).length > 0) {
        html += renderDeductionsSummary(deductions);
    }

    // Render Surcharges if available
    if (surcharges && Object.keys(surcharges).length > 0) {
        html += renderSurchargesSection(surcharges);
    }

    // Render Cess if available
    if (cess) {
        html += renderCessSection(cess);
    }

    html += '</div>';
    return html;
}

function renderRebateSection(rebate) {
    if (!rebate) return '';

    const eligibility = rebate.eligibility || {};
    const calculation = rebate.rebate_calculation || {};

    return `
        <div class="cfg-detail-section cfg-rebate-section">
            <h6>Tax Rebate ${rebate.legal_section ? `(${escapeHtml(rebate.legal_section)})` : ''}</h6>
            <div class="cfg-rebate-grid">
                ${eligibility.max_taxable_income ? `
                    <div class="cfg-rebate-item">
                        <span class="cfg-label">Eligibility</span>
                        <span class="cfg-value">Income ≤ ${formatCurrency(eligibility.max_taxable_income)}</span>
                    </div>
                ` : ''}
                ${calculation.max_rebate_amount ? `
                    <div class="cfg-rebate-item">
                        <span class="cfg-label">Max Rebate</span>
                        <span class="cfg-value">${formatCurrency(calculation.max_rebate_amount)}</span>
                    </div>
                ` : ''}
                ${eligibility.resident_required ? `
                    <div class="cfg-rebate-item">
                        <span class="cfg-label">Resident Only</span>
                        <span class="cfg-value">Yes</span>
                    </div>
                ` : ''}
            </div>
            ${rebate._comment ? `<p class="cfg-rebate-note">${escapeHtml(rebate._comment)}</p>` : ''}
        </div>
    `;
}

function renderTaxSlabs(slabs, regimeName) {
    if (!slabs || slabs.length === 0) return '';

    return `
        <div class="cfg-detail-section cfg-slabs-section">
            <h6>Tax Slabs</h6>
            <table class="cfg-slabs-table">
                <thead>
                    <tr>
                        <th>From</th>
                        <th>To</th>
                        <th>Rate</th>
                    </tr>
                </thead>
                <tbody>
                    ${slabs.map(slab => `
                        <tr>
                            <td>${formatCurrency(slab.income_from || slab.from || 0)}</td>
                            <td>${slab.income_to === null || slab.to === null ? 'No Limit' : formatCurrency(slab.income_to || slab.to)}</td>
                            <td>${slab.rate_percent || slab.rate || 0}%</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
    `;
}

function renderDeductionsSummary(deductions) {
    if (!deductions || Object.keys(deductions).length === 0) return '';

    let html = `
        <div class="cfg-deductions-summary">
            <h5>Chapter VI-A Deductions</h5>
            <div class="cfg-deductions-grid">
    `;

    for (const [sectionCode, section] of Object.entries(deductions)) {
        const applicableRegimes = section.applicable_regimes || [];
        html += `
            <div class="cfg-deduction-card">
                <div class="cfg-deduction-header">
                    <span class="cfg-section-code">${escapeHtml(sectionCode)}</span>
                    <span class="cfg-section-name">${escapeHtml(section.section_name || section.section_code || sectionCode)}</span>
                </div>
                ${section.description ? `<p class="cfg-deduction-desc">${escapeHtml(section.description)}</p>` : ''}
                ${section.max_limit ? `<div class="cfg-max-limit">Max: ${formatCurrency(section.max_limit)}</div>` : ''}
                <div class="cfg-regime-tags">
                    ${applicableRegimes.map(r => `<span class="cfg-regime-tag cfg-regime-${r.replace('_regime', '')}">${formatLabel(r.replace('_regime', ''))}</span>`).join('')}
                </div>
            </div>
        `;
    }

    html += '</div></div>';
    return html;
}

function renderSurchargesSection(surcharges) {
    if (!surcharges || Object.keys(surcharges).length === 0) return '';

    let html = '<div class="cfg-surcharges-section"><h5>Surcharges</h5>';

    for (const [key, surcharge] of Object.entries(surcharges)) {
        if (surcharge.slabs && surcharge.slabs.length > 0) {
            html += `
                <div class="cfg-surcharge-card">
                    <h6>${formatLabel(key)}</h6>
                    <table class="cfg-slabs-table">
                        <thead>
                            <tr>
                                <th>Income From</th>
                                <th>Income To</th>
                                <th>Rate</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${surcharge.slabs.map(slab => `
                                <tr>
                                    <td>${formatCurrency(slab.income_from || 0)}</td>
                                    <td>${slab.income_to === null ? 'No Limit' : formatCurrency(slab.income_to)}</td>
                                    <td>${slab.rate_percent || 0}%</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            `;
        }
    }

    html += '</div>';
    return html;
}

function renderCessSection(cess) {
    if (!cess) return '';

    // Format applies_to list
    const appliesTo = cess.applies_to
        ? (Array.isArray(cess.applies_to) ? cess.applies_to.map(formatLabel).join(', ') : formatLabel(cess.applies_to))
        : null;

    return `
        <div class="cfg-cess-section">
            <h5>Cess</h5>
            <div class="cfg-cess-card">
                ${cess.name ? `<div class="cfg-cess-name">${escapeHtml(cess.name)}</div>` : ''}
                ${cess.rate_percent !== undefined ? `<div class="cfg-cess-rate">${cess.rate_percent}% on Tax + Surcharge</div>` : ''}
                ${appliesTo ? `<div class="cfg-cess-applies">Applies to: ${appliesTo}</div>` : ''}
            </div>
        </div>
    `;
}

function renderJurisdictionDataSection(jurisdictionData, jurisdictions) {
    if (!jurisdictionData || Object.keys(jurisdictionData).length === 0) {
        return '<div class="cfg-empty">No jurisdiction-specific data</div>';
    }

    // Build jurisdiction name lookup map (code -> name)
    const jurisdictionNameMap = {};
    if (Array.isArray(jurisdictions)) {
        jurisdictions.forEach(j => {
            if (j.code && j.name) {
                jurisdictionNameMap[j.code] = j.name;
            }
        });
    }

    // Group by charge_code (tax type from config)
    const byCharge = {};
    Object.entries(jurisdictionData).forEach(([key, data]) => {
        const charge = data.charge_code || 'Unknown';
        if (!byCharge[charge]) byCharge[charge] = [];
        // Add jurisdiction name to each item
        const jurisdictionName = jurisdictionNameMap[data.jurisdiction_code] || '';
        byCharge[charge].push({ key, ...data, _jurisdictionName: jurisdictionName });
    });

    // Calculate stats
    const totalEntries = Object.keys(jurisdictionData).length;
    const taxTypes = Object.keys(byCharge).length;
    const countryLevel = Object.values(jurisdictionData).filter(d => d.jurisdiction_level === 'country').length;
    const regionalLevel = totalEntries - countryLevel;

    let html = `
    <div class="cfg-regional-tax-v3">
        <!-- Compact Stats -->
        <div class="cfg-tax-stats-bar">
            <div class="cfg-tax-stat-chip">
                <span class="cfg-tax-stat-num">${taxTypes}</span>
                <span class="cfg-tax-stat-text">Tax Types</span>
            </div>
            <div class="cfg-tax-stat-chip">
                <span class="cfg-tax-stat-num">${countryLevel}</span>
                <span class="cfg-tax-stat-text">Country</span>
            </div>
            <div class="cfg-tax-stat-chip">
                <span class="cfg-tax-stat-num">${regionalLevel}</span>
                <span class="cfg-tax-stat-text">Regional</span>
            </div>
        </div>

        <!-- Tax Type Sections -->
        <div class="cfg-tax-sections">`;

    Object.entries(byCharge).forEach(([chargeCode, items], index) => {
        // Separate country-level from regional entries
        const countryItems = items.filter(i => i.jurisdiction_level === 'country');
        const regionalItems = items.filter(i => i.jurisdiction_level !== 'country');
        const hasSlabs = items.some(i => i.slabs?.length > 0);
        const hasOverrides = items.some(i => i.period_overrides || i.eligibility_overrides || i.period_behavior_override);

        html += `
        <div class="cfg-tax-accordion" data-expanded="${index === 0 ? 'true' : 'false'}">
            <div class="cfg-tax-accordion-header" onclick="toggleTaxAccordion(this)">
                <div class="cfg-tax-accordion-left">
                    <div class="cfg-tax-accordion-icon">${getTaxTypeIcon('default')}</div>
                    <div class="cfg-tax-accordion-title">
                        <span class="cfg-tax-name">${escapeHtml(formatLabel(chargeCode))}</span>
                        <span class="cfg-tax-count">${items.length} ${items.length === 1 ? 'entry' : 'entries'}</span>
                    </div>
                </div>
                <div class="cfg-tax-accordion-right">
                    ${hasSlabs ? '<span class="cfg-tax-badge cfg-tax-badge-slabs">Has Slabs</span>' : ''}
                    ${hasOverrides ? '<span class="cfg-tax-badge cfg-tax-badge-overrides">Has Overrides</span>' : ''}
                    <svg class="cfg-tax-accordion-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="6 9 12 15 18 9"/>
                    </svg>
                </div>
            </div>
            <div class="cfg-tax-accordion-content">`;

        // Render country-level items first (usually simpler, flat rates)
        if (countryItems.length > 0) {
            html += `<div class="cfg-tax-level-section">
                <div class="cfg-tax-level-header">
                    <span class="cfg-tax-level-icon">🌐</span>
                    <span class="cfg-tax-level-title">Country Level</span>
                    <span class="cfg-tax-level-count">${countryItems.length}</span>
                </div>
                <div class="cfg-tax-country-cards">`;

            countryItems.forEach(jd => {
                html += renderCountryLevelTaxCard(jd);
            });

            html += `</div></div>`;
        }

        // Render regional items (states, provinces, etc. - usually have slabs)
        if (regionalItems.length > 0) {
            const withSlabs = regionalItems.filter(i => i.slabs?.length > 0).length;

            html += `<div class="cfg-tax-level-section">
                <div class="cfg-tax-level-header">
                    <span class="cfg-tax-level-icon">📍</span>
                    <span class="cfg-tax-level-title">Regional Level</span>
                    <span class="cfg-tax-level-count">${regionalItems.length}</span>
                    ${withSlabs > 0 ? `<span class="cfg-tax-level-info">${withSlabs} with slabs</span>` : ''}
                </div>
                <div class="cfg-tax-list">`;

            regionalItems.forEach(jd => {
                html += renderRegionalTaxCard(jd);
            });

            html += `</div></div>`;
        }

        html += `</div></div>`;
    });

    html += `</div></div>`;
    return html;
}

// Render country-level tax card (simpler, usually flat rates)
function renderCountryLevelTaxCard(jd) {
    const hasRates = jd.employee_rate_percent !== undefined || jd.employer_rate_percent !== undefined || jd.rate_percent !== undefined;

    return `
    <div class="cfg-tax-country-card">
        <div class="cfg-tax-country-card-header">
            <span class="cfg-tax-country-code">${escapeHtml(jd.jurisdiction_code)}</span>
            <span class="cfg-tax-country-level">${escapeHtml(formatLabel(jd.jurisdiction_level))}</span>
        </div>
        <div class="cfg-tax-country-card-body">
            <div class="cfg-tax-meta">
                <span>Effective: ${formatDate(jd.effective_from) || '-'}</span>
            </div>
            ${hasRates ? `
            <div class="cfg-tax-rates">
                ${jd.employee_rate_percent !== undefined ? `
                <div class="cfg-tax-rate-item">
                    <span class="cfg-tax-rate-label">Employee</span>
                    <span class="cfg-tax-rate-value">${jd.employee_rate_percent}%</span>
                </div>` : ''}
                ${jd.employer_rate_percent !== undefined ? `
                <div class="cfg-tax-rate-item">
                    <span class="cfg-tax-rate-label">Employer</span>
                    <span class="cfg-tax-rate-value">${jd.employer_rate_percent}%</span>
                </div>` : ''}
                ${jd.rate_percent !== undefined ? `
                <div class="cfg-tax-rate-item">
                    <span class="cfg-tax-rate-label">Rate</span>
                    <span class="cfg-tax-rate-value">${jd.rate_percent}%</span>
                </div>` : ''}
            </div>` : ''}
            ${jd.eligibility_overrides ? `
            <div class="cfg-tax-overrides-mini">
                ${Object.entries(jd.eligibility_overrides).map(([k, v]) => `
                <span class="cfg-tax-override-tag">${formatLabel(k)}: ${v}</span>
                `).join('')}
            </div>` : ''}
        </div>
    </div>`;
}

// Get rate summary for display in header
function getRateSummary(jd) {
    const parts = [];
    // Percentage rates
    if (jd.employee_rate_percent !== undefined) parts.push(`Emp: ${jd.employee_rate_percent}%`);
    if (jd.employer_rate_percent !== undefined) parts.push(`Empr: ${jd.employer_rate_percent}%`);
    if (jd.rate_percent !== undefined && jd.employee_rate_percent === undefined) parts.push(`${jd.rate_percent}%`);
    // Fixed amounts at top level (no currency symbol - country agnostic)
    if (jd.employee_amount !== undefined) parts.push(`Emp: ${jd.employee_amount}`);
    if (jd.employer_amount !== undefined) parts.push(`Empr: ${jd.employer_amount}`);
    // Nested contribution_amounts (used by various regional taxes)
    if (jd.contribution_amounts) {
        if (jd.contribution_amounts.employee_amount !== undefined) parts.push(`Emp: ${jd.contribution_amounts.employee_amount}`);
        if (jd.contribution_amounts.employer_amount !== undefined) parts.push(`Empr: ${jd.contribution_amounts.employer_amount}`);
    }
    if (jd.fixed_amount !== undefined) parts.push(`Fixed: ${jd.fixed_amount}`);
    // Levy status
    if (jd.levy_status === 'non_levy') parts.push('Non-Levy');
    // Slabs
    if (jd.slabs?.length > 0) parts.push(`${jd.slabs.length} slabs`);
    return parts.join(' | ') || 'View details';
}

// Render regional tax card (states/provinces - may have slabs and overrides)
function renderRegionalTaxCard(jd) {
    const hasSlabs = jd.slabs?.length > 0;
    const hasContributionAmounts = jd.contribution_amounts &&
        (jd.contribution_amounts.employee_amount !== undefined || jd.contribution_amounts.employer_amount !== undefined);
    const hasRates = jd.employee_rate_percent !== undefined || jd.employer_rate_percent !== undefined ||
                     jd.rate_percent !== undefined || jd.fixed_amount !== undefined ||
                     jd.employee_amount !== undefined || jd.employer_amount !== undefined ||
                     hasContributionAmounts;
    const hasOverrides = jd.period_overrides || jd.eligibility_overrides || jd.period_behavior_override;
    const isNonLevy = jd.levy_status === 'non_levy';
    const cardId = `tax-card-${jd.key.replace(/[^a-zA-Z0-9]/g, '-')}`;
    const rateSummary = getRateSummary(jd);
    const jurisdictionName = jd._jurisdictionName || '';

    return `
    <div class="cfg-tax-row" id="${cardId}">
        <div class="cfg-tax-row-header" onclick="toggleRegionalRow('${cardId}')">
            <div class="cfg-tax-row-left">
                <span class="cfg-tax-row-code">${escapeHtml(jd.jurisdiction_code)}</span>
                ${jurisdictionName ? `<span class="cfg-tax-row-name">${escapeHtml(jurisdictionName)}</span>` : ''}
                <span class="cfg-tax-row-summary">${rateSummary}</span>
            </div>
            <div class="cfg-tax-row-right">
                ${hasOverrides ? '<span class="cfg-tax-row-badge override">⚙</span>' : ''}
                ${isNonLevy ? '<span class="cfg-tax-row-badge non-levy">N/A</span>' : ''}
                <svg class="cfg-tax-row-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="6 9 12 15 18 9"/>
                </svg>
            </div>
        </div>
        <div class="cfg-tax-row-content">
            <!-- Non-Levy Status -->
            ${isNonLevy ? `
            <div class="cfg-tax-non-levy-notice">
                This jurisdiction does not levy this tax type.
            </div>` : ''}

            <!-- Rates Section (always show if has rates) -->
            ${hasRates && !isNonLevy ? `
            <div class="cfg-tax-rates-grid">
                ${jd.employee_rate_percent !== undefined ? `
                <div class="cfg-tax-rate-box">
                    <span class="cfg-tax-rate-label">Employee Rate</span>
                    <span class="cfg-tax-rate-value">${jd.employee_rate_percent}%</span>
                </div>` : ''}
                ${jd.employer_rate_percent !== undefined ? `
                <div class="cfg-tax-rate-box">
                    <span class="cfg-tax-rate-label">Employer Rate</span>
                    <span class="cfg-tax-rate-value">${jd.employer_rate_percent}%</span>
                </div>` : ''}
                ${jd.rate_percent !== undefined && jd.employee_rate_percent === undefined ? `
                <div class="cfg-tax-rate-box">
                    <span class="cfg-tax-rate-label">Rate</span>
                    <span class="cfg-tax-rate-value">${jd.rate_percent}%</span>
                </div>` : ''}
                ${jd.employee_amount !== undefined ? `
                <div class="cfg-tax-rate-box">
                    <span class="cfg-tax-rate-label">Employee Amount</span>
                    <span class="cfg-tax-rate-value">${formatCurrency(jd.employee_amount)}</span>
                </div>` : ''}
                ${jd.employer_amount !== undefined ? `
                <div class="cfg-tax-rate-box">
                    <span class="cfg-tax-rate-label">Employer Amount</span>
                    <span class="cfg-tax-rate-value">${formatCurrency(jd.employer_amount)}</span>
                </div>` : ''}
                ${hasContributionAmounts && jd.contribution_amounts.employee_amount !== undefined ? `
                <div class="cfg-tax-rate-box">
                    <span class="cfg-tax-rate-label">Employee Contribution</span>
                    <span class="cfg-tax-rate-value">${formatCurrency(jd.contribution_amounts.employee_amount)}</span>
                </div>` : ''}
                ${hasContributionAmounts && jd.contribution_amounts.employer_amount !== undefined ? `
                <div class="cfg-tax-rate-box">
                    <span class="cfg-tax-rate-label">Employer Contribution</span>
                    <span class="cfg-tax-rate-value">${formatCurrency(jd.contribution_amounts.employer_amount)}</span>
                </div>` : ''}
                ${jd.fixed_amount !== undefined ? `
                <div class="cfg-tax-rate-box">
                    <span class="cfg-tax-rate-label">Fixed Amount</span>
                    <span class="cfg-tax-rate-value">${formatCurrency(jd.fixed_amount)}</span>
                </div>` : ''}
                ${jd.wage_ceiling !== undefined ? `
                <div class="cfg-tax-rate-box">
                    <span class="cfg-tax-rate-label">Wage Ceiling</span>
                    <span class="cfg-tax-rate-value">${formatCurrency(jd.wage_ceiling)}</span>
                </div>` : ''}
            </div>` : ''}

            <!-- Slabs Section -->
            ${hasSlabs ? `
            <div class="cfg-tax-slabs-section">
                <div class="cfg-tax-slabs-title">Tax Slabs (${jd.slabs.length})</div>
                <table class="cfg-tax-slabs-tbl">
                    <thead>
                        <tr><th>From</th><th>To</th><th>Amount</th><th>Rate</th></tr>
                    </thead>
                    <tbody>
                        ${jd.slabs.map(s => `
                        <tr>
                            <td>${s.from?.toLocaleString() || '0'}</td>
                            <td>${s.to !== null && s.to !== undefined ? s.to.toLocaleString() : '∞'}</td>
                            <td>${s.fixed_amount !== undefined ? formatCurrency(s.fixed_amount) : '-'}</td>
                            <td>${s.rate_percent !== undefined ? s.rate_percent + '%' : '-'}</td>
                        </tr>`).join('')}
                    </tbody>
                </table>
            </div>` : ''}

            <!-- Overrides Section -->
            ${jd.period_overrides ? `
            <div class="cfg-tax-override-box">
                <div class="cfg-tax-override-header">Period Overrides</div>
                ${jd.period_overrides.applicable_months ? `
                <div class="cfg-tax-override-row">
                    <span>Applicable Months:</span>
                    <strong>${jd.period_overrides.applicable_months.map(m => getMonthName(m)).join(', ')}</strong>
                </div>` : ''}
                ${jd.period_overrides.special_month_amount !== undefined ? `
                <div class="cfg-tax-override-row">
                    <span>Special Month Amount:</span>
                    <strong>${formatCurrency(jd.period_overrides.special_month_amount)}</strong>
                </div>` : ''}
            </div>` : ''}

            ${jd.eligibility_overrides ? `
            <div class="cfg-tax-override-box">
                <div class="cfg-tax-override-header">Eligibility</div>
                ${Object.entries(jd.eligibility_overrides).map(([k, v]) => `
                <div class="cfg-tax-override-row">
                    <span>${formatLabel(k)}:</span>
                    <strong>${typeof v === 'boolean' ? (v ? 'Yes' : 'No') : v}</strong>
                </div>`).join('')}
            </div>` : ''}

            <!-- Meta info -->
            <div class="cfg-tax-row-meta">
                <span>Country: ${escapeHtml(jd.country_code)}</span>
                <span>Effective: ${formatDate(jd.effective_from) || '-'}</span>
            </div>
        </div>
    </div>`;
}

// Toggle tax type accordion
function toggleTaxAccordion(header) {
    const accordion = header.closest('.cfg-tax-accordion');
    const isExpanded = accordion.dataset.expanded === 'true';
    accordion.dataset.expanded = isExpanded ? 'false' : 'true';
}

// Toggle regional row - only one can be open at a time within its section
function toggleRegionalRow(rowId) {
    const row = document.getElementById(rowId);
    if (!row) return;

    const isExpanded = row.classList.contains('expanded');

    // Close all other rows in the same section
    const section = row.closest('.cfg-tax-list');
    if (section) {
        section.querySelectorAll('.cfg-tax-row.expanded').forEach(r => {
            if (r.id !== rowId) r.classList.remove('expanded');
        });
    }

    // Toggle current row
    row.classList.toggle('expanded', !isExpanded);
}

function renderJurisdictionBindingsSection(bindings) {
    if (!bindings || Object.keys(bindings).length === 0) {
        return '<div class="cfg-empty">No jurisdiction bindings configured</div>';
    }

    let html = '<div class="cfg-section">';
    html += `<div class="cfg-count-badge">${Object.keys(bindings).length} Jurisdiction Binding${Object.keys(bindings).length > 1 ? 's' : ''}</div>`;

    html += '<div class="cfg-bindings-grid">';
    Object.entries(bindings).forEach(([key, data]) => {
        html += `
        <div class="cfg-binding-card">
            <div class="cfg-binding-header">${escapeHtml(key)}</div>
            <div class="cfg-binding-body">
                ${renderObjectAsFields(data, 0)}
            </div>
        </div>`;
    });
    html += '</div></div>';

    return html;
}

function renderDeductionOrderSection(deductionOrder) {
    if (!deductionOrder?.length) return '<div class="cfg-empty">No deduction order defined</div>';

    let html = '<div class="cfg-section">';
    html += `<div class="cfg-count-badge">${deductionOrder.length} Deduction${deductionOrder.length > 1 ? 's' : ''} in Order</div>`;

    html += '<div class="cfg-deduction-order">';
    deductionOrder.forEach((item, idx) => {
        const code = typeof item === 'string' ? item : (item.charge_code || item.code || 'Unknown');
        html += `
        <div class="cfg-deduction-item">
            <span class="cfg-deduction-order-num">${idx + 1}</span>
            <span class="cfg-deduction-code">${escapeHtml(code)}</span>
        </div>
        ${idx < deductionOrder.length - 1 ? '<div class="cfg-deduction-arrow">↓</div>' : ''}`;
    });
    html += '</div></div>';

    return html;
}

function renderAccumulationModelsSection(models) {
    if (!models || Object.keys(models).length === 0) {
        return '<div class="cfg-empty">No accumulation models defined</div>';
    }

    let html = '<div class="cfg-section">';
    html += `<div class="cfg-count-badge">${Object.keys(models).length} Accumulation Model${Object.keys(models).length > 1 ? 's' : ''}</div>`;

    html += '<div class="cfg-accumulation-grid">';
    Object.entries(models).forEach(([key, data]) => {
        html += `
        <div class="cfg-accumulation-card">
            <div class="cfg-accumulation-header">${escapeHtml(key)}</div>
            <div class="cfg-accumulation-body">
                ${renderObjectAsFields(data, 0)}
            </div>
        </div>`;
    });
    html += '</div></div>';

    return html;
}

function renderReportingSection(reporting) {
    if (!reporting) return '<div class="cfg-empty">No reporting configuration</div>';

    let html = '<div class="cfg-section">';
    html += renderObjectAsFields(reporting, 0);
    html += '</div>';
    return html;
}

function renderBuiltinFormulasSection(formulas) {
    if (!formulas?.length) return '<div class="cfg-empty">No built-in formulas defined</div>';

    let html = '<div class="cfg-section">';
    html += `<div class="cfg-count-badge">${formulas.length} Built-in Formula${formulas.length > 1 ? 's' : ''}</div>`;
    html += '<div class="cfg-formulas-grid">';

    formulas.forEach(formula => {
        html += `
        <div class="cfg-formula-card">
            <div class="cfg-formula-header">
                <span class="cfg-formula-id">${escapeHtml(formula.formula_id)}</span>
                <span class="cfg-formula-type">${formatLabel(formula.formula_type)}</span>
            </div>
            <div class="cfg-formula-desc">${escapeHtml(formula.description || '')}</div>

            ${formula.expression ? `<div class="cfg-formula-expression"><code>${escapeHtml(formula.expression)}</code></div>` : ''}

            ${formula.required_params?.length ? `
            <div class="cfg-formula-params">
                <h6>Required Parameters</h6>
                <div class="cfg-params-list">
                    ${formula.required_params.map(p => `<span class="cfg-param">${escapeHtml(p)}</span>`).join('')}
                </div>
            </div>` : ''}

            <!-- Legal Reference - CRITICAL for audit -->
            ${formula.legal_reference ? `
            <div class="cfg-legal-reference">
                <h6>Legal Reference</h6>
                <div class="cfg-legal-body">
                    <div class="cfg-field"><label>Primary Act</label><span class="cfg-legal-act">${escapeHtml(formula.legal_reference.primary_act)}</span></div>
                    ${formula.legal_reference.section ? `<div class="cfg-field"><label>Section</label><span>${escapeHtml(formula.legal_reference.section)}</span></div>` : ''}
                    ${formula.legal_reference.amendment ? `<div class="cfg-field"><label>Amendment</label><span>${escapeHtml(formula.legal_reference.amendment)}</span></div>` : ''}
                    ${formula.legal_reference.circular ? `<div class="cfg-field"><label>Circular</label><span class="cfg-legal-circular">${escapeHtml(formula.legal_reference.circular)}</span></div>` : ''}
                    ${formula.legal_reference.effective_from ? `<div class="cfg-field"><label>Effective From</label><span>${formatDate(formula.legal_reference.effective_from)}</span></div>` : ''}
                    ${formula.legal_reference.notes ? `<div class="cfg-legal-notes">${escapeHtml(formula.legal_reference.notes)}</div>` : ''}
                </div>
            </div>` : ''}
        </div>`;
    });

    html += '</div></div>';
    return html;
}

// Legal References Only - PUBLIC view (hides formula IDs, expressions, internal codes)
// COUNTRY-AGNOSTIC: Uses description from config, never hardcodes country-specific values
function renderLegalReferencesOnlySection(formulas) {
    if (!formulas?.length) return '<div class="cfg-empty">No legal references available</div>';

    // Filter to only formulas with legal references
    const formulasWithLegalRefs = formulas.filter(f => f.legal_reference);
    if (!formulasWithLegalRefs.length) return '<div class="cfg-empty">No legal references available</div>';

    let html = '<div class="cfg-section">';
    html += `<div class="cfg-count-badge">${formulasWithLegalRefs.length} Legal Reference${formulasWithLegalRefs.length > 1 ? 's' : ''}</div>`;
    html += '<div class="cfg-legal-refs-grid">';

    formulasWithLegalRefs.forEach(formula => {
        const ref = formula.legal_reference;
        // Use description from config - NO hardcoded country-specific mappings
        const displayName = formula.description || formatLabel(formula.formula_type || 'Statutory Contribution');

        html += `
        <div class="cfg-legal-ref-card">
            <div class="cfg-legal-ref-header">
                <span class="cfg-legal-ref-name">${escapeHtml(displayName)}</span>
            </div>
            <div class="cfg-legal-body">
                <div class="cfg-field"><label>Primary Act</label><span class="cfg-legal-act">${escapeHtml(ref.primary_act)}</span></div>
                ${ref.section ? `<div class="cfg-field"><label>Section</label><span>${escapeHtml(ref.section)}</span></div>` : ''}
                ${ref.amendment ? `<div class="cfg-field"><label>Amendment</label><span>${escapeHtml(ref.amendment)}</span></div>` : ''}
                ${ref.circular ? `<div class="cfg-field"><label>Circular/Notification</label><span class="cfg-legal-circular">${escapeHtml(ref.circular)}</span></div>` : ''}
                ${ref.effective_from ? `<div class="cfg-field"><label>Effective From</label><span>${formatDate(ref.effective_from)}</span></div>` : ''}
                ${ref.notes ? `<div class="cfg-legal-notes">${escapeHtml(ref.notes)}</div>` : ''}
            </div>
        </div>`;
    });

    html += '</div></div>';
    return html;
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

// ==================== Schema-Driven Statutory Registrations (v3.3.4) ====================
// v3.3.4: Multi-office support for state/establishment level registrations

let selectedCountryCode = null;
let currentRegistrationRequirements = null;
let currentSavedRegistrations = {};  // national-level registrations
let countryOffices = [];             // offices for selected country
let officeRegistrations = {};        // office_id -> { key: value } mapping
let selectedOfficeId = null;         // currently selected office for editing
let officeSelectorDropdown = null;   // SearchableDropdown instance for office selector

/**
 * Switch to the Country Configs tab
 */
function switchToConfigsTab() {
    const configsBtn = document.getElementById('countryConfigsBtn');
    if (configsBtn) {
        configsBtn.click();
    }
}

/**
 * Render country tabs for each uploaded country configuration
 * Users can click a tab to manage that country's statutory registrations
 */
function renderCountryTabs() {
    const tabsContainer = document.getElementById('countryTabs');
    const noConfigsMessage = document.getElementById('noConfigsMessage');
    const registrationForm = document.getElementById('countryRegistrationForm');

    if (!tabsContainer) return;

    // Clear existing tabs (but keep the no-configs message)
    const existingTabs = tabsContainer.querySelectorAll('.country-tab');
    existingTabs.forEach(tab => tab.remove());

    if (!countryConfigs || countryConfigs.length === 0) {
        if (noConfigsMessage) noConfigsMessage.style.display = 'flex';
        if (registrationForm) registrationForm.style.display = 'none';
        return;
    }

    // Hide no-configs message
    if (noConfigsMessage) noConfigsMessage.style.display = 'none';

    // Get unique countries from configs
    const countries = [];
    const seenCodes = new Set();
    countryConfigs.forEach(config => {
        const code = config.countryCode || config.country_code;
        const name = config.countryName || config.country_name;
        if (code && !seenCodes.has(code)) {
            seenCodes.add(code);
            countries.push({ code, name });
        }
    });

    // Render tabs for each country
    countries.forEach((country, index) => {
        const tab = document.createElement('button');
        tab.type = 'button';
        tab.className = 'country-tab';
        tab.dataset.countryCode = country.code;
        tab.innerHTML = `
            <span class="country-flag">${getCountryFlag(country.code)}</span>
            <span class="country-name">${escapeHtml(country.name || country.code)}</span>
        `;
        tab.onclick = () => selectCountryTab(country.code);

        // Insert before no-configs message
        tabsContainer.insertBefore(tab, noConfigsMessage);
    });

    // Auto-select first country if none selected
    if (countries.length > 0 && !selectedCountryCode) {
        selectCountryTab(countries[0].code);
    } else if (selectedCountryCode) {
        // Re-select current country (refresh scenario)
        selectCountryTab(selectedCountryCode);
    }
}

/**
 * Select a country tab and load its registration requirements
 */
async function selectCountryTab(countryCode) {
    // Update tab selection
    const tabs = document.querySelectorAll('.country-tab');
    tabs.forEach(tab => {
        tab.classList.toggle('active', tab.dataset.countryCode === countryCode);
    });

    selectedCountryCode = countryCode;
    selectedOfficeId = null;  // Reset office selection

    // Show registration form container
    const registrationForm = document.getElementById('countryRegistrationForm');
    if (registrationForm) registrationForm.style.display = 'block';

    // Update header
    const flagSpan = document.getElementById('selectedCountryFlag');
    const nameSpan = document.getElementById('selectedCountryName');
    const config = countryConfigs.find(c => (c.countryCode || c.country_code) === countryCode);

    if (flagSpan) flagSpan.textContent = getCountryFlag(countryCode);
    if (nameSpan) nameSpan.textContent = config?.countryName || config?.country_name || countryCode;

    // Load requirements, offices, and saved values
    try {
        showLoading();
        await Promise.all([
            loadRegistrationRequirements(countryCode),
            loadOfficesForCountry(countryCode),
            loadAllRegistrations(countryCode)
        ]);
        renderDynamicFields(currentRegistrationRequirements, currentSavedRegistrations);
        hideLoading();
    } catch (error) {
        console.error('Error loading registration data:', error);
        showToast('Failed to load registration requirements', 'error');
        hideLoading();
    }
}

/**
 * Load offices for the selected country
 * Filters all tenant offices by country_code
 */
async function loadOfficesForCountry(countryCode) {
    try {
        const response = await api.request('/hrms/offices');
        const allOffices = response.offices || response || [];

        // Filter offices by country code (case-insensitive)
        countryOffices = allOffices.filter(office => {
            const officeCountry = office.country_code || office.countryCode;
            return officeCountry && officeCountry.toUpperCase() === countryCode.toUpperCase();
        });

        // Also include offices with matching country_id if available
        if (countryOffices.length === 0) {
            const country = await getCountryByCode(countryCode);
            if (country && country.id) {
                countryOffices = allOffices.filter(office => office.country_id === country.id);
            }
        }

        return countryOffices;
    } catch (error) {
        console.error('Error loading offices:', error);
        countryOffices = [];
        return [];
    }
}

/**
 * Get country by code (helper function)
 */
async function getCountryByCode(countryCode) {
    try {
        const response = await api.request(`/hrms/countries/code/${countryCode}`);
        return response.country || response;
    } catch (error) {
        return null;
    }
}

/**
 * Load ALL registrations - national and per-office
 * Organizes them into currentSavedRegistrations (national) and officeRegistrations (per-office)
 */
async function loadAllRegistrations(countryCode) {
    try {
        const response = await api.request(`/hrms/statutory/registrations/${countryCode}`);
        const registrations = response.registrations || [];

        // Reset storage
        currentSavedRegistrations = {};
        officeRegistrations = {};

        registrations.forEach(reg => {
            const values = reg.values || {};

            if (reg.is_national || !reg.office_id) {
                // National-level registration
                currentSavedRegistrations = { ...currentSavedRegistrations, ...values };
            } else {
                // Office-level registration
                officeRegistrations[reg.office_id] = values;
            }
        });

        return { national: currentSavedRegistrations, offices: officeRegistrations };
    } catch (error) {
        if (error.status !== 404) {
            console.error('Error loading registrations:', error);
        }
        currentSavedRegistrations = {};
        officeRegistrations = {};
        return { national: {}, offices: {} };
    }
}

/**
 * Load registration requirements from the country's schema
 * API: GET /api/statutory/registrations/{countryCode}/requirements
 */
async function loadRegistrationRequirements(countryCode) {
    try {
        const response = await api.request(`/hrms/statutory/registrations/${countryCode}/requirements`);
        currentRegistrationRequirements = response.requirements || response;
        return currentRegistrationRequirements;
    } catch (error) {
        console.error('Error loading registration requirements:', error);
        currentRegistrationRequirements = null;
        throw error;
    }
}

/**
 * Load saved registrations for the country (kept for backward compatibility)
 * Now delegates to loadAllRegistrations
 */
async function loadSavedRegistrations(countryCode) {
    const result = await loadAllRegistrations(countryCode);
    return result.national;
}

/**
 * Render dynamic form fields based on the schema requirements
 * v3.3.4: National fields in single form, establishment/state fields per-office
 */
function renderDynamicFields(requirements, savedValues) {
    const fieldsContainer = document.getElementById('dynamicRegistrationFields');
    if (!fieldsContainer) return;

    fieldsContainer.innerHTML = '';

    if (!requirements || Object.keys(requirements).length === 0) {
        fieldsContainer.innerHTML = `
            <div class="no-requirements-message">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                    <polyline points="14 2 14 8 20 8"></polyline>
                    <line x1="16" y1="13" x2="8" y2="13"></line>
                    <line x1="16" y1="17" x2="8" y2="17"></line>
                </svg>
                <p>No registration requirements defined for this country.</p>
                <p class="text-muted">The country configuration does not specify any employer registration requirements.</p>
            </div>
        `;
        return;
    }

    // Group fields by jurisdiction level
    const nationalFields = [];
    const establishmentFields = [];
    const stateFields = [];

    Object.entries(requirements).forEach(([key, req]) => {
        const level = req.jurisdiction_level || 'national';
        const fieldData = { key, ...req };

        if (level === 'establishment') {
            establishmentFields.push(fieldData);
        } else if (level === 'state') {
            stateFields.push(fieldData);
        } else {
            nationalFields.push(fieldData);
        }
    });

    // Render national section (single form, no office selector)
    if (nationalFields.length > 0) {
        const section = createFieldSection('National Registrations', nationalFields, savedValues, null);
        fieldsContainer.appendChild(section);
    }

    // Render establishment/state sections with office selector
    const officeFields = [...establishmentFields, ...stateFields];
    if (officeFields.length > 0) {
        const officeSection = createOfficeRegistrationsSection(establishmentFields, stateFields);
        fieldsContainer.appendChild(officeSection);
    }
}

/**
 * Create the office registrations section with office selector
 * Each office in the country has its own set of state/establishment registrations
 */
function createOfficeRegistrationsSection(establishmentFields, stateFields) {
    const section = document.createElement('div');
    section.className = 'form-section office-registrations-section';

    const hasOffices = countryOffices && countryOffices.length > 0;

    // Build office selector container (will be populated with SearchableDropdown)
    let officeSelectorHtml = '';
    if (hasOffices) {
        officeSelectorHtml = `
            <div class="office-selector-container">
                <label for="officeSelector">Select Office</label>
                <div id="officeSelectorContainer" class="searchable-dropdown-wrapper"></div>
                <small class="form-text text-muted">
                    State-level and establishment registrations are stored per office. Select an office to configure its registrations.
                </small>
            </div>
        `;
    } else {
        officeSelectorHtml = `
            <div class="no-offices-message">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                    <path d="M3 21h18"></path>
                    <path d="M9 8h1"></path><path d="M9 12h1"></path><path d="M9 16h1"></path>
                    <path d="M14 8h1"></path><path d="M14 12h1"></path><path d="M14 16h1"></path>
                    <path d="M5 21V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16"></path>
                </svg>
                <p>No offices configured for this country.</p>
                <p class="text-muted">Create offices in Organization → Offices first, then configure their registrations here.</p>
            </div>
        `;
    }

    section.innerHTML = `
        <h3>Office-Level Registrations</h3>
        <p class="section-description">
            Each office requires its own state-level registrations (GSTIN, PT, LWF) and establishment registrations (PF, ESI).
        </p>
        ${officeSelectorHtml}
        <div id="officeRegistrationFields" class="office-fields-container" style="display: none;">
            <!-- Fields will be rendered when office is selected -->
        </div>
    `;

    // Initialize SearchableDropdown after section is added to DOM
    if (hasOffices) {
        // Use setTimeout to ensure DOM is ready
        setTimeout(() => initializeOfficeSelectorDropdown(), 0);
    }

    return section;
}

/**
 * Initialize the SearchableDropdown for office selection
 */
function initializeOfficeSelectorDropdown() {
    const container = document.getElementById('officeSelectorContainer');
    if (!container) return;

    // Destroy previous instance if exists
    if (officeSelectorDropdown) {
        officeSelectorDropdown.destroy();
        officeSelectorDropdown = null;
    }

    // Build options from countryOffices
    const options = countryOffices.map(office => {
        const officeName = office.office_name || office.name;
        const officeCode = office.office_code || office.code;
        const stateName = office.state_name || office.state_code || '';
        const label = stateName ? `${officeName} (${officeCode}) - ${stateName}` : `${officeName} (${officeCode})`;
        const hasSaved = officeRegistrations[office.id] && Object.keys(officeRegistrations[office.id]).length > 0;
        return {
            value: office.id,
            label: hasSaved ? `${label} ✓` : label,
            description: hasSaved ? 'Registrations saved' : ''
        };
    });

    // Create SearchableDropdown
    officeSelectorDropdown = new SearchableDropdown(container, {
        id: 'officeSelector',
        options: options,
        placeholder: '-- Select an office --',
        searchPlaceholder: 'Search offices...',
        onChange: (value, option) => {
            selectOfficeForRegistrations(value);
        }
    });
}

/**
 * Update office selector dropdown options (e.g., after saving to show checkmark)
 */
function updateOfficeSelectorOptions() {
    if (!officeSelectorDropdown) return;

    const options = countryOffices.map(office => {
        const officeName = office.office_name || office.name;
        const officeCode = office.office_code || office.code;
        const stateName = office.state_name || office.state_code || '';
        const label = stateName ? `${officeName} (${officeCode}) - ${stateName}` : `${officeName} (${officeCode})`;
        const hasSaved = officeRegistrations[office.id] && Object.keys(officeRegistrations[office.id]).length > 0;
        return {
            value: office.id,
            label: hasSaved ? `${label} ✓` : label,
            description: hasSaved ? 'Registrations saved' : ''
        };
    });

    officeSelectorDropdown.setOptions(options, true);
}

/**
 * Handle office selection for registrations
 */
function selectOfficeForRegistrations(officeId) {
    selectedOfficeId = officeId || null;

    const fieldsContainer = document.getElementById('officeRegistrationFields');
    if (!fieldsContainer) return;

    if (!officeId) {
        fieldsContainer.style.display = 'none';
        fieldsContainer.innerHTML = '';
        return;
    }

    // Get saved values for this office
    const officeSavedValues = officeRegistrations[officeId] || {};

    // Get establishment and state fields from requirements
    const establishmentFields = [];
    const stateFields = [];

    if (currentRegistrationRequirements) {
        Object.entries(currentRegistrationRequirements).forEach(([key, req]) => {
            const level = req.jurisdiction_level || 'national';
            const fieldData = { key, ...req };

            if (level === 'establishment') {
                establishmentFields.push(fieldData);
            } else if (level === 'state') {
                stateFields.push(fieldData);
            }
        });
    }

    // Get office info
    const office = countryOffices.find(o => o.id === officeId);
    const officeName = office ? (office.office_name || office.name) : 'Selected Office';
    const stateName = office ? (office.state_name || office.state_code || '') : '';

    // Render fields
    let html = `
        <div class="office-header">
            <h4>${escapeHtml(officeName)}</h4>
            ${stateName ? `<span class="office-state">State: ${escapeHtml(stateName)}</span>` : ''}
        </div>
    `;

    if (establishmentFields.length > 0) {
        html += `
            <div class="form-section">
                <h5 class="subsection-title">Establishment Registrations</h5>
                <div class="form-grid registration-fields">
                    ${establishmentFields.map(field => createFormFieldHtml(field, officeSavedValues[field.key] || '', officeId)).join('')}
                </div>
            </div>
        `;
    }

    if (stateFields.length > 0) {
        html += `
            <div class="form-section">
                <h5 class="subsection-title">State-Level Registrations</h5>
                <div class="form-grid registration-fields">
                    ${stateFields.map(field => createFormFieldHtml(field, officeSavedValues[field.key] || '', officeId)).join('')}
                </div>
            </div>
        `;
    }

    fieldsContainer.innerHTML = html;
    fieldsContainer.style.display = 'block';

    // Add input validation listeners
    fieldsContainer.querySelectorAll('.registration-input').forEach(input => {
        const pattern = input.dataset.pattern;
        if (pattern) {
            input.addEventListener('blur', () => validateField(input, pattern));
        }
    });
}

/**
 * Create form field HTML (returns string instead of element)
 */
function createFormFieldHtml(field, savedValue, officeId) {
    const isRequired = field.required_for_artifacts && field.required_for_artifacts.length > 0;
    const inputId = officeId ? `reg_${officeId}_${field.key}` : `reg_${field.key}`;

    let helpHtml = '';
    if (field.description) {
        helpHtml += `<small class="form-text text-muted">${escapeHtml(field.description)}</small>`;
    }
    if (field.required_for_artifacts && field.required_for_artifacts.length > 0) {
        helpHtml += `<small class="form-text required-for">Required for: ${field.required_for_artifacts.join(', ')}</small>`;
    }

    return `
        <div class="form-group">
            <label for="${inputId}">
                ${escapeHtml(field.display_label || field.key)}${isRequired ? ' *' : ''}
            </label>
            <input
                type="text"
                id="${inputId}"
                name="${field.key}"
                class="form-control registration-input ${officeId ? 'office-registration' : 'national-registration'}"
                value="${escapeHtml(savedValue)}"
                placeholder="${escapeHtml(field.format_example || `Enter ${field.display_label}`)}"
                ${field.format_regex ? `data-pattern="${escapeHtml(field.format_regex)}"` : ''}
                ${isRequired ? 'data-required="true"' : ''}
                ${officeId ? `data-office-id="${officeId}"` : ''}
            >
            ${helpHtml}
        </div>
    `;
}

/**
 * Create a form section with fields
 * @param officeId - null for national, or office ID for office-level
 */
function createFieldSection(title, fields, savedValues, officeId = null) {
    const section = document.createElement('div');
    section.className = 'form-section';

    section.innerHTML = `
        <h3>${escapeHtml(title)}</h3>
        <div class="form-grid registration-fields"></div>
    `;

    const grid = section.querySelector('.form-grid');

    fields.forEach(field => {
        const formGroup = createFormField(field, savedValues[field.key] || '', officeId);
        grid.appendChild(formGroup);
    });

    return section;
}

/**
 * Create a single form field from a requirement definition
 * @param officeId - null for national, or office ID for office-level
 */
function createFormField(field, savedValue, officeId = null) {
    const formGroup = document.createElement('div');
    formGroup.className = 'form-group';

    // Determine if this is a required field (check if any artifact needs it)
    const isRequired = field.required_for_artifacts && field.required_for_artifacts.length > 0;
    const inputId = officeId ? `reg_${officeId}_${field.key}` : `reg_${field.key}`;
    const inputClass = officeId ? 'office-registration' : 'national-registration';

    // Create label with optional required indicator
    const labelHtml = `
        <label for="${inputId}">
            ${escapeHtml(field.display_label || field.key)}${isRequired ? ' *' : ''}
        </label>
    `;

    // Create input field
    let inputHtml = `
        <input
            type="text"
            id="${inputId}"
            name="${field.key}"
            class="form-control registration-input ${inputClass}"
            value="${escapeHtml(savedValue)}"
            placeholder="${escapeHtml(field.format_example || `Enter ${field.display_label}`)}"
            ${field.format_regex ? `data-pattern="${escapeHtml(field.format_regex)}"` : ''}
            ${isRequired ? 'data-required="true"' : ''}
            ${officeId ? `data-office-id="${officeId}"` : ''}
        >
    `;

    // Add help text if description available
    let helpHtml = '';
    if (field.description) {
        helpHtml += `<small class="form-text text-muted">${escapeHtml(field.description)}</small>`;
    }
    if (field.required_for_artifacts && field.required_for_artifacts.length > 0) {
        helpHtml += `<small class="form-text required-for">Required for: ${field.required_for_artifacts.join(', ')}</small>`;
    }

    formGroup.innerHTML = labelHtml + inputHtml + helpHtml;

    // Add input validation on blur
    const input = formGroup.querySelector('input');
    if (input && field.format_regex) {
        input.addEventListener('blur', () => validateField(input, field.format_regex));
    }

    return formGroup;
}

/**
 * Validate a single field against its regex pattern
 */
function validateField(input, pattern) {
    if (!input.value.trim()) {
        input.classList.remove('is-invalid', 'is-valid');
        return true; // Empty is valid (unless required, checked at submit)
    }

    try {
        const regex = new RegExp(pattern);
        const isValid = regex.test(input.value.trim());
        input.classList.toggle('is-invalid', !isValid);
        input.classList.toggle('is-valid', isValid);
        return isValid;
    } catch (e) {
        console.warn('Invalid regex pattern:', pattern);
        return true;
    }
}

/**
 * Validate all registrations against schema requirements
 */
async function validateRegistrations() {
    if (!selectedCountryCode) {
        showToast('No country selected', 'error');
        return;
    }

    const validationStatus = document.getElementById('registrationValidationStatus');
    const inputs = document.querySelectorAll('.registration-input');

    let errors = [];
    let warnings = [];

    // Client-side validation
    inputs.forEach(input => {
        const key = input.name;
        const value = input.value.trim();
        const pattern = input.dataset.pattern;
        const isRequired = input.dataset.required === 'true';

        if (isRequired && !value) {
            errors.push(`${key} is required for artifact generation`);
            input.classList.add('is-invalid');
        } else if (value && pattern) {
            try {
                const regex = new RegExp(pattern);
                if (!regex.test(value)) {
                    warnings.push(`${key} format may be invalid`);
                    input.classList.add('is-invalid');
                } else {
                    input.classList.remove('is-invalid');
                    input.classList.add('is-valid');
                }
            } catch (e) {
                console.warn('Invalid regex:', pattern);
            }
        } else if (value) {
            input.classList.remove('is-invalid');
            input.classList.add('is-valid');
        }
    });

    // Server-side validation
    try {
        const response = await api.request(`/hrms/statutory/registrations/${selectedCountryCode}/validate`);

        if (response.errors && response.errors.length > 0) {
            errors = [...errors, ...response.errors];
        }
        if (response.warnings && response.warnings.length > 0) {
            warnings = [...warnings, ...response.warnings];
        }
    } catch (error) {
        console.error('Server validation error:', error);
    }

    // Update validation status display
    if (validationStatus) {
        if (errors.length === 0 && warnings.length === 0) {
            validationStatus.innerHTML = `
                <span class="validation-badge success">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="20 6 9 17 4 12"></polyline>
                    </svg>
                    Valid
                </span>
            `;
            showToast('All registrations are valid', 'success');
        } else if (errors.length > 0) {
            validationStatus.innerHTML = `
                <span class="validation-badge error">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <line x1="18" y1="6" x2="6" y2="18"></line>
                        <line x1="6" y1="6" x2="18" y2="18"></line>
                    </svg>
                    ${errors.length} error${errors.length > 1 ? 's' : ''}
                </span>
            `;
            showToast(errors.join('; '), 'error');
        } else {
            validationStatus.innerHTML = `
                <span class="validation-badge warning">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
                        <line x1="12" y1="9" x2="12" y2="13"></line>
                        <line x1="12" y1="17" x2="12.01" y2="17"></line>
                    </svg>
                    ${warnings.length} warning${warnings.length > 1 ? 's' : ''}
                </span>
            `;
            showToast(warnings.join('; '), 'warning');
        }
    }

    return errors.length === 0;
}

/**
 * Handle registration form submission
 * v3.3.4: Saves national and office-level registrations separately
 * API: POST /api/statutory/registrations (with/without office_id)
 */
async function handleRegistrationsSubmit(event) {
    event.preventDefault();

    if (!selectedCountryCode) {
        showToast('No country selected', 'error');
        return;
    }

    const submitBtn = document.getElementById('saveRegistrationsBtn');
    const btnText = submitBtn?.querySelector('.btn-text');
    const btnSpinner = submitBtn?.querySelector('.btn-spinner');

    try {
        // Show loading state
        if (submitBtn) submitBtn.disabled = true;
        if (btnText) btnText.style.display = 'none';
        if (btnSpinner) btnSpinner.style.display = 'inline-flex';

        // Collect national registrations (inputs without data-office-id)
        const nationalInputs = document.querySelectorAll('.registration-input.national-registration');
        const nationalRegistrations = {};

        nationalInputs.forEach(input => {
            const value = input.value.trim();
            if (value) {
                nationalRegistrations[input.name] = value;
            }
        });

        // Collect office-level registrations (inputs with data-office-id)
        const officeInputs = document.querySelectorAll('.registration-input.office-registration');
        const officeRegs = {};  // office_id -> { key: value }

        officeInputs.forEach(input => {
            const officeId = input.dataset.officeId;
            const value = input.value.trim();
            if (officeId && value) {
                if (!officeRegs[officeId]) {
                    officeRegs[officeId] = {};
                }
                officeRegs[officeId][input.name] = value;
            }
        });

        // Basic client-side validation for required fields
        let hasErrors = false;
        const allInputs = document.querySelectorAll('.registration-input');
        allInputs.forEach(input => {
            if (input.dataset.required === 'true' && !input.value.trim()) {
                input.classList.add('is-invalid');
                hasErrors = true;
            }
        });

        if (hasErrors) {
            showToast('Please fill in all required fields', 'error');
            return;
        }

        // Track what we're saving for feedback
        let savedCount = 0;

        // Save national registrations (if any)
        if (Object.keys(nationalRegistrations).length > 0) {
            await api.request('/hrms/statutory/registrations', {
                method: 'POST',
                body: JSON.stringify({
                    country_code: selectedCountryCode,
                    registrations: nationalRegistrations
                    // No office_id = national level
                })
            });
            currentSavedRegistrations = nationalRegistrations;
            savedCount++;
        }

        // Save office-level registrations
        for (const [officeId, regs] of Object.entries(officeRegs)) {
            if (Object.keys(regs).length > 0) {
                await api.request('/hrms/statutory/registrations', {
                    method: 'POST',
                    body: JSON.stringify({
                        country_code: selectedCountryCode,
                        office_id: officeId,
                        registrations: regs
                    })
                });
                officeRegistrations[officeId] = regs;
                savedCount++;
            }
        }

        // Success message
        let message = `Statutory registrations saved for ${selectedCountryCode}`;
        if (savedCount > 1) {
            message = `Saved national and office-level registrations for ${selectedCountryCode}`;
        } else if (Object.keys(officeRegs).length > 0 && Object.keys(nationalRegistrations).length === 0) {
            const officeName = countryOffices.find(o => o.id === selectedOfficeId)?.office_name || 'office';
            message = `Saved registrations for ${officeName}`;
        }

        showToast(message, 'success');

        // Update validation status
        const validationStatus = document.getElementById('registrationValidationStatus');
        if (validationStatus) {
            validationStatus.innerHTML = `
                <span class="validation-badge success">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="20 6 9 17 4 12"></polyline>
                    </svg>
                    Saved
                </span>
            `;
        }

        // Update office selector to show checkmark (using SearchableDropdown)
        if (selectedOfficeId) {
            updateOfficeSelectorOptions();
        }

    } catch (error) {
        console.error('Error saving registrations:', error);
        showToast(error.message || 'Failed to save registrations', 'error');
    } finally {
        // Reset button state
        if (submitBtn) submitBtn.disabled = false;
        if (btnText) btnText.style.display = 'inline';
        if (btnSpinner) btnSpinner.style.display = 'none';
    }
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
