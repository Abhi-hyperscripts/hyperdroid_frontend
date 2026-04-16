/* ═══ Lead Import Wizard ═══ */
(function () {
    'use strict';

    // ── State ──
    let _currentStep = 1;
    let _uploadResult = null;   // FileUploadResult from backend
    let _selectedConfigId = null;
    let _standardFields = {};   // { field_key: "Display Name" }
    let _importResult = null;   // ImportResult from backend

    const esc = (s) => {
        if (!s) return '';
        const d = document.createElement('div');
        d.textContent = s;
        return d.innerHTML;
    };

    // ── API helpers (use /crm/ prefix — api.js strips it) ──
    async function apiGet(path) {
        return api.request(`/crm${path}`);
    }
    async function apiPost(path, body) {
        return api.request(`/crm${path}`, { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });
    }
    async function apiUpload(path, formData) {
        return api.request(`/crm${path}`, { method: 'POST', body: formData });
    }

    // ── Open / Close ──
    function openImportWizard() {
        _currentStep = 1;
        _uploadResult = null;
        _selectedConfigId = null;
        _importResult = null;

        // Reset UI
        document.getElementById('importDropzone').style.display = '';
        document.getElementById('importFileInfo').style.display = 'none';
        document.getElementById('importUploadError').style.display = 'none';
        document.getElementById('importConfigsSection').style.display = 'none';
        document.getElementById('importFileInput').value = '';
        document.getElementById('importDefaultSource').value = '';
        document.getElementById('importDefaultCountry').value = '';
        document.getElementById('importSaveConfig').checked = false;
        document.getElementById('importConfigName').style.display = 'none';
        document.getElementById('importConfigName').value = '';
        document.getElementById('importSkipDupes').checked = true;

        updateStepUI();
        document.getElementById('importWizardOverlay').classList.add('active');

        // Pre-load standard fields
        loadStandardFields();
    }

    function closeImportWizard() {
        document.getElementById('importWizardOverlay').classList.remove('active');
    }

    async function loadStandardFields() {
        try {
            _standardFields = await apiGet('/leads/import/fields');
        } catch (e) {
            console.error('Failed to load standard fields', e);
        }
    }

    // ── Step navigation ──
    function updateStepUI() {
        // Step indicators
        document.querySelectorAll('.import-step').forEach(el => {
            const step = parseInt(el.dataset.step);
            el.classList.toggle('active', step === _currentStep);
            el.classList.toggle('completed', step < _currentStep);
        });

        // Step content
        document.querySelectorAll('.import-step-content').forEach((el, i) => {
            el.classList.toggle('active', (i + 1) === _currentStep);
        });

        // Buttons
        const backBtn = document.getElementById('importBackBtn');
        const nextBtn = document.getElementById('importNextBtn');
        const cancelBtn = document.getElementById('importCancelBtn');

        backBtn.style.display = (_currentStep > 1 && _currentStep < 4) ? '' : 'none';

        if (_currentStep === 1) {
            nextBtn.textContent = 'Next';
            nextBtn.disabled = !_uploadResult;
            cancelBtn.style.display = '';
        } else if (_currentStep === 2) {
            nextBtn.textContent = 'Preview';
            nextBtn.disabled = false;
            cancelBtn.style.display = '';
        } else if (_currentStep === 3) {
            nextBtn.textContent = 'Import';
            nextBtn.disabled = false;
            cancelBtn.style.display = '';
        } else if (_currentStep === 4) {
            nextBtn.textContent = 'Close';
            nextBtn.disabled = false;
            cancelBtn.style.display = 'none';
            backBtn.style.display = 'none';
        }
    }

    function importGoNext() {
        if (_currentStep === 1) {
            // If exact-match config selected, skip mapping
            if (_selectedConfigId && _uploadResult) {
                const match = _uploadResult.suggested_configs.find(c => c.config_id === _selectedConfigId);
                if (match && match.is_exact_match) {
                    _currentStep = 3;
                    runPreview();
                    updateStepUI();
                    return;
                }
            }
            _currentStep = 2;
            renderMappingTable();
        } else if (_currentStep === 2) {
            _currentStep = 3;
            runPreview();
        } else if (_currentStep === 3) {
            runImport();
        } else if (_currentStep === 4) {
            closeImportWizard();
            // Reload leads table
            if (typeof loadLeads === 'function') loadLeads();
            if (typeof loadLeadStats === 'function') loadLeadStats();
        }
        updateStepUI();
    }

    function importGoBack() {
        if (_currentStep === 3) {
            _currentStep = 2;
            renderMappingTable();
        } else if (_currentStep === 2) {
            _currentStep = 1;
        }
        updateStepUI();
    }

    // ── Step 1: File upload ──
    function setupDropzone() {
        const dz = document.getElementById('importDropzone');
        const fileInput = document.getElementById('importFileInput');

        dz.addEventListener('click', () => fileInput.click());
        dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('drag-over'); });
        dz.addEventListener('dragleave', () => dz.classList.remove('drag-over'));
        dz.addEventListener('drop', (e) => {
            e.preventDefault();
            dz.classList.remove('drag-over');
            if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
        });
        fileInput.addEventListener('change', () => {
            if (fileInput.files.length) handleFile(fileInput.files[0]);
        });
    }

    async function handleFile(file) {
        const errorEl = document.getElementById('importUploadError');
        errorEl.style.display = 'none';

        const ext = file.name.split('.').pop().toLowerCase();
        if (!['xlsx', 'xls', 'csv'].includes(ext)) {
            errorEl.textContent = 'Unsupported format. Please upload .xlsx, .xls, or .csv';
            errorEl.style.display = '';
            return;
        }

        // Show loading
        const dz = document.getElementById('importDropzone');
        dz.innerHTML = '<div class="import-loading">Uploading and parsing...</div>';

        try {
            const formData = new FormData();
            formData.append('file', file);
            const result = await apiUpload('/leads/import/upload', formData);

            _uploadResult = result;
            _selectedConfigId = null;

            // Show file info
            dz.style.display = 'none';
            const info = document.getElementById('importFileInfo');
            info.style.display = '';
            document.getElementById('importFileName').textContent = result.file_name;
            document.getElementById('importFileMeta').textContent = `${result.total_rows} rows, ${result.headers.length} columns`;

            // Show saved configs if any match
            if (result.suggested_configs && result.suggested_configs.length > 0) {
                renderConfigSuggestions(result.suggested_configs);
            } else {
                document.getElementById('importConfigsSection').style.display = 'none';
            }

            updateStepUI();
        } catch (err) {
            // Restore dropzone
            dz.innerHTML = `
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                    <polyline points="17 8 12 3 7 8"/>
                    <line x1="12" y1="3" x2="12" y2="15"/>
                </svg>
                <p>Drop your file here or <span class="import-browse-link">browse</span></p>
                <p class="import-dropzone-hint">.xlsx, .xls, or .csv &mdash; up to 5,000 rows</p>`;
            dz.style.display = '';
            errorEl.textContent = err.message || 'Upload failed';
            errorEl.style.display = '';
        }
    }

    function clearImportFile() {
        _uploadResult = null;
        _selectedConfigId = null;
        document.getElementById('importFileInput').value = '';
        document.getElementById('importFileInfo').style.display = 'none';
        document.getElementById('importConfigsSection').style.display = 'none';
        const dz = document.getElementById('importDropzone');
        dz.innerHTML = `
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="17 8 12 3 7 8"/>
                <line x1="12" y1="3" x2="12" y2="15"/>
            </svg>
            <p>Drop your file here or <span class="import-browse-link">browse</span></p>
            <p class="import-dropzone-hint">.xlsx, .xls, or .csv &mdash; up to 5,000 rows</p>`;
        dz.style.display = '';
        updateStepUI();
    }

    function renderConfigSuggestions(configs) {
        const section = document.getElementById('importConfigsSection');
        const list = document.getElementById('importConfigsList');
        section.style.display = '';

        list.innerHTML = configs.map(c => `
            <div class="import-config-option${c.is_exact_match ? ' selected' : ''}"
                 data-config-id="${esc(c.config_id)}"
                 onclick="importSelectConfig('${esc(c.config_id)}')">
                <span class="config-name">${esc(c.config_name)}</span>
                <span class="config-match">${c.is_exact_match ? '100% match' : c.matched_columns + '/' + c.total_config_columns + ' columns'}</span>
            </div>
        `).join('');

        // Auto-select exact match
        if (configs.length > 0 && configs[0].is_exact_match) {
            _selectedConfigId = configs[0].config_id;
        }
    }

    function importSelectConfig(configId) {
        _selectedConfigId = configId;
        document.querySelectorAll('.import-config-option').forEach(el => {
            el.classList.toggle('selected', el.dataset.configId === configId);
        });
        updateStepUI();
    }

    function importUseNewMapping() {
        _selectedConfigId = null;
        document.querySelectorAll('.import-config-option').forEach(el => el.classList.remove('selected'));
        _currentStep = 2;
        renderMappingTable();
        updateStepUI();
    }

    // ── Step 2: Column mapping ──
    function renderMappingTable() {
        if (!_uploadResult) return;
        const tbody = document.getElementById('importMappingBody');
        const headers = _uploadResult.headers;
        const sample = _uploadResult.sample_rows[0] || {};

        // Build the dropdown options
        const fieldOptions = Object.entries(_standardFields)
            .map(([key, label]) => `<option value="${esc(key)}">${esc(label)}</option>`)
            .join('');

        tbody.innerHTML = headers.map((h, i) => `
            <tr>
                <td class="col-header" title="${esc(h)}">${esc(h)}</td>
                <td class="col-sample" title="${esc(sample[h] || '')}">${esc(sample[h] || '—')}</td>
                <td>
                    <select id="mapping_${i}" data-header="${esc(h)}">
                        <option value="__skip__">— Skip —</option>
                        ${fieldOptions}
                        <option value="__custom__">Custom field...</option>
                    </select>
                </td>
            </tr>
        `).join('');

        // Auto-guess mappings by header name similarity
        headers.forEach((h, i) => {
            const sel = document.getElementById(`mapping_${i}`);
            const guess = guessMapping(h);
            if (guess && sel.querySelector(`option[value="${guess}"]`)) {
                sel.value = guess;
            }
        });

        // Show save config checkbox handler
        document.getElementById('importSaveConfig').onchange = function () {
            document.getElementById('importConfigName').style.display = this.checked ? '' : 'none';
        };
    }

    function guessMapping(header) {
        const h = header.toLowerCase().replace(/[\s_\-]+/g, '');
        const map = {
            // Name
            'firstname': 'first_name', 'fname': 'first_name', 'givenname': 'first_name',
            'lastname': 'last_name', 'lname': 'last_name', 'surname': 'last_name', 'familyname': 'last_name',
            'fullname': 'full_name', 'name': 'full_name', 'sendername': 'full_name', 'buyername': 'full_name',
            'contactname': 'full_name', 'naam': 'full_name', 'contactperson': 'full_name', 'personname': 'full_name',
            // Email
            'email': 'email', 'emailaddress': 'email', 'emailid': 'email', 'senderemail': 'email',
            'workemail': 'email', 'mail': 'email', 'emailid': 'email', 'secondaryemail': 'email',
            // Phone
            'phone': 'phone', 'phonenumber': 'phone', 'mobileno': 'phone', 'mobile': 'phone',
            'sendermobile': 'phone', 'mobilephone': 'phone', 'worknumber': 'phone', 'contactnumber': 'phone',
            'tel': 'phone', 'telephone': 'phone', 'cellphone': 'phone', 'cell': 'phone',
            'contact': 'phone', 'mobilenumber': 'phone', 'phoneno': 'phone', 'mobno': 'phone',
            // Company
            'companyname': 'company_name', 'company': 'company_name', 'organization': 'company_name',
            'organisation': 'company_name', 'sendercompany': 'company_name', 'firm': 'company_name',
            // Job title
            'jobtitle': 'job_title', 'title': 'job_title', 'designation': 'job_title', 'position': 'job_title', 'role': 'job_title',
            // Location
            'city': 'city', 'sendercity': 'city', 'town': 'city', 'shehar': 'city',
            'state': 'state', 'senderstate': 'state', 'stateregion': 'state', 'province': 'state', 'stateprovince': 'state',
            'country': 'country', 'countryregion': 'country', 'sendercountry': 'country',
            'address': 'address', 'streetaddress': 'address', 'senderaddress': 'address', 'pata': 'address',
            'pincode': 'pincode', 'zipcode': 'pincode', 'postalcode': 'pincode', 'zip': 'pincode', 'senderpincode': 'pincode', 'postcode': 'pincode',
            // Lead context
            'leadsource': 'lead_source', 'source': 'lead_source', 'originalsource': 'lead_source', 'utmsource': 'lead_source',
            'productinterest': 'product_interest', 'productname': 'product_interest', 'subject': 'product_interest',
            'product': 'product_interest', 'service': 'product_interest', 'interest': 'product_interest', 'kaam': 'product_interest',
            'notes': 'notes', 'description': 'notes', 'querymessage': 'notes', 'message': 'notes',
            'comments': 'notes', 'remarks': 'notes', 'note': 'notes', 'remark': 'notes',
            'estimatedvalue': 'estimated_value', 'value': 'estimated_value', 'dealvalue': 'estimated_value',
            'budget': 'estimated_value', 'amount': 'estimated_value',
            // Dates & attribution
            'leaddate': 'lead_date', 'createdtime': 'lead_date', 'createddate': 'lead_date', 'createdate': 'lead_date',
            'submissiondate': 'lead_date', 'querytime': 'lead_date', 'timestamp': 'lead_date', 'date': 'lead_date',
            'campaignname': 'campaign_name', 'campaign': 'campaign_name',
            'website': 'website', 'websiteurl': 'website', 'url': 'website',
            'tags': 'tags',
            'queryid': 'external_lead_id', 'inquiryid': 'external_lead_id', 'leadid': 'external_lead_id', 'id': 'external_lead_id',
            'alternatephone': 'alternate_phone', 'altphone': 'alternate_phone', 'phone2': 'alternate_phone', 'otherphone': 'alternate_phone',
            // Quantity (common in Indiamart) — maps to custom
            'quantity': 'estimated_value', 'qty': 'estimated_value',
        };
        return map[h] || null;
    }

    async function collectMappings() {
        const mappings = {};
        const selects = document.getElementById('importMappingBody').querySelectorAll('select');
        selects.forEach(sel => {
            const header = sel.dataset.header;
            const val = sel.value;
            if (val === '__skip__') {
                mappings[header] = { target: null, type: 'skip' };
            } else if (val === '__custom__') {
                const customKey = await showPrompt(`Enter a custom field name for column "${header}":`, '', 'Custom Field');
                if (customKey) {
                    mappings[header] = { target: customKey.trim().toLowerCase().replace(/\s+/g, '_'), type: 'custom' };
                } else {
                    mappings[header] = { target: null, type: 'skip' };
                }
            } else {
                mappings[header] = { target: val, type: 'standard' };
            }
        });
        return mappings;
    }

    function collectDefaults() {
        const defaults = {};
        const src = document.getElementById('importDefaultSource').value.trim();
        const country = document.getElementById('importDefaultCountry').value.trim();
        if (src) defaults.lead_source = src;
        if (country) defaults.country = country;
        return defaults;
    }

    // ── Step 3: Preview ──
    async function runPreview() {
        const body = document.getElementById('importStep3').querySelector('.import-preview-table-wrap');
        const summary = document.getElementById('importPreviewSummary');
        body.innerHTML = '<div class="import-loading">Analyzing leads...</div>';
        summary.innerHTML = '';

        try {
            const req = {
                file_id: _uploadResult.file_id,
                config_id: _selectedConfigId || undefined,
                column_mappings: _selectedConfigId ? undefined : await collectMappings(),
                default_values: collectDefaults()
            };

            const result = await apiPost('/leads/import/preview', req);

            // Summary cards
            summary.innerHTML = `
                <div class="import-preview-stat stat-valid">
                    <div class="stat-num">${result.valid_rows}</div>
                    <div class="stat-label">Ready</div>
                </div>
                <div class="import-preview-stat stat-dupe">
                    <div class="stat-num">${result.duplicate_rows}</div>
                    <div class="stat-label">Duplicates</div>
                </div>
                <div class="import-preview-stat stat-error">
                    <div class="stat-num">${result.error_rows}</div>
                    <div class="stat-label">Errors</div>
                </div>
            `;

            // Preview table
            const tbody = document.getElementById('importPreviewBody');
            body.innerHTML = `<table class="import-preview-table">
                <thead><tr><th>Row</th><th>Name</th><th>Email</th><th>Phone</th><th>Company</th><th>Status</th></tr></thead>
                <tbody id="importPreviewBody"></tbody>
            </table>`;
            const newTbody = document.getElementById('importPreviewBody');
            newTbody.innerHTML = result.preview.map(r => {
                const name = [r.first_name, r.last_name].filter(Boolean).join(' ') || '—';
                const badgeClass = r.status === 'new' ? 'badge-new' : r.status === 'duplicate' ? 'badge-duplicate' : 'badge-error';
                const statusLabel = r.status === 'new' ? 'New' : r.status === 'duplicate' ? 'Dupe' : 'Error';
                const title = r.duplicate_reason || '';
                return `<tr class="row-${r.status}">
                    <td>${r.row_number}</td>
                    <td>${esc(name)}</td>
                    <td>${esc(r.email || '—')}</td>
                    <td>${esc(r.phone || '—')}</td>
                    <td>${esc(r.company_name || '—')}</td>
                    <td><span class="import-row-badge ${badgeClass}" title="${esc(title)}">${statusLabel}</span></td>
                </tr>`;
            }).join('');

        } catch (err) {
            body.innerHTML = `<div class="import-error">${esc(err.message || 'Preview failed')}</div>`;
        }
    }

    // ── Step 4: Execute import ──
    async function runImport() {
        const nextBtn = document.getElementById('importNextBtn');
        nextBtn.disabled = true;
        nextBtn.textContent = 'Importing...';

        try {
            const saveConfig = document.getElementById('importSaveConfig').checked;
            const configName = document.getElementById('importConfigName').value.trim();

            const req = {
                file_id: _uploadResult.file_id,
                config_id: _selectedConfigId || undefined,
                column_mappings: _selectedConfigId ? undefined : await collectMappings(),
                default_values: collectDefaults(),
                skip_duplicates: document.getElementById('importSkipDupes').checked,
                save_config_as: (saveConfig && configName) ? configName : undefined
            };

            _importResult = await apiPost('/leads/import/confirm', req);

            // Show done step
            _currentStep = 4;
            updateStepUI();

            const stats = document.getElementById('importDoneStats');
            stats.innerHTML = `
                <div class="done-headline">${_importResult.imported_count} leads imported</div>
                <div class="done-breakdown">
                    <span>${_importResult.total_rows} total</span>
                    <span>${_importResult.duplicate_count} duplicates</span>
                    <span>${_importResult.error_count} errors</span>
                    <span>${_importResult.skipped_count} skipped</span>
                </div>
            `;

            // Show errors if any
            const errDiv = document.getElementById('importDoneErrors');
            if (_importResult.errors && _importResult.errors.length > 0) {
                errDiv.style.display = '';
                errDiv.innerHTML = '<strong>Errors:</strong>' +
                    _importResult.errors.map(e =>
                        `<div class="error-row">Row ${e.row_number}: ${esc(e.message)}</div>`
                    ).join('');
            } else {
                errDiv.style.display = 'none';
            }

        } catch (err) {
            nextBtn.disabled = false;
            nextBtn.textContent = 'Import';
            if (typeof showToast === 'function') {
                showToast(err.message || 'Import failed', 'error');
            }
        }
    }

    // ── Init ──
    document.addEventListener('DOMContentLoaded', () => {
        setupDropzone();
    });

    // Expose to window
    window.openImportWizard = openImportWizard;
    window.closeImportWizard = closeImportWizard;
    window.importGoNext = importGoNext;
    window.importGoBack = importGoBack;
    window.importSelectConfig = importSelectConfig;
    window.importUseNewMapping = importUseNewMapping;
    window.clearImportFile = clearImportFile;
})();
