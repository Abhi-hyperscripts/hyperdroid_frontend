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
        case 'gstr-1':          break;
        case 'gstr-3b':         break;
        case 'tds-return':      break;
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

    rateConfigFilterDropdown = new SearchableDropdown({
        container: document.getElementById('rateConfigFilterContainer'),
        placeholder: 'Filter by config...',
        options: [{ value: '', label: 'All Configs' }, ...configOptions],
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
        const search = document.getElementById('taxConfigSearch')?.value || '';
        const params = {};
        if (search) params.search = search;

        const url = AccountsCommon.buildUrl('tax/configurations', params);
        const res = await api.request(url, { _skipSpinner: true });
        taxConfigs = Array.isArray(res) ? res : (res?.data || res?.items || []);
        renderTaxConfigs();
    } catch (err) {
        console.error('[Taxation] loadTaxConfigs error:', err);
        Toast.error('Failed to load tax configs');
    }
}

function renderTaxConfigs() {
    const tbody = document.getElementById('taxConfigsTable');
    if (!tbody) return;

    if (!taxConfigs.length) {
        tbody.innerHTML = `<tr class="empty-state"><td colspan="6"><div class="empty-message">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">
                <circle cx="12" cy="12" r="3"></circle>
            </svg><p>No tax configs found</p></div></td></tr>`;
        return;
    }

    tbody.innerHTML = taxConfigs.map(c => {
        const status = c.status || (c.is_active === false ? 'inactive' : 'active');
        const actions = accountsRoles.isAdmin()
            ? `<button class="btn-icon" onclick="editTaxConfig('${c.id}')" data-tooltip="Edit"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
               <button class="btn-icon danger" onclick="deleteTaxConfig('${c.id}')" data-tooltip="Delete"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>`
            : '-';

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

function showCreateTaxConfigModal() {
    document.getElementById('taxConfigModalTitle').textContent = 'Create Tax Config';
    document.getElementById('taxConfigForm').reset();
    document.getElementById('taxConfigId').value = '';
    document.getElementById('taxConfigStatus').value = 'active';
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
        const configFilter = rateConfigFilterDropdown?.getValue?.() || '';
        const params = {};
        if (search) params.search = search;
        if (configFilter) params.configId = configFilter;

        const url = AccountsCommon.buildUrl('tax/rates', params);
        const res = await api.request(url, { _skipSpinner: true });
        taxRates = Array.isArray(res) ? res : (res?.data || res?.items || []);
        renderTaxRates();
    } catch (err) {
        console.error('[Taxation] loadTaxRates error:', err);
        Toast.error('Failed to load tax rates');
    }
}

function renderTaxRates() {
    const tbody = document.getElementById('taxRatesTable');
    if (!tbody) return;

    if (!taxRates.length) {
        tbody.innerHTML = `<tr class="empty-state"><td colspan="5"><div class="empty-message">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">
                <line x1="19" y1="5" x2="5" y2="19"></line>
                <circle cx="6.5" cy="6.5" r="2.5"></circle>
                <circle cx="17.5" cy="17.5" r="2.5"></circle>
            </svg><p>No tax rates configured</p></div></td></tr>`;
        return;
    }

    tbody.innerHTML = taxRates.map(r => {
        const status = r.status || (r.is_active === false ? 'inactive' : 'active');
        const actions = accountsRoles.isAdmin()
            ? `<button class="btn-icon" onclick="editTaxRate('${r.id}')" data-tooltip="Edit"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
               <button class="btn-icon danger" onclick="deleteTaxRate('${r.id}')" data-tooltip="Delete"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>`
            : '-';

        return `<tr>
            <td>${AccountsCommon.escapeHtml(r.name)}</td>
            <td>${r.rate != null ? r.rate + '%' : '-'}</td>
            <td>${AccountsCommon.escapeHtml(r.account_name || '-')}</td>
            <td>${AccountsCommon.statusBadge(status)}</td>
            <td class="actions-cell">${actions}</td>
        </tr>`;
    }).join('');
}

function showCreateTaxRateModal() {
    document.getElementById('taxRateModalTitle').textContent = 'Create Tax Rate';
    document.getElementById('taxRateForm').reset();
    document.getElementById('taxRateId').value = '';
    document.getElementById('taxRateStatus').value = 'active';
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
    document.getElementById('taxRateStatus').value = rate.status || 'active';
    populateTaxRateConfigSelect(rate.tax_config_id);
    populateTaxRateAccountSelect(rate.account_id);
    AccountsCommon.openModal('taxRateModal');
}

async function saveTaxRate() {
    const id = document.getElementById('taxRateId').value;
    const name = document.getElementById('taxRateName').value.trim();
    const rate = parseFloat(document.getElementById('taxRatePercent').value);
    const tax_config_id = document.getElementById('taxRateConfig').value;
    const account_id = document.getElementById('taxRateAccount').value || null;
    const status = document.getElementById('taxRateStatus').value;

    if (!name || isNaN(rate) || !tax_config_id) {
        Toast.error('Name, Rate, and Tax Config are required');
        return;
    }

    const payload = { name, rate, tax_config_id, account_id, status };

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
            accounts.map(a => `<option value="${a.id}" ${a.id === selectedValue ? 'selected' : ''}>${AccountsCommon.escapeHtml(a.code ? a.code + ' - ' + a.name : a.name)}</option>`).join('');
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
        hsnSacCodes = Array.isArray(res) ? res : (res?.data || res?.items || []);
        const total = res?.total || res?.totalCount || hsnSacCodes.length;
        const totalPages = Math.ceil(total / PAGE_SIZE) || 1;

        renderHsnSacCodes();
        AccountsCommon.renderPagination('hsnSacPagination', hsnSacPage, totalPages, (page) => {
            hsnSacPage = page;
            loadHsnSacCodes();
        });
    } catch (err) {
        console.error('[Taxation] loadHsnSacCodes error:', err);
        Toast.error('Failed to load HSN/SAC codes');
    }
}

function renderHsnSacCodes() {
    const tbody = document.getElementById('hsnSacTable');
    if (!tbody) return;

    if (!hsnSacCodes.length) {
        tbody.innerHTML = `<tr class="empty-state"><td colspan="5"><div class="empty-message">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">
                <polyline points="16 18 22 12 16 6"></polyline>
                <polyline points="8 6 2 12 8 18"></polyline>
            </svg><p>No HSN/SAC codes found</p></div></td></tr>`;
        return;
    }

    tbody.innerHTML = hsnSacCodes.map(h => {
        const actions = accountsRoles.isAdmin()
            ? `<button class="btn-icon" onclick="editHsnSac('${h.id}')" data-tooltip="Edit"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
               <button class="btn-icon danger" onclick="deleteHsnSac('${h.id}')" data-tooltip="Delete"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>`
            : '-';

        return `<tr>
            <td><code>${AccountsCommon.escapeHtml(h.code)}</code></td>
            <td>${AccountsCommon.escapeHtml(h.description || '-')}</td>
            <td><span class="badge ${h.type === 'HSN' ? 'status-active' : 'status-pending'}">${AccountsCommon.escapeHtml(h.type || '-')}</span></td>
            <td>${h.tax_rate != null ? h.tax_rate + '%' : '-'}</td>
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
    document.getElementById('hsnSacType').value = h.type || '';
    document.getElementById('hsnSacDescription').value = h.description || '';
    document.getElementById('hsnSacTaxRate').value = h.tax_rate ?? '';
    AccountsCommon.openModal('hsnSacModal');
}

async function saveHsnSac() {
    const id = document.getElementById('hsnSacId').value;
    const code = document.getElementById('hsnSacCode').value.trim();
    const type = document.getElementById('hsnSacType').value;
    const description = document.getElementById('hsnSacDescription').value.trim();
    const tax_rate = document.getElementById('hsnSacTaxRate').value ? parseFloat(document.getElementById('hsnSacTaxRate').value) : null;

    if (!code || !type || !description) {
        Toast.error('Code, Type, and Description are required');
        return;
    }

    const payload = { code, type, description, tax_rate };

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
        const data = res?.data || res;

        if (!data || (Array.isArray(data) && !data.length)) {
            area.innerHTML = `<div class="glass-card-body"><div class="empty-message"><p>No GSTR-1 data found for the selected period</p></div></div>`;
            return;
        }

        area.innerHTML = `<div class="glass-card-body">
            <h4 style="margin-bottom:1rem;">GSTR-1 Report (${AccountsCommon.formatDate(from)} - ${AccountsCommon.formatDate(to)})</h4>
            <div class="data-table-container"><table class="data-table">
                <thead><tr><th>Invoice No</th><th>Date</th><th>Customer</th><th>Taxable Value</th><th>Tax Amount</th><th>Total</th></tr></thead>
                <tbody>${(Array.isArray(data) ? data : [data]).map(r => `<tr>
                    <td>${AccountsCommon.escapeHtml(r.invoice_number || '-')}</td>
                    <td>${AccountsCommon.formatDate(r.date)}</td>
                    <td>${AccountsCommon.escapeHtml(r.customer_name || '-')}</td>
                    <td class="text-right">${AccountsCommon.formatCurrency(r.taxable_value)}</td>
                    <td class="text-right">${AccountsCommon.formatCurrency(r.tax_amount)}</td>
                    <td class="text-right">${AccountsCommon.formatCurrency(r.total)}</td>
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
        const data = res?.data || res;

        if (!data || (Array.isArray(data) && !data.length)) {
            area.innerHTML = `<div class="glass-card-body"><div class="empty-message"><p>No GSTR-3B data found for the selected period</p></div></div>`;
            return;
        }

        area.innerHTML = `<div class="glass-card-body">
            <h4 style="margin-bottom:1rem;">GSTR-3B Summary (${AccountsCommon.formatDate(from)} - ${AccountsCommon.formatDate(to)})</h4>
            <div class="stats-row">
                <div class="stat-card"><div class="stat-value">${AccountsCommon.formatCurrency(data.output_tax || 0)}</div><div class="stat-label">Output Tax</div></div>
                <div class="stat-card"><div class="stat-value">${AccountsCommon.formatCurrency(data.input_tax || 0)}</div><div class="stat-label">Input Tax Credit</div></div>
                <div class="stat-card"><div class="stat-value">${AccountsCommon.formatCurrency(data.net_payable || 0)}</div><div class="stat-label">Net Tax Payable</div></div>
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
        const data = res?.data || res;

        if (!data || (Array.isArray(data) && !data.length)) {
            area.innerHTML = `<div class="glass-card-body"><div class="empty-message"><p>No TDS data found for the selected period</p></div></div>`;
            return;
        }

        area.innerHTML = `<div class="glass-card-body">
            <h4 style="margin-bottom:1rem;">TDS Return (${AccountsCommon.formatDate(from)} - ${AccountsCommon.formatDate(to)})</h4>
            <div class="data-table-container"><table class="data-table">
                <thead><tr><th>Deductee</th><th>Section</th><th>Amount Paid</th><th>TDS Deducted</th><th>Date</th></tr></thead>
                <tbody>${(Array.isArray(data) ? data : [data]).map(r => `<tr>
                    <td>${AccountsCommon.escapeHtml(r.deductee_name || '-')}</td>
                    <td>${AccountsCommon.escapeHtml(r.section || '-')}</td>
                    <td class="text-right">${AccountsCommon.formatCurrency(r.amount_paid)}</td>
                    <td class="text-right">${AccountsCommon.formatCurrency(r.tds_deducted)}</td>
                    <td>${AccountsCommon.formatDate(r.date)}</td>
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
        const data = res?.data || res;

        resultCard.style.display = 'block';

        const breakdownRows = (data.breakdown || []).map(b =>
            `<tr><td>${AccountsCommon.escapeHtml(b.name || b.component)}</td><td>${b.rate != null ? b.rate + '%' : '-'}</td><td class="text-right">${AccountsCommon.formatCurrency(b.amount)}</td></tr>`
        ).join('');

        resultBody.innerHTML = `
            <h4 style="margin-bottom:1rem;">Tax Calculation Result</h4>
            <div class="stats-row">
                <div class="stat-card"><div class="stat-value">${AccountsCommon.formatCurrency(data.taxable_amount || amount)}</div><div class="stat-label">Taxable Amount</div></div>
                <div class="stat-card"><div class="stat-value">${AccountsCommon.formatCurrency(data.tax_amount || 0)}</div><div class="stat-label">Tax Amount</div></div>
                <div class="stat-card"><div class="stat-value">${AccountsCommon.formatCurrency(data.total_amount || 0)}</div><div class="stat-label">Total</div></div>
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
