/**
 * AccountsService — Taxation Page
 *
 * Handles 8 sidebar tabs:
 *   1. Tax Configs       5. GSTR-3B
 *   2. Tax Rates         6. TDS Return
 *   3. HSN/SAC Codes     7. Tax Calculator
 *   4. GSTR-1            8. Tax Ledger
 */

// ============================================================================
// GLOBAL STATE
// ============================================================================

let taxConfigs = [];
let taxRates = [];
let hsnSacCodes = [];
let taxLedgerEntries = [];

let hsnSacPage = 1;
let taxLedgerPage = 1;
const PAGE_SIZE = 50;

// Dropdown instances
let rateConfigFilterDropdown = null;

// ============================================================================
// PAGE INIT
// ============================================================================

document.addEventListener('DOMContentLoaded', async function () {
    if (!await AccountsCommon.initPage('taxation', '../')) return;

    const tabNames = {
        'tax-config': 'Tax Configs',
        'tax-rates': 'Tax Rates',
        'hsn-sac': 'HSN/SAC Codes',
        'gstr-1': 'GSTR-1',
        'gstr-3b': 'GSTR-3B',
        'tds-return': 'TDS Return',
        'tax-calculator': 'Tax Calculator',
        'tax-ledger': 'Tax Ledger'
    };

    AccountsCommon.setupSidebar('sidebarToggle', 'accountsSidebar', 'sidebarOverlay', tabNames);
    AccountsCommon.setupTabs(tabNames, onTabSwitch);
    accountsRoles.applyRBAC();

    await loadInitialData();
    AccountsCommon.initSearchableDropdownsWithRetry(initDropdowns);
    setupSearchListeners();
});

// ============================================================================
// TAB SWITCH HANDLER
// ============================================================================

function onTabSwitch(tabId) {
    switch (tabId) {
        case 'tax-config':      loadTaxConfigs(); break;
        case 'tax-rates':       loadTaxRates(); break;
        case 'hsn-sac':         loadHsnSacCodes(); break;
        case 'gstr-1':          setDefaultDatesAndGenerate('gstr1From', 'gstr1To', generateGSTR1); break;
        case 'gstr-3b':         setDefaultDatesAndGenerate('gstr3bFrom', 'gstr3bTo', generateGSTR3B); break;
        case 'tds-return':      setDefaultDatesAndGenerate('tdsFrom', 'tdsTo', generateTDSReturn); break;
        case 'tax-calculator':  populateCalcConfigSelect(); break;
        case 'tax-ledger':      loadTaxLedger(); break;
    }
}

// ============================================================================
// INITIAL DATA LOAD
// ============================================================================

async function loadInitialData() {
    try {
        await loadTaxConfigs();
    } catch (err) {
        console.error('[Taxation] loadInitialData error:', err);
    }
}

function initDropdowns() {
    if (typeof SearchableDropdown === 'undefined') return;

    const configOptions = taxConfigs.map(c => ({ value: c.id, label: c.name }));

    // SearchableDropdown signature is (containerElOrId, { options, ... })
    rateConfigFilterDropdown = new SearchableDropdown(document.getElementById('rateConfigFilterContainer'), {
        placeholder: 'Filter by config...',
        options: configOptions,
        onChange: () => loadTaxRates()
    });
}

function setupSearchListeners() {
    const debounce = (fn, ms = 300) => {
        let timer;
        return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); };
    };

    const cfgSearch = document.getElementById('taxConfigSearch');
    if (cfgSearch) cfgSearch.addEventListener('input', debounce(() => loadTaxConfigs()));

    const rateSearch = document.getElementById('taxRateSearch');
    if (rateSearch) rateSearch.addEventListener('input', debounce(() => loadTaxRates()));

    const hsnSearch = document.getElementById('hsnSacSearch');
    if (hsnSearch) hsnSearch.addEventListener('input', debounce(() => { hsnSacPage = 1; loadHsnSacCodes(); }));

    const auditUser = document.getElementById('auditUserSearch');
    if (auditUser) auditUser.addEventListener('input', debounce(() => loadTaxLedger()));
}

// ============================================================================
// 1. TAX CONFIGS
// ============================================================================

async function loadTaxConfigs() {
    try {
        const search = (document.getElementById('taxConfigSearch')?.value || '').trim().toLowerCase();

        // Backend GetTaxConfigurations only supports countryCode/taxType params —
        // free-text search is applied client-side.
        const url = AccountsCommon.buildUrl('tax/configurations');
        const res = await api.request(url, { _skipSpinner: true });
        taxConfigs = Array.isArray(res) ? res : (res?.data || res?.items || []);
        const filtered = search
            ? taxConfigs.filter(c =>
                (c.name || '').toLowerCase().includes(search) ||
                (c.country_code || '').toLowerCase().includes(search) ||
                (c.tax_type || '').toLowerCase().includes(search))
            : taxConfigs;
        renderTaxConfigs(filtered);
    } catch (err) {
        console.error('[Taxation] loadTaxConfigs error:', err);
        Toast.error('Failed to load tax configs');
    }
}

function renderTaxConfigs(list = taxConfigs) {
    const tbody = document.getElementById('taxConfigsTable');
    if (!tbody) return;

    if (!list.length) {
        tbody.innerHTML = `<tr class="empty-state"><td colspan="6"><div class="empty-message">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">
                <circle cx="12" cy="12" r="3"></circle>
            </svg><p>No tax configs found</p></div></td></tr>`;
        return;
    }

    tbody.innerHTML = list.map(c => {
        const status = c.status || (c.is_active === false ? 'inactive' : 'active');
        const viewBtn = `<button class="btn-icon" onclick="viewTaxConfig('${c.id}')" data-tooltip="View"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg></button>`;
        const adminBtns = accountsRoles.isAdmin()
            ? `<button class="btn-icon" onclick="editTaxConfig('${c.id}')" data-tooltip="Edit"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
               <button class="btn-icon danger" onclick="deleteTaxConfig('${c.id}')" data-tooltip="Delete"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>`
            : '';
        const actions = viewBtn + adminBtns;

        return `<tr>
            <td>${AccountsCommon.escapeHtml(c.name)}</td>
            <td>${AccountsCommon.escapeHtml(c.country_code || c.country || '-')}</td>
            <td>${AccountsCommon.escapeHtml(c.tax_type || '-')}</td>
            <td>${c.configuration?.total_rate != null ? c.configuration.total_rate + '%' : (c.rate != null ? c.rate + '%' : '-')}</td>
            <td>${AccountsCommon.statusBadge(status)}</td>
            <td class="actions-cell">${actions}</td>
        </tr>`;
    }).join('');
}

async function viewTaxConfig(id) {
    try {
        const res = await api.request(AccountsCommon.buildUrl(`tax/configurations/${id}`));
        const c = res?.data || res;
        if (!c) { Toast.error('Tax config not found'); return; }

        const esc = AccountsCommon.escapeHtml;
        const status = c.status || (c.is_active === false ? 'inactive' : 'active');

        // Format configuration JSON nicely
        let configDisplay = '-';
        if (c.configuration) {
            try {
                configDisplay = `<pre style="margin:0;font-size:0.8rem;white-space:pre-wrap;word-break:break-all;background:var(--bg-tertiary);padding:0.5rem;border-radius:4px;">${esc(JSON.stringify(c.configuration, null, 2))}</pre>`;
            } catch (e) {
                configDisplay = esc(String(c.configuration));
            }
        }

        document.getElementById('taxDetailModalTitle').textContent = 'Tax Config Details';
        document.getElementById('taxDetailBody').innerHTML = `
            <div class="detail-grid">
                <div class="detail-row"><span class="detail-label">Name</span><span class="detail-value">${esc(c.name || '-')}</span></div>
                <div class="detail-row"><span class="detail-label">Country Code</span><span class="detail-value">${esc(c.country_code || c.country || '-')}</span></div>
                <div class="detail-row"><span class="detail-label">Tax Type</span><span class="detail-value">${esc(c.tax_type || '-')}</span></div>
                <div class="detail-row"><span class="detail-label">Rate</span><span class="detail-value">${c.configuration?.total_rate != null ? c.configuration.total_rate + '%' : (c.rate != null ? c.rate + '%' : '-')}</span></div>
                <div class="detail-row"><span class="detail-label">Status</span><span class="detail-value">${AccountsCommon.statusBadge(status)}</span></div>
                <div class="detail-row"><span class="detail-label">Effective From</span><span class="detail-value">${AccountsCommon.formatDate(c.effective_from)}</span></div>
                <div class="detail-row"><span class="detail-label">Effective To</span><span class="detail-value">${AccountsCommon.formatDate(c.effective_to)}</span></div>
                <div class="detail-row full-width"><span class="detail-label">Description</span><span class="detail-value">${esc(c.description || c.configuration?.description || '-')}</span></div>
                <div class="detail-row full-width"><span class="detail-label">Configuration (JSON)</span><span class="detail-value">${configDisplay}</span></div>
                <div class="detail-row"><span class="detail-label">Created</span><span class="detail-value">${AccountsCommon.formatDate(c.created_at)}</span></div>
                <div class="detail-row"><span class="detail-label">Updated</span><span class="detail-value">${AccountsCommon.formatDate(c.updated_at)}</span></div>
            </div>`;
        AccountsCommon.openModal('taxDetailModal');
    } catch (err) {
        console.error('[Taxation] viewTaxConfig error:', err);
        Toast.error('Failed to load tax config details');
    }
}

function showCreateTaxConfigModal() {
    document.getElementById('taxConfigModalTitle').textContent = 'Create Tax Config';
    document.getElementById('taxConfigForm').reset();
    document.getElementById('taxConfigId').value = '';
    document.getElementById('taxConfigStatus').value = 'active';
    // Country and Tax Type are set at creation only — re-enable them for a new config.
    document.getElementById('taxConfigCountry').disabled = false;
    document.getElementById('taxConfigType').disabled = false;
    AccountsCommon.openModal('taxConfigModal');
}

function editTaxConfig(id) {
    const cfg = taxConfigs.find(c => c.id === id);
    if (!cfg) return;

    document.getElementById('taxConfigModalTitle').textContent = 'Edit Tax Config';
    document.getElementById('taxConfigId').value = cfg.id;
    document.getElementById('taxConfigName').value = cfg.name || '';
    document.getElementById('taxConfigCountry').value = cfg.country_code || cfg.country || '';
    document.getElementById('taxConfigType').value = cfg.tax_type || '';
    document.getElementById('taxConfigRate').value = cfg.configuration?.total_rate ?? cfg.rate ?? '';
    document.getElementById('taxConfigStatus').value = cfg.status || 'active';
    document.getElementById('taxConfigDescription').value = cfg.description || '';
    // The backend treats country_code / tax_type as immutable after creation (the update
    // payload omits them). Disable so the user isn't misled into editing a discarded field.
    document.getElementById('taxConfigCountry').disabled = true;
    document.getElementById('taxConfigType').disabled = true;
    AccountsCommon.openModal('taxConfigModal');
}

async function saveTaxConfig() {
    const id = document.getElementById('taxConfigId').value;
    const name = document.getElementById('taxConfigName').value.trim();
    const country = document.getElementById('taxConfigCountry').value.trim();
    const tax_type = document.getElementById('taxConfigType').value;
    const rate = parseFloat(document.getElementById('taxConfigRate').value);
    const status = document.getElementById('taxConfigStatus').value;
    const description = document.getElementById('taxConfigDescription').value.trim();

    if (!name || !country || !tax_type || isNaN(rate)) {
        Toast.error('Name, Country, Tax Type, and Rate are required');
        return;
    }

    const payload = id
        ? { name, is_active: status !== 'inactive', configuration: { total_rate: rate, description } }
        : { name, country_code: country, tax_type, configuration: { total_rate: rate, description }, effective_from: new Date().toISOString() };

    try {
        if (id) {
            await api.request(AccountsCommon.buildUrl(`tax/configurations/${id}`), { method: 'PUT', body: JSON.stringify(payload) });
            Toast.success('Tax config updated');
        } else {
            await api.request(AccountsCommon.buildUrl('tax/configurations'), { method: 'POST', body: JSON.stringify(payload) });
            Toast.success('Tax config created');
        }
        AccountsCommon.closeModal('taxConfigModal');
        await loadTaxConfigs();
    } catch (err) {
        console.error('[Taxation] saveTaxConfig error:', err);
        Toast.error(err.message || 'Failed to save tax config');
    }
}

async function deleteTaxConfig(id) {
    const ok = await Confirm.danger('Are you sure you want to delete this tax config?', 'Delete Tax Config');
    if (!ok) return;
    try {
        await api.request(AccountsCommon.buildUrl(`tax/configurations/${id}`), { method: 'DELETE' });
        Toast.success('Tax config deleted');
        await loadTaxConfigs();
    } catch (err) {
        console.error('[Taxation] deleteTaxConfig error:', err);
        Toast.error(err.message || 'Failed to delete tax config');
    }
}

async function seedIndiaGST() {
    const ok = await Confirm.show({ title: 'Seed India GST', message: 'This will seed standard India GST tax configurations. Continue?', confirmText: 'Continue', type: 'warning' });
    if (!ok) return;
    try {
        await api.request(AccountsCommon.buildUrl('tax/seed-india'), { method: 'POST' });
        Toast.success('India GST configs seeded successfully');
        await loadTaxConfigs();
    } catch (err) {
        console.error('[Taxation] seedIndiaGST error:', err);
        Toast.error(err.message || 'Failed to seed India GST');
    }
}

// ============================================================================
// 2. TAX RATES
// ============================================================================

async function loadTaxRates() {
    try {
        const search = document.getElementById('taxRateSearch')?.value || '';
        // Backend requires configId — use filter selection or auto-select first config
        const configFilter = rateConfigFilterDropdown?.getValue?.() || '';
        const configId = configFilter || (taxConfigs.length > 0 ? taxConfigs[0].id : '');

        if (!configId) {
            // No configs exist yet — show prompt
            const tbody = document.getElementById('taxRatesTable');
            if (tbody) tbody.innerHTML = '<tr><td colspan="5" class="text-center">Create a Tax Config first to add rates</td></tr>';
            return;
        }

        const params = { configId };
        // Backend GetTaxRates doesn't support a `search` param — filter client-side

        const url = AccountsCommon.buildUrl('tax/rates', params);
        const res = await api.request(url, { _skipSpinner: true });
        taxRates = Array.isArray(res) ? res : (res?.data || res?.items || []);
        const q = (search || '').trim().toLowerCase();
        const filtered = q ? taxRates.filter(r => (r.name || '').toLowerCase().includes(q)) : taxRates;
        renderTaxRates(filtered);
    } catch (err) {
        console.error('[Taxation] loadTaxRates error:', err);
        Toast.error('Failed to load tax rates');
    }
}

function renderTaxRates(list = taxRates) {
    const tbody = document.getElementById('taxRatesTable');
    if (!tbody) return;

    if (!list.length) {
        tbody.innerHTML = `<tr class="empty-state"><td colspan="5"><div class="empty-message">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">
                <line x1="19" y1="5" x2="5" y2="19"></line>
                <circle cx="6.5" cy="6.5" r="2.5"></circle>
                <circle cx="17.5" cy="17.5" r="2.5"></circle>
            </svg><p>No tax rates configured</p></div></td></tr>`;
        return;
    }

    tbody.innerHTML = list.map(r => {
        const status = r.status || (r.is_active === false ? 'inactive' : 'active');
        const actions = accountsRoles.isAdmin()
            ? `<button class="btn-icon" onclick="editTaxRate('${r.id}')" data-tooltip="Edit"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
               <button class="btn-icon danger" onclick="deleteTaxRate('${r.id}')" data-tooltip="Delete"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>`
            : '-';

        return `<tr>
            <td>${AccountsCommon.escapeHtml(r.name)}</td>
            <td>${r.rate != null ? r.rate + '%' : '-'}</td>
            <td>${AccountsCommon.escapeHtml(r.tax_account_name || '-')}</td>
            <td>${AccountsCommon.statusBadge(status)}</td>
            <td class="actions-cell">${actions}</td>
        </tr>`;
    }).join('');
}

function showCreateTaxRateModal() {
    document.getElementById('taxRateModalTitle').textContent = 'Create Tax Rate';
    document.getElementById('taxRateForm').reset();
    document.getElementById('taxRateId').value = '';
    populateTaxRateConfigSelect();
    populateTaxRateAccountSelect();
    AccountsCommon.openModal('taxRateModal');
}

function editTaxRate(id) {
    const rate = taxRates.find(r => r.id === id);
    if (!rate) return;

    document.getElementById('taxRateModalTitle').textContent = 'Edit Tax Rate';
    document.getElementById('taxRateId').value = rate.id;
    document.getElementById('taxRateName').value = rate.name || '';
    document.getElementById('taxRatePercent').value = rate.rate ?? '';
    populateTaxRateConfigSelect(rate.tax_configuration_id);
    populateTaxRateAccountSelect(rate.tax_account_id);
    AccountsCommon.openModal('taxRateModal');
}

async function saveTaxRate() {
    const id = document.getElementById('taxRateId').value;
    const name = document.getElementById('taxRateName').value.trim();
    const rate = parseFloat(document.getElementById('taxRatePercent').value);
    const tax_configuration_id = document.getElementById('taxRateConfig').value;
    const tax_account_id = document.getElementById('taxRateAccount').value || null;

    if (!name || isNaN(rate) || !tax_configuration_id) {
        Toast.error('Name, Rate, and Tax Config are required');
        return;
    }

    // Backend CreateTaxRateRequest (also used for update) has no status/is_active
    // field — rates are active by default, so no Status control is offered.
    const payload = { name, rate, tax_configuration_id, tax_account_id };

    try {
        if (id) {
            await api.request(AccountsCommon.buildUrl(`tax/rates/${id}`), { method: 'PUT', body: JSON.stringify(payload) });
            Toast.success('Tax rate updated');
        } else {
            await api.request(AccountsCommon.buildUrl('tax/rates'), { method: 'POST', body: JSON.stringify(payload) });
            Toast.success('Tax rate created');
        }
        AccountsCommon.closeModal('taxRateModal');
        await loadTaxRates();
    } catch (err) {
        console.error('[Taxation] saveTaxRate error:', err);
        Toast.error(err.message || 'Failed to save tax rate');
    }
}

async function deleteTaxRate(id) {
    const ok = await Confirm.danger('Are you sure you want to delete this tax rate?', 'Delete Tax Rate');
    if (!ok) return;
    try {
        await api.request(AccountsCommon.buildUrl(`tax/rates/${id}`), { method: 'DELETE' });
        Toast.success('Tax rate deleted');
        await loadTaxRates();
    } catch (err) {
        console.error('[Taxation] deleteTaxRate error:', err);
        Toast.error(err.message || 'Failed to delete tax rate');
    }
}

function populateTaxRateConfigSelect(selectedValue) {
    const sel = document.getElementById('taxRateConfig');
    if (!sel) return;
    sel.innerHTML = '<option value="">Select...</option>' +
        taxConfigs.map(c => `<option value="${c.id}" ${c.id === selectedValue ? 'selected' : ''}>${AccountsCommon.escapeHtml(c.name)}</option>`).join('');
}

async function populateTaxRateAccountSelect(selectedValue) {
    const sel = document.getElementById('taxRateAccount');
    if (!sel) return;
    try {
        const url = AccountsCommon.buildUrl('coa', { pageSize: 500 });
        const res = await api.request(url, { _skipSpinner: true });
        const accounts = Array.isArray(res) ? res : (res?.data || res?.items || []);
        sel.innerHTML = '<option value="">Select account...</option>' +
            accounts.map(a => {
                const c = a.account_code || a.code || '';
                const n = a.account_name || a.name || '';
                return `<option value="${a.id}" ${a.id === selectedValue ? 'selected' : ''}>${AccountsCommon.escapeHtml(c ? c + ' - ' + n : n)}</option>`;
            }).join('');
    } catch (err) {
        console.error('[Taxation] populateTaxRateAccountSelect error:', err);
    }
}

// ============================================================================
// 3. HSN/SAC CODES
// ============================================================================

async function loadHsnSacCodes() {
    try {
        const search = document.getElementById('hsnSacSearch')?.value || '';
        const typeFilter = document.getElementById('hsnSacTypeFilter')?.value || '';
        const params = {};
        if (search) params.search = search;
        if (typeFilter) params.codeType = typeFilter;

        const url = AccountsCommon.buildUrl('tax/hsn-sac', params);
        const res = await api.request(url, { _skipSpinner: true });
        // Backend GetHsnSacCodes supports search/codeType but not paging —
        // pagination is applied client-side over the full returned list.
        hsnSacCodes = Array.isArray(res) ? res : (res?.data || res?.items || []);
        const total = hsnSacCodes.length;
        const totalPages = Math.ceil(total / PAGE_SIZE) || 1;
        if (hsnSacPage > totalPages) hsnSacPage = totalPages;
        const pageSlice = hsnSacCodes.slice((hsnSacPage - 1) * PAGE_SIZE, hsnSacPage * PAGE_SIZE);

        renderHsnSacCodes(pageSlice);
        AccountsCommon.renderPagination('hsnSacPagination', hsnSacPage, totalPages, (page) => {
            hsnSacPage = page;
            loadHsnSacCodes();
        });
    } catch (err) {
        console.error('[Taxation] loadHsnSacCodes error:', err);
        Toast.error('Failed to load HSN/SAC codes');
    }
}

function renderHsnSacCodes(list = hsnSacCodes) {
    const tbody = document.getElementById('hsnSacTable');
    if (!tbody) return;

    if (!list.length) {
        tbody.innerHTML = `<tr class="empty-state"><td colspan="5"><div class="empty-message">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">
                <polyline points="16 18 22 12 16 6"></polyline>
                <polyline points="8 6 2 12 8 18"></polyline>
            </svg><p>No HSN/SAC codes found</p></div></td></tr>`;
        return;
    }

    tbody.innerHTML = list.map(h => {
        const actions = accountsRoles.isAdmin()
            ? `<button class="btn-icon" onclick="editHsnSac('${h.id}')" data-tooltip="Edit"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
               <button class="btn-icon danger" onclick="deleteHsnSac('${h.id}')" data-tooltip="Delete"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>`
            : '-';

        return `<tr>
            <td><code>${AccountsCommon.escapeHtml(h.code)}</code></td>
            <td>${AccountsCommon.escapeHtml(h.description || '-')}</td>
            <td>${(h.code_type || h.type) ? `<span class="badge ${(h.code_type || h.type) === 'HSN' ? 'status-active' : 'status-pending'}">${AccountsCommon.escapeHtml(h.code_type || h.type)}</span>` : 'N/A'}</td>
            <td>${h.default_tax_rate != null ? h.default_tax_rate + '%' : '-'}</td>
            <td class="actions-cell">${actions}</td>
        </tr>`;
    }).join('');
}

function showCreateHsnSacModal() {
    document.getElementById('hsnSacModalTitle').textContent = 'Create HSN/SAC Code';
    document.getElementById('hsnSacForm').reset();
    document.getElementById('hsnSacId').value = '';
    AccountsCommon.openModal('hsnSacModal');
}

function editHsnSac(id) {
    const h = hsnSacCodes.find(x => x.id === id);
    if (!h) return;

    document.getElementById('hsnSacModalTitle').textContent = 'Edit HSN/SAC Code';
    document.getElementById('hsnSacId').value = h.id;
    document.getElementById('hsnSacCode').value = h.code || '';
    document.getElementById('hsnSacType').value = h.code_type || '';
    document.getElementById('hsnSacDescription').value = h.description || '';
    document.getElementById('hsnSacTaxRate').value = h.default_tax_rate ?? '';
    AccountsCommon.openModal('hsnSacModal');
}

async function saveHsnSac() {
    const id = document.getElementById('hsnSacId').value;
    const code = document.getElementById('hsnSacCode').value.trim();
    const type = document.getElementById('hsnSacType').value;
    const description = document.getElementById('hsnSacDescription').value.trim();
    const default_tax_rate = document.getElementById('hsnSacTaxRate').value ? parseFloat(document.getElementById('hsnSacTaxRate').value) : null;

    if (!code || !type || !description) {
        Toast.error('Code, Type, and Description are required');
        return;
    }

    const payload = { code, code_type: type, description, default_tax_rate };

    try {
        if (id) {
            await api.request(AccountsCommon.buildUrl(`tax/hsn-sac/${id}`), { method: 'PUT', body: JSON.stringify(payload) });
            Toast.success('HSN/SAC code updated');
        } else {
            await api.request(AccountsCommon.buildUrl('tax/hsn-sac'), { method: 'POST', body: JSON.stringify(payload) });
            Toast.success('HSN/SAC code created');
        }
        AccountsCommon.closeModal('hsnSacModal');
        await loadHsnSacCodes();
    } catch (err) {
        console.error('[Taxation] saveHsnSac error:', err);
        Toast.error(err.message || 'Failed to save HSN/SAC code');
    }
}

async function deleteHsnSac(id) {
    const ok = await Confirm.danger('Are you sure you want to delete this HSN/SAC code?', 'Delete HSN/SAC Code');
    if (!ok) return;
    try {
        await api.request(AccountsCommon.buildUrl(`tax/hsn-sac/${id}`), { method: 'DELETE' });
        Toast.success('HSN/SAC code deleted');
        await loadHsnSacCodes();
    } catch (err) {
        console.error('[Taxation] deleteHsnSac error:', err);
        Toast.error(err.message || 'Failed to delete HSN/SAC code');
    }
}

// ============================================================================
// HELPER: Set default fiscal year dates and auto-generate
// ============================================================================

function setDefaultDatesAndGenerate(fromId, toId, generateFn) {
    const fromEl = document.getElementById(fromId);
    const toEl = document.getElementById(toId);
    if (!fromEl || !toEl) return;

    // Only set defaults if fields are empty
    if (!fromEl.value && !toEl.value) {
        const now = new Date();
        const fyStart = now.getMonth() >= 3
            ? new Date(now.getFullYear(), 3, 1)   // Apr 1 of current year
            : new Date(now.getFullYear() - 1, 3, 1); // Apr 1 of previous year
        const pad = (n) => String(n).padStart(2, '0');
        fromEl.value = `${fyStart.getFullYear()}-${pad(fyStart.getMonth() + 1)}-${pad(fyStart.getDate())}`;
        toEl.value = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    }

    generateFn();
}

// ============================================================================
// 4. GSTR-1
// ============================================================================

async function generateGSTR1() {
    const from = document.getElementById('gstr1From')?.value;
    const to = document.getElementById('gstr1To')?.value;
    if (!from || !to) {
        Toast.error('Please select both From and To dates');
        return;
    }

    const area = document.getElementById('gstr1ReportArea');
    try {
        const url = AccountsCommon.buildUrl('tax/reports/gstr1', { fromDate: from, toDate: to });
        const res = await api.request(url);
        // Response: { report, period, outward_supplies: [{party_name, party_tax_id, taxable_amount, tax_amount, transaction_date}], total_taxable, total_tax, invoice_count }
        const rows = res?.outward_supplies || [];

        if (!rows.length) {
            area.innerHTML = `<div class="glass-card-body"><div class="empty-message"><p>No GSTR-1 data found for the selected period</p></div></div>`;
            return;
        }

        area.innerHTML = `<div class="glass-card-body">
            <h4 style="margin-bottom:1rem;">GSTR-1 Report (${AccountsCommon.formatDate(from)} - ${AccountsCommon.formatDate(to)})</h4>
            <div class="stats-row" style="margin-bottom:1rem;">
                <div class="stat-card"><div class="stat-value">${res.invoice_count ?? rows.length}</div><div class="stat-label">Invoices</div></div>
                <div class="stat-card"><div class="stat-value">${AccountsCommon.formatCurrency(res.total_taxable ?? 0)}</div><div class="stat-label">Total Taxable</div></div>
                <div class="stat-card"><div class="stat-value">${AccountsCommon.formatCurrency(res.total_tax ?? 0)}</div><div class="stat-label">Total Tax</div></div>
            </div>
            <div class="data-table-container"><table class="data-table">
                <thead><tr><th>Party</th><th>Date</th><th>Party Tax ID</th><th>Taxable Amount</th><th>Tax Amount</th><th>Total</th></tr></thead>
                <tbody>${rows.map(r => `<tr>
                    <td>${AccountsCommon.escapeHtml(r.party_name || '-')}</td>
                    <td>${AccountsCommon.formatDate(r.transaction_date)}</td>
                    <td>${AccountsCommon.escapeHtml(r.party_tax_id || '-')}</td>
                    <td class="text-right">${AccountsCommon.formatCurrency(r.taxable_amount)}</td>
                    <td class="text-right">${AccountsCommon.formatCurrency(r.tax_amount)}</td>
                    <td class="text-right">${AccountsCommon.formatCurrency((r.taxable_amount || 0) + (r.tax_amount || 0))}</td>
                </tr>`).join('')}</tbody>
            </table></div></div>`;
    } catch (err) {
        console.error('[Taxation] generateGSTR1 error:', err);
        Toast.error(err.message || 'Failed to generate GSTR-1 report');
        area.innerHTML = `<div class="glass-card-body"><div class="empty-message"><p>Failed to generate report</p></div></div>`;
    }
}

// ============================================================================
// 5. GSTR-3B
// ============================================================================

async function generateGSTR3B() {
    const from = document.getElementById('gstr3bFrom')?.value;
    const to = document.getElementById('gstr3bTo')?.value;
    if (!from || !to) {
        Toast.error('Please select both From and To dates');
        return;
    }

    const area = document.getElementById('gstr3bReportArea');
    try {
        const url = AccountsCommon.buildUrl('tax/reports/gstr3b', { fromDate: from, toDate: to });
        const res = await api.request(url);
        // Response: { report, period, outward_supplies: {taxable, tax, count}, inward_supplies: {taxable, tax, count}, net_tax_payable }
        if (!res?.outward_supplies && !res?.inward_supplies) {
            area.innerHTML = `<div class="glass-card-body"><div class="empty-message"><p>No GSTR-3B data found for the selected period</p></div></div>`;
            return;
        }

        area.innerHTML = `<div class="glass-card-body">
            <h4 style="margin-bottom:1rem;">GSTR-3B Summary (${AccountsCommon.formatDate(from)} - ${AccountsCommon.formatDate(to)})</h4>
            <div class="stats-row">
                <div class="stat-card"><div class="stat-value">${AccountsCommon.formatCurrency(res.outward_supplies?.tax || 0)}</div><div class="stat-label">Output Tax (${res.outward_supplies?.count ?? 0} txns)</div></div>
                <div class="stat-card"><div class="stat-value">${AccountsCommon.formatCurrency(res.inward_supplies?.tax || 0)}</div><div class="stat-label">Input Tax Credit (${res.inward_supplies?.count ?? 0} txns)</div></div>
                <div class="stat-card"><div class="stat-value">${AccountsCommon.formatCurrency(res.net_tax_payable || 0)}</div><div class="stat-label">Net Tax Payable</div></div>
            </div></div>`;
    } catch (err) {
        console.error('[Taxation] generateGSTR3B error:', err);
        Toast.error(err.message || 'Failed to generate GSTR-3B report');
        area.innerHTML = `<div class="glass-card-body"><div class="empty-message"><p>Failed to generate report</p></div></div>`;
    }
}

// ============================================================================
// 6. TDS RETURN
// ============================================================================

async function generateTDSReturn() {
    const from = document.getElementById('tdsFrom')?.value;
    const to = document.getElementById('tdsTo')?.value;
    if (!from || !to) {
        Toast.error('Please select both From and To dates');
        return;
    }

    const area = document.getElementById('tdsReportArea');
    try {
        const url = AccountsCommon.buildUrl('tax/reports/tds', { fromDate: from, toDate: to });
        const res = await api.request(url);
        // Response: { report, period, deductions: [{party_name, party_tax_id, taxable_amount, tax_amount, transaction_date}], total_tds, deductee_count }
        const rows = res?.deductions || [];

        if (!rows.length) {
            area.innerHTML = `<div class="glass-card-body"><div class="empty-message"><p>No TDS data found for the selected period</p></div></div>`;
            return;
        }

        area.innerHTML = `<div class="glass-card-body">
            <h4 style="margin-bottom:1rem;">TDS Return (${AccountsCommon.formatDate(from)} - ${AccountsCommon.formatDate(to)})</h4>
            <div class="stats-row" style="margin-bottom:1rem;">
                <div class="stat-card"><div class="stat-value">${res.deductee_count ?? rows.length}</div><div class="stat-label">Deductees</div></div>
                <div class="stat-card"><div class="stat-value">${AccountsCommon.formatCurrency(res.total_tds ?? 0)}</div><div class="stat-label">Total TDS</div></div>
            </div>
            <div class="data-table-container"><table class="data-table">
                <thead><tr><th>Deductee</th><th>PAN / Tax ID</th><th>Amount Paid</th><th>TDS Deducted</th><th>Date</th></tr></thead>
                <tbody>${rows.map(r => `<tr>
                    <td>${AccountsCommon.escapeHtml(r.party_name || '-')}</td>
                    <td>${AccountsCommon.escapeHtml(r.party_tax_id || '-')}</td>
                    <td class="text-right">${AccountsCommon.formatCurrency(r.taxable_amount)}</td>
                    <td class="text-right">${AccountsCommon.formatCurrency(r.tax_amount)}</td>
                    <td>${AccountsCommon.formatDate(r.transaction_date)}</td>
                </tr>`).join('')}</tbody>
            </table></div></div>`;
    } catch (err) {
        console.error('[Taxation] generateTDSReturn error:', err);
        Toast.error(err.message || 'Failed to generate TDS return');
        area.innerHTML = `<div class="glass-card-body"><div class="empty-message"><p>Failed to generate report</p></div></div>`;
    }
}

// ============================================================================
// 7. TAX CALCULATOR
// ============================================================================

function populateCalcConfigSelect() {
    const sel = document.getElementById('calcTaxConfig');
    if (!sel) return;
    sel.innerHTML = '<option value="">Select tax config...</option>' +
        taxConfigs.map(c => `<option value="${c.id}">${AccountsCommon.escapeHtml(c.name)} (${c.configuration?.total_rate ?? c.rate ?? ''}%)</option>`).join('');
}

async function calculateTax() {
    const amount = parseFloat(document.getElementById('calcAmount').value);
    const taxConfigId = document.getElementById('calcTaxConfig').value;
    const sellerState = document.getElementById('calcSellerState').value.trim();
    const buyerState = document.getElementById('calcBuyerState').value.trim();

    if (isNaN(amount) || !taxConfigId) {
        Toast.error('Amount and Tax Config are required');
        return;
    }

    const resultCard = document.getElementById('taxCalcResult');
    const resultBody = document.getElementById('taxCalcResultBody');

    try {
        const payload = { taxable_amount: amount, tax_configuration_id: taxConfigId, transaction_type: 'sales', seller_state_code: sellerState || null, buyer_state_code: buyerState || null };
        const url = AccountsCommon.buildUrl('tax/calculate');
        const res = await api.request(url, { method: 'POST', body: JSON.stringify(payload) });
        // Response: { total_tax, taxable_amount, tax_configuration_id, tax_configuration_name, tax_lines: [{name, rate, amount, account_id, account_code}] }
        const data = res?.data || res;

        resultCard.style.display = 'block';

        const totalTax = data.total_tax ?? 0;
        const taxableAmt = data.taxable_amount ?? amount;
        const breakdownRows = (data.tax_lines || []).map(b =>
            `<tr><td>${AccountsCommon.escapeHtml(b.name)}</td><td>${b.rate != null ? b.rate + '%' : '-'}</td><td class="text-right">${AccountsCommon.formatCurrency(b.amount)}</td></tr>`
        ).join('');

        resultBody.innerHTML = `
            <h4 style="margin-bottom:1rem;">Tax Calculation Result${data.tax_configuration_name ? ` — ${AccountsCommon.escapeHtml(data.tax_configuration_name)}` : ''}</h4>
            <div class="stats-row">
                <div class="stat-card"><div class="stat-value">${AccountsCommon.formatCurrency(taxableAmt)}</div><div class="stat-label">Taxable Amount</div></div>
                <div class="stat-card"><div class="stat-value">${AccountsCommon.formatCurrency(totalTax)}</div><div class="stat-label">Tax Amount</div></div>
                <div class="stat-card"><div class="stat-value">${AccountsCommon.formatCurrency(taxableAmt + totalTax)}</div><div class="stat-label">Total</div></div>
            </div>
            ${breakdownRows ? `<div class="data-table-container" style="margin-top:1rem;"><table class="data-table">
                <thead><tr><th>Component</th><th>Rate</th><th>Amount</th></tr></thead>
                <tbody>${breakdownRows}</tbody>
            </table></div>` : ''}`;
    } catch (err) {
        console.error('[Taxation] calculateTax error:', err);
        Toast.error(err.message || 'Failed to calculate tax');
        resultCard.style.display = 'block';
        resultBody.innerHTML = `<div class="empty-message"><p>Calculation failed. Please check inputs and try again.</p></div>`;
    }
}

// ============================================================================
// 8. TAX LEDGER
// ============================================================================

async function loadTaxLedger() {
    try {
        const txnType = document.getElementById('ledgerTxnTypeFilter')?.value || '';
        const from = document.getElementById('ledgerFrom')?.value || '';
        const to = document.getElementById('ledgerTo')?.value || '';

        const params = { limit: PAGE_SIZE, offset: (taxLedgerPage - 1) * PAGE_SIZE };
        if (txnType) params.transactionType = txnType;
        if (from) params.fromDate = from;
        if (to) params.toDate = to;

        const url = AccountsCommon.buildUrl('tax/ledger', params);
        const res = await api.request(url, { _skipSpinner: true });
        taxLedgerEntries = Array.isArray(res) ? res : (res?.data || res?.items || []);
        const total = res?.total || res?.totalCount || taxLedgerEntries.length;
        const totalPages = Math.ceil(total / PAGE_SIZE) || 1;

        renderTaxLedger();
        AccountsCommon.renderPagination('taxLedgerPagination', taxLedgerPage, totalPages, (page) => {
            taxLedgerPage = page;
            loadTaxLedger();
        });
    } catch (err) {
        console.error('[Taxation] loadTaxLedger error:', err);
        Toast.error('Failed to load tax ledger');
    }
}

function renderTaxLedger() {
    const tbody = document.getElementById('taxLedgerTable');
    if (!tbody) return;

    if (!taxLedgerEntries.length) {
        tbody.innerHTML = `<tr class="empty-state"><td colspan="7"><div class="empty-message">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">
                <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path>
                <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path>
            </svg><p>No tax ledger entries found</p></div></td></tr>`;
        return;
    }

    tbody.innerHTML = taxLedgerEntries.map(e => {
        const total = parseFloat(e.taxable_amount || 0) + parseFloat(e.tax_amount || 0);
        return `<tr>
            <td>${AccountsCommon.formatDate(e.transaction_date || e.date)}</td>
            <td>${AccountsCommon.escapeHtml(e.party_name || e.reference || '-')}</td>
            <td>${AccountsCommon.escapeHtml(e.transaction_type || '-')}</td>
            <td>${AccountsCommon.escapeHtml(e.tax_config_name || taxConfigs.find(c => c.id === e.tax_configuration_id)?.name || '-')}</td>
            <td class="text-right">${AccountsCommon.formatCurrency(e.taxable_amount)}</td>
            <td class="text-right">${AccountsCommon.formatCurrency(e.tax_amount)}</td>
            <td class="text-right">${AccountsCommon.formatCurrency(total)}</td>
        </tr>`;
    }).join('');
}
