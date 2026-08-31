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
        'gstr-2b': 'GSTR-2B Match',
        'tds-return': 'TDS Return',
        'e-invoicing': 'e-Invoicing (IRP)',
        'tax-calculator': 'Tax Calculator',
        'tax-ledger': 'Tax Ledger'
    };

    AccountsCommon.setupSidebar('sidebarToggle', 'accountsSidebar', 'sidebarOverlay', tabNames);
    AccountsCommon.setupTabs(tabNames, onTabSwitch);
    accountsRoles.applyRBAC();

    await loadInitialData();
    AccountsCommon.initSearchableDropdownsWithRetry(initDropdowns);
    setupSearchListeners();
    initDatePickers();
});

// Shared theme-aware chart re-render hook (set by whichever report is on screen;
// a MutationObserver in accounts-charts.js calls it on light/dark toggle).
// Reset on every tab switch so a stale renderer doesn't fire for the wrong tab.

function initDatePickers() {
    const fpConfig = { dateFormat: 'Y-m-d', allowInput: true };
    const initWhenReady = () => {
        if (typeof flatpickr !== 'function') { setTimeout(initWhenReady, 200); return; }
        ['gstr1From', 'gstr1To', 'gstr3bFrom', 'gstr3bTo', 'tdsFrom', 'tdsTo'].forEach(id => {
            if (document.getElementById(id)) flatpickr('#' + id, fpConfig);
        });
        // Tax Ledger date pickers re-query on change (native onchange was dropped in the flatpickr swap)
        const ledgerOnChange = () => { taxLedgerPage = 1; loadTaxLedger(); };
        if (document.getElementById('ledgerFrom')) flatpickr('#ledgerFrom', { ...fpConfig, onChange: ledgerOnChange });
        if (document.getElementById('ledgerTo')) flatpickr('#ledgerTo', { ...fpConfig, onChange: ledgerOnChange });
    };
    initWhenReady();
}

// ============================================================================
// TAB SWITCH HANDLER
// ============================================================================

function onTabSwitch(tabId) {
    // Drop any prior tab's chart re-render hook before the new tab renders its own.
    if (typeof _acActiveRender !== 'undefined') _acActiveRender = null;
    switch (tabId) {
        case 'tax-config':      loadTaxConfigs(); break;
        case 'tax-rates':       loadTaxRates(); break;
        case 'hsn-sac':         loadHsnSacCodes(); break;
        case 'gstr-1':
            setDefaultDatesAndGenerate('gstr1From', 'gstr1To', generateGSTR1);
            // Default the portal-JSON month to the last completed month (what's due for filing).
            { const m = document.getElementById('gstr1Month'); if (m && !m.value) { const d = new Date(); d.setMonth(d.getMonth() - 1); m.value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; } }
            break;
        case 'gstr-3b':
            setDefaultDatesAndGenerate('gstr3bFrom', 'gstr3bTo', generateGSTR3B);
            // Same default as GSTR-1: the last COMPLETED month, which is what is actually due.
            { const m = document.getElementById('gstr3bMonth'); if (m && !m.value) { const d = new Date(); d.setMonth(d.getMonth() - 1); m.value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; } }
            break;
        case 'gstr-2b':
            // Default to the last COMPLETED month — 2B for the current month does not exist yet.
            { const m = document.getElementById('gstr2bMonth'); if (m && !m.value) { const d = new Date(); d.setMonth(d.getMonth() - 1); m.value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; } }
            break;
        case 'tds-return':      setDefaultDatesAndGenerate('tdsFrom', 'tdsTo', generateTDSReturn); break;
        case 'e-invoicing':     loadEInvoiceSettings(); break;
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
    // Backend emits is_active (there is no top-level status field) — map it to the Status control.
    document.getElementById('taxConfigStatus').value = cfg.is_active === false ? 'inactive' : 'active';
    // Description lives inside the configuration JSON, not at top level.
    document.getElementById('taxConfigDescription').value = cfg.description || cfg.configuration?.description || '';
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

    let payload;
    if (id) {
        // MERGE into the existing configuration JSON — replacing it wholesale would wipe
        // structural keys like intra_state_split / inter_state that the form doesn't edit.
        const existing = taxConfigs.find(c => c.id === id);
        const configuration = { ...(existing?.configuration || {}), total_rate: rate, description };
        payload = { name, is_active: status !== 'inactive', configuration };
    } else {
        payload = { name, country_code: country, tax_type, configuration: { total_rate: rate, description }, effective_from: AccountsCommon.todayLocal() };
    }

    if (!AccountsCommon.beginSubmit('saveTaxConfig')) return;
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
    } finally {
        AccountsCommon.endSubmit('saveTaxConfig');
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

    if (!AccountsCommon.beginSubmit('saveTaxRate')) return;
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
    } finally {
        AccountsCommon.endSubmit('saveTaxRate');
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

    if (!AccountsCommon.beginSubmit('saveHsnSac')) return;
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
    } finally {
        AccountsCommon.endSubmit('saveHsnSac');
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
        const fromVal = `${fyStart.getFullYear()}-${pad(fyStart.getMonth() + 1)}-${pad(fyStart.getDate())}`;
        const toVal = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
        // Prefer flatpickr's API so the visible input + internal state stay in sync;
        // fall back to raw .value for any input that isn't flatpickr-backed.
        if (fromEl._flatpickr) fromEl._flatpickr.setDate(fromVal, false); else fromEl.value = fromVal;
        if (toEl._flatpickr) toEl._flatpickr.setDate(toVal, false); else toEl.value = toVal;
    }

    generateFn();
}

// ============================================================================
// 4. GSTR-1
// ============================================================================

/**
 * Build + download the GSTN-portal-uploadable GSTR-1 JSON for the selected return month.
 * The backend assembles the b2b/b2cl/b2cs/exp/cdnr/hsn/doc_issue sections from approved
 * invoices and credit notes; the downloaded file imports straight into the GST portal /
 * offline tool. A summary of what went into the file is shown for review before filing.
 */
async function downloadGstr1Json() {
    const monthInput = document.getElementById('gstr1Month')?.value; // YYYY-MM
    if (!monthInput) { Toast.error('Pick the return month first'); return; }
    const [year, month] = monthInput.split('-').map(Number);
    try {
        const url = AccountsCommon.buildUrl('tax/reports/gstr1-json', { year, month });
        const res = await api.request(url);
        // Download the portal payload as a .json file.
        const blob = new Blob([JSON.stringify(res.payload, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = res.file_name;
        a.click();
        URL.revokeObjectURL(a.href);

        // Render the review summary so what's inside the file is visible before upload.
        const s = res.summary || {};
        const area = document.getElementById('gstr1ReportArea');
        const warn = s.lines_missing_hsn > 0
            ? `<p style="color:var(--color-warning);margin-top:0.5rem;">⚠ ${s.lines_missing_hsn} HSN row(s) have no HSN/SAC code — the portal may reject Table 12. Set HSN codes on the items/lines and re-export.</p>` : '';
        const tile = (label, value) => `
            <div style="background:var(--bg-tertiary);border:1px solid var(--border-color);border-radius:10px;padding:0.65rem 0.85rem;">
                <div style="font-size:0.72rem;color:var(--text-secondary);text-transform:uppercase;letter-spacing:0.04em;">${label}</div>
                <div style="font-size:1.15rem;font-weight:700;color:var(--text-primary);margin-top:2px;">${value}</div>
            </div>`;
        area.innerHTML = `
            <div class="glass-card-header"><h3>Portal JSON built — ${AccountsCommon.escapeHtml(res.file_name)}</h3></div>
            <div class="glass-card-body">
                <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:0.75rem;">
                    ${tile('B2B invoices', `${s.b2b_invoices ?? 0} <small>(${s.b2b_parties ?? 0} parties)</small>`)}
                    ${tile('B2C large', s.b2cl_invoices ?? 0)}
                    ${tile('B2C small rows', s.b2cs_rows ?? 0)}
                    ${tile('Exports', s.export_invoices ?? 0)}
                    ${tile('Credit notes', s.cdnr_notes ?? 0)}
                    ${tile('Taxable value', '₹' + Number(s.total_taxable || 0).toLocaleString('en-IN'))}
                    ${tile('Total tax', '₹' + Number(s.total_tax || 0).toLocaleString('en-IN'))}
                    ${tile('Cancelled docs', s.cancelled_count ?? 0)}
                </div>
                ${warn}
                <p style="color:var(--text-secondary);margin-top:0.75rem;font-size:0.85rem;">
                    Upload at gst.gov.in → Returns → GSTR-1 → Prepare Offline → Upload JSON, review, then file with EVC/DSC.
                </p>
            </div>`;
        Toast.success('GSTR-1 portal JSON downloaded');
    } catch (err) {
        Toast.error(err?.message || 'GSTR-1 JSON export failed');
    }
}

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
            <div class="acc-charts">
                <div class="acc-chart-card">
                    <h4>Outward supplies by party</h4>
                    <div class="acc-chart-sub">Net taxable value per customer (negatives = credit notes)</div>
                    <div id="gstr1PartyChart" class="acc-chart"></div>
                </div>
                <div class="acc-chart-card">
                    <h4>Taxable vs tax</h4>
                    <div class="acc-chart-sub">Total taxable value against GST collected</div>
                    <div id="gstr1TaxSplitChart" class="acc-chart"></div>
                </div>
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

        // Aggregate net taxable value per party for the breakdown bar.
        const byParty = {};
        rows.forEach(r => {
            const name = r.party_name || 'Unknown';
            byParty[name] = (byParty[name] || 0) + (parseFloat(r.taxable_amount) || 0);
        });
        const partyRanked = Object.entries(byParty)
            .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 8);
        const draw = () => {
            if (typeof acBarH === 'function' && partyRanked.length) {
                acBarH('gstr1PartyChart', partyRanked.map(p => p[0]), partyRanked.map(p => Math.round(p[1] * 100) / 100));
            }
            if (typeof acBarV === 'function') {
                acBarV('gstr1TaxSplitChart', ['Taxable', 'Tax'],
                    [Math.round((res.total_taxable || 0) * 100) / 100, Math.round((res.total_tax || 0) * 100) / 100],
                    ['#3b82f6', '#10b981']);
            }
        };
        draw();
        if (typeof _acActiveRender !== 'undefined') _acActiveRender = draw;
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

        const outputTax = parseFloat(res.outward_supplies?.tax || 0);
        const inputCredit = parseFloat(res.inward_supplies?.tax || 0);
        const netPayable = parseFloat(res.net_tax_payable || 0);

        area.innerHTML = `<div class="glass-card-body">
            <h4 style="margin-bottom:1rem;">GSTR-3B Summary (${AccountsCommon.formatDate(from)} - ${AccountsCommon.formatDate(to)})</h4>
            <div class="stats-row" style="margin-bottom:1rem;">
                <div class="stat-card"><div class="stat-value">${AccountsCommon.formatCurrency(outputTax)}</div><div class="stat-label">Output Tax (${res.outward_supplies?.count ?? 0} txns)</div></div>
                <div class="stat-card"><div class="stat-value">${AccountsCommon.formatCurrency(inputCredit)}</div><div class="stat-label">Input Tax Credit (${res.inward_supplies?.count ?? 0} txns)</div></div>
                <div class="stat-card"><div class="stat-value">${AccountsCommon.formatCurrency(netPayable)}</div><div class="stat-label">Net Tax Payable</div></div>
            </div>
            <div class="acc-charts" style="grid-template-columns: 1fr;">
                <div class="acc-chart-card">
                    <h4>Output tax vs input credit</h4>
                    <div class="acc-chart-sub">Net GST payable = output tax collected − input tax credit claimed</div>
                    <div id="gstr3bChart" class="acc-chart"></div>
                </div>
            </div></div>`;

        const draw = () => {
            if (typeof acBarV === 'function') {
                acBarV('gstr3bChart', ['Output tax', 'Input credit', 'Net payable'],
                    [Math.round(outputTax * 100) / 100, Math.round(inputCredit * 100) / 100, Math.round(netPayable * 100) / 100],
                    ['#ef4444', '#10b981', '#3b82f6']);
            }
        };
        draw();
        if (typeof _acActiveRender !== 'undefined') _acActiveRender = draw;
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
            <div class="acc-charts" style="grid-template-columns: 1fr;">
                <div class="acc-chart-card">
                    <h4>TDS deducted by deductee</h4>
                    <div class="acc-chart-sub">Tax withheld per party for the period</div>
                    <div id="tdsDeducteeChart" class="acc-chart"></div>
                </div>
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

        // Aggregate TDS deducted per deductee for the breakdown bar.
        const byDeductee = {};
        rows.forEach(r => {
            const name = r.party_name || 'Unknown';
            byDeductee[name] = (byDeductee[name] || 0) + (parseFloat(r.tax_amount) || 0);
        });
        const deducteeRanked = Object.entries(byDeductee)
            .filter(d => d[1] !== 0).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 8);
        const draw = () => {
            if (typeof acBarH === 'function' && deducteeRanked.length) {
                acBarH('tdsDeducteeChart', deducteeRanked.map(d => d[0]), deducteeRanked.map(d => Math.round(d[1] * 100) / 100));
            } else if (typeof _acEmpty === 'function') {
                _acEmpty('tdsDeducteeChart', 'No TDS deducted in this period');
            }
        };
        draw();
        if (typeof _acActiveRender !== 'undefined') _acActiveRender = draw;
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
    // GST calculation requires both state codes to decide intra-state (CGST+SGST) vs
    // inter-state (IGST) — the backend rejects the request without them.
    if (!sellerState || !buyerState) {
        Toast.error('Seller and Buyer state codes are required (e.g., 27 for Maharashtra)');
        return;
    }

    const resultCard = document.getElementById('taxCalcResult');
    const resultBody = document.getElementById('taxCalcResultBody');

    try {
        const payload = { taxable_amount: amount, tax_configuration_id: taxConfigId, transaction_type: 'sales', seller_state_code: sellerState, buyer_state_code: buyerState };
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
        // Backend returns { data, total } (total = filtered count); tolerate a bare array too.
        taxLedgerEntries = res?.data ?? (Array.isArray(res) ? res : []);
        const total = res?.total ?? res?.totalCount ?? taxLedgerEntries.length;
        const totalPages = Math.ceil(total / PAGE_SIZE) || 1;
        if (taxLedgerPage > totalPages) {
            // Filter change shrank the result set below the current offset — clamp and refetch.
            taxLedgerPage = totalPages;
            return loadTaxLedger();
        }

        renderTaxLedger();
        AccountsCommon.renderPagination('taxLedgerPagination', taxLedgerPage, totalPages, (page) => {
            taxLedgerPage = page;
            loadTaxLedger();
        });

        // Charts read the full matching set (dates respected; type filter ignored so the mix shows)
        const chartParams = {};
        if (from) chartParams.fromDate = from;
        if (to) chartParams.toDate = to;
        renderTaxLedgerCharts(chartParams);
        _acActiveRender = () => renderTaxLedgerCharts(chartParams);
    } catch (err) {
        console.error('[Taxation] loadTaxLedger error:', err);
        Toast.error('Failed to load tax ledger');
    }
}

// Tax-ledger charts — monthly output (sales) vs input (purchase) tax + mix by transaction type
async function renderTaxLedgerCharts(baseParams) {
    if (typeof acColumns !== 'function') return;
    try {
        const res = await api.request(AccountsCommon.buildUrl('tax/ledger', { ...baseParams, limit: 1000, offset: 0 }), { _skipSpinner: true });
        const all = res?.data ?? (Array.isArray(res) ? res : []);
        if (!all.length) { _acEmpty('taxFlowChart'); _acEmpty('taxTypeChart'); return; }
        const dateKey = all[0].transaction_date != null ? 'transaction_date' : 'date';
        const outM = _acMonthly(all.filter(e => e.transaction_type === 'sales'), dateKey, 'tax_amount', 6);
        const inM = _acMonthly(all.filter(e => e.transaction_type === 'purchase'), dateKey, 'tax_amount', 6);
        acColumns('taxFlowChart', outM.categories, [
            { name: 'Output tax', data: outM.data },
            { name: 'Input credit', data: inM.data }
        ], ['#ef4444', '#10b981']);
        // Output tax vs input credit across each tax type (radar). Two polygons — where output
        // stretches past input you're a net payer on that slab, and vice-versa. Falls back to the
        // transaction-type donut when there aren't ≥3 tax types to draw a readable polygon.
        const byCfg = {};
        all.forEach(e => {
            const name = e.tax_config_name || taxConfigs.find(c => c.id === e.tax_configuration_id)?.name || 'Other';
            const amt = parseFloat(e.tax_amount || 0);
            byCfg[name] = byCfg[name] || { out: 0, inp: 0 };
            if (e.transaction_type === 'sales') byCfg[name].out += amt;
            else if (e.transaction_type === 'purchase') byCfg[name].inp += amt;
        });
        const cfgNames = Object.keys(byCfg).filter(n => byCfg[n].out > 0 || byCfg[n].inp > 0)
            .sort((a, b) => (byCfg[b].out + byCfg[b].inp) - (byCfg[a].out + byCfg[a].inp)).slice(0, 8);
        if (cfgNames.length >= 3 && typeof acRadar === 'function') {
            acRadar('taxTypeChart', cfgNames, [
                { name: 'Output tax', data: cfgNames.map(n => Math.round(byCfg[n].out * 100) / 100) },
                { name: 'Input credit', data: cfgNames.map(n => Math.round(byCfg[n].inp * 100) / 100) }
            ], ['#ef4444', '#10b981']);
        } else {
            const label = (t) => ({ sales: 'Sales (output)', purchase: 'Purchase (input)', tds_deducted: 'TDS deducted', tds_collected: 'TDS collected', tcs_collected: 'TCS collected' })[t] || (t || 'Other');
            const byType = {};
            all.forEach(e => { const k = label(e.transaction_type); byType[k] = (byType[k] || 0) + parseFloat(e.tax_amount || 0); });
            const types = Object.keys(byType).filter(k => byType[k] > 0).sort();
            types.length
                ? acDonut('taxTypeChart', types, types.map(k => Math.round(byType[k] * 100) / 100),
                          types.map((k, i) => _acPalette[i % _acPalette.length]))
                : _acEmpty('taxTypeChart');
        }
    } catch (err) {
        console.error('[Taxation] renderTaxLedgerCharts error:', err);
        _acEmpty('taxFlowChart'); _acEmpty('taxTypeChart');
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


// ═══════════════════════════════════════════════════════════════════════════════
// GSTR-3B — portal JSON + the figures no document produces
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Build the GSTN-portal-uploadable GSTR-3B JSON for a return month and download it, then render a review
 * summary of what went into the file.
 *
 * The review card is not decoration. GSTR-3B is a SUMMARY return, so the uploaded file is a handful of
 * totals with no invoice-level detail to sanity-check against — the only chance to notice something wrong
 * is before it is filed. It deliberately shows the five outward categories separately (a figure in the
 * wrong one is the classic 3B error) and calls out when interest/reversals have never been entered.
 */
async function downloadGstr3bJson() {
    const monthInput = document.getElementById('gstr3bMonth')?.value; // YYYY-MM
    if (!monthInput) { Toast.error('Pick the return month first'); return; }
    const [year, month] = monthInput.split('-').map(Number);
    try {
        const url = AccountsCommon.buildUrl('tax/reports/gstr3b-json', { year, month });
        const res = await api.request(url);

        const blob = new Blob([JSON.stringify(res.payload, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = res.file_name;
        a.click();
        URL.revokeObjectURL(a.href);

        const s = res.summary || {};
        const money = v => '₹' + Number(v || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        const tile = (label, value, hint) => `
            <div style="background:var(--bg-tertiary);border:1px solid var(--border-color);border-radius:10px;padding:0.65rem 0.85rem;">
                <div style="font-size:0.72rem;color:var(--text-secondary);text-transform:uppercase;letter-spacing:0.04em;">${label}</div>
                <div style="font-size:1.05rem;font-weight:700;color:var(--text-primary);margin-top:2px;">${value}</div>
                ${hint ? `<div style="font-size:0.7rem;color:var(--text-secondary);margin-top:2px;">${AccountsCommon.escapeHtml(hint)}</div>` : ''}
            </div>`;

        // ⚠️ The one warning worth interrupting for: with nothing recorded, 4(B) and 5.1 file as ZERO. For a
        // filer who owes a late fee that is not an incomplete return, it is a WRONG one that looks complete.
        const adjWarn = s.filer_entered_figures_recorded ? '' : `
            <p style="color:var(--color-warning);margin-top:0.75rem;">
                ⚠ No interest, late fee or ITC reversal has been recorded for this month, so 4(B) and 5.1 will file
                as zero. If your portal challan shows any of them, enter them under
                <strong>Interest &amp; reversals</strong> and export again.
            </p>`;

        document.getElementById('gstr3bReportArea').innerHTML = `
            <div class="glass-card-header"><h3>Portal JSON built — ${AccountsCommon.escapeHtml(res.file_name)}</h3></div>
            <div class="glass-card-body">
                <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:0.75rem;">
                    ${tile('3.1(a) Taxable', money(s.outward_taxable), 'Ordinary outward supplies')}
                    ${tile('3.1(b) Zero-rated', money(s.outward_zero_rated), 'Exports / LUT')}
                    ${tile('3.1(c) Nil &amp; exempt', money(s.outward_nil_exempt), 'No tax charged')}
                    ${tile('3.1(e) Non-GST', money(s.outward_non_gst), 'Outside GST entirely')}
                    ${tile('3.1(d) Reverse charge', money(s.reverse_charge_taxable), 'You self-assess this')}
                    ${tile('Output tax', money(s.output_tax), 'Including reverse charge')}
                    ${tile('ITC available', money(s.itc_available), '4(A) before reversals')}
                    ${tile('ITC ineligible', money(s.itc_ineligible), '4(D) — never claimed')}
                    ${tile('Net ITC', money(s.itc_net), '4(C) = (A) − (B)')}
                    ${tile('Payable in cash', money(s.net_tax_payable), 'After setting off ITC')}
                    ${tile('Carried forward', money(s.itc_carried_forward), 'Credit surplus, if any')}
                    ${tile('Documents', `${s.invoice_count ?? 0} inv · ${s.credit_note_count ?? 0} CN · ${s.purchase_count ?? 0} bills`, 'What fed this return')}
                </div>
                ${adjWarn}
                <p style="color:var(--text-secondary);margin-top:0.75rem;font-size:0.85rem;">
                    Upload at gst.gov.in → Returns → GSTR-3B → Prepare Offline → Upload JSON, review, then file with EVC/DSC.
                    Check these figures against GSTR-1 for the same month before filing — the portal compares them.
                </p>
            </div>`;
        Toast.success('GSTR-3B portal JSON downloaded');
    } catch (err) {
        Toast.error(err?.message || 'GSTR-3B JSON export failed');
    }
}

/** Load whatever is already recorded for the chosen month and open the editor. */
async function openGstr3bAdjustments() {
    const monthInput = document.getElementById('gstr3bMonth')?.value;
    if (!monthInput) { Toast.error('Pick the return month first'); return; }
    const [year, month] = monthInput.split('-').map(Number);
    document.getElementById('adjMonth').value = monthInput;

    const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = (v === 0 || v) ? v : ''; };
    try {
        const a = await api.request(AccountsCommon.buildUrl('tax/reports/gstr3b-adjustments', { year, month }));
        // A month with nothing recorded returns null — clear the form rather than showing the last month's
        // numbers, which would be the easiest way to file one month's late fee against another.
        set('adjRevRuleI', a?.itc_rev_rule_iamt); set('adjRevRuleC', a?.itc_rev_rule_camt);
        set('adjRevRuleS', a?.itc_rev_rule_samt); set('adjRevRuleCs', a?.itc_rev_rule_csamt);
        set('adjRevOthI', a?.itc_rev_other_iamt); set('adjRevOthC', a?.itc_rev_other_camt);
        set('adjRevOthS', a?.itc_rev_other_samt); set('adjRevOthCs', a?.itc_rev_other_csamt);
        set('adjIntI', a?.interest_iamt); set('adjIntC', a?.interest_camt);
        set('adjIntS', a?.interest_samt); set('adjIntCs', a?.interest_csamt);
        set('adjLateC', a?.late_fee_camt); set('adjLateS', a?.late_fee_samt);
        set('adjNotes', a?.notes);
    } catch (err) {
        Toast.error(err?.message || 'Could not load the recorded figures');
        return;
    }
    AccountsCommon.openModal('gstr3bAdjModal');
}

async function saveGstr3bAdjustments() {
    const monthInput = document.getElementById('adjMonth')?.value;
    if (!monthInput) { Toast.error('Pick the return month'); return; }
    const [year, month] = monthInput.split('-').map(Number);
    const num = id => { const v = parseFloat(document.getElementById(id)?.value); return isNaN(v) ? 0 : v; };

    // Refuse negatives HERE as well as in the database. A negative interest or reversal is a mis-key, not a
    // correction, and the portal rejects one anyway — better to say so beside the field than to surface a
    // constraint violation as a failed save.
    const body = {
        return_year: year, return_month: month,
        itc_rev_rule_iamt: num('adjRevRuleI'), itc_rev_rule_camt: num('adjRevRuleC'),
        itc_rev_rule_samt: num('adjRevRuleS'), itc_rev_rule_csamt: num('adjRevRuleCs'),
        itc_rev_other_iamt: num('adjRevOthI'), itc_rev_other_camt: num('adjRevOthC'),
        itc_rev_other_samt: num('adjRevOthS'), itc_rev_other_csamt: num('adjRevOthCs'),
        interest_iamt: num('adjIntI'), interest_camt: num('adjIntC'),
        interest_samt: num('adjIntS'), interest_csamt: num('adjIntCs'),
        late_fee_camt: num('adjLateC'), late_fee_samt: num('adjLateS'),
        notes: document.getElementById('adjNotes')?.value || null
    };
    if (Object.entries(body).some(([k, v]) => typeof v === 'number' && k !== 'return_year' && k !== 'return_month' && v < 0)) {
        Toast.error('These figures cannot be negative — they add to what you owe, they never reduce it.');
        return;
    }

    try {
        await api.request(AccountsCommon.buildUrl('tax/reports/gstr3b-adjustments'), { method: 'PUT', body: JSON.stringify(body) });
        AccountsCommon.closeModal('gstr3bAdjModal');
        Toast.success('Saved — export the portal JSON again to include them');
    } catch (err) {
        Toast.error(err?.message || 'Could not save');
    }
}

// ============================================================================
// GSTR-2B MATCH
//
// The one screen in this module that compares us against an OUTSIDE source.
// GSTR-1 and GSTR-3B are generated from our own books, so they can only ever
// be checked against themselves; GSTR-2B is built by the portal from what our
// SUPPLIERS filed. The gap between the two sides is money — credit we have not
// claimed, or credit we have claimed and are not entitled to.
//
// Nothing on this screen writes to the books. Both sides can be the wrong one,
// so every row states what it found and leaves the correction to a human.
// ============================================================================

let _g2bResult = null;
let _g2bFilter = 'all';

const G2B_BUCKETS = [
    { key: 'only_in_books',  label: 'Missing at portal', tone: 'error',   hint: 'You booked it, your supplier has not filed it. Credit at risk.' },
    { key: 'value_mismatch', label: 'Value differs',     tone: 'warning', hint: 'Same document, different tax. One side has a keying error.' },
    { key: 'only_in_2b',     label: 'Not in your books', tone: 'warning', hint: 'Your supplier filed it and you have no bill. Possibly unclaimed credit.' },
    { key: 'date_mismatch',  label: 'Date differs',      tone: 'warning', hint: 'Same invoice number, different date.' },
    { key: 'probable',       label: 'Probable match',    tone: 'warning', hint: 'Matched only by ignoring punctuation — confirm before relying on it.' },
    { key: 'exact',          label: 'Matched',           tone: 'success', hint: 'Portal and books agree.' }
];

function _g2bMoney(v) {
    const n = Number(v || 0);
    return (n < 0 ? '-' : '') + '₹' + Math.abs(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function _g2bPeriod() {
    const v = document.getElementById('gstr2bMonth')?.value; // YYYY-MM
    if (!v) return null;
    const [y, m] = v.split('-');
    return `${m}${y}`;
}

async function uploadGstr2b(input) {
    const file = input.files && input.files[0];
    input.value = '';                       // let the same file be re-picked after a fix
    if (!file) return;
    try {
        const text = await file.text();
        const res = await api.request(
            AccountsCommon.buildUrl('tax/gstr2b/import', { filename: file.name }),
            { method: 'POST', body: text });

        // Set the month picker from the FILE, not the other way round: the file states which period it is
        // for, and letting a stale picker value disagree with it is how you reconcile the wrong month.
        const mm = res.return_period?.slice(0, 2), yyyy = res.return_period?.slice(2);
        if (mm && yyyy) document.getElementById('gstr2bMonth').value = `${yyyy}-${mm}`;

        Toast.success(`Loaded ${res.document_count} document(s) for ${mm}/${yyyy}`);
        (res.warnings || []).forEach(w => Toast.warning(w));
        await reconcileGstr2b();
    } catch (err) {
        Toast.error(err?.message || 'Could not read that file');
    }
}

async function reconcileGstr2b() {
    const period = _g2bPeriod();
    if (!period) { Toast.error('Pick the return month first'); return; }
    try {
        _g2bResult = await api.request(AccountsCommon.buildUrl('tax/gstr2b/reconcile', { period }));
        _g2bFilter = 'all';
        renderGstr2b();
        (_g2bResult.warnings || []).forEach(w => Toast.warning(w));
    } catch (err) {
        _g2bResult = null;
        document.getElementById('gstr2bSummary').innerHTML = '';
        document.getElementById('gstr2bReportArea').innerHTML =
            `<div class="glass-card-body"><div class="empty-message"><p>${AccountsCommon.escapeHtml(err?.message || 'Could not reconcile')}</p></div></div>`;
        document.getElementById('gstr2bImportInfo').textContent = '';
    }
}

function setGstr2bFilter(key) {
    _g2bFilter = key;
    renderGstr2b();
}

function renderGstr2b() {
    const r = _g2bResult;
    if (!r) return;
    const counts = r.counts || {};

    document.getElementById('gstr2bImportInfo').textContent =
        `2B uploaded ${new Date(r.imported_at).toLocaleString('en-IN')} · ${r.rows.length} row(s)`;

    // ── Headline figures. The DIFFERENCE is the number a CA reads first, and its SIGN is the whole
    // meaning: negative means we have booked more credit than the portal grants.
    const d = r.itc_delta || {};
    const overclaiming = [d.igst, d.cgst, d.sgst, d.cess].some(v => Number(v || 0) < -0.5);
    const atRisk = (r.itc_at_risk?.igst || 0) + (r.itc_at_risk?.cgst || 0) + (r.itc_at_risk?.sgst || 0) + (r.itc_at_risk?.cess || 0);
    const totalOf = h => Number(h?.igst || 0) + Number(h?.cgst || 0) + Number(h?.sgst || 0) + Number(h?.cess || 0);

    const tile = (label, value, hint, tone) => `
        <div style="background:var(--bg-tertiary);border:1px solid ${tone ? `var(--color-${tone})` : 'var(--border-color)'};border-radius:10px;padding:0.75rem 0.9rem;flex:1;min-width:190px;">
            <div style="font-size:0.72rem;color:var(--text-secondary);text-transform:uppercase;letter-spacing:0.04em;">${AccountsCommon.escapeHtml(label)}</div>
            <div style="font-size:1.15rem;font-weight:700;margin-top:2px;color:${tone ? `var(--color-${tone})` : 'var(--text-primary)'};">${value}</div>
            <div style="font-size:0.7rem;color:var(--text-secondary);margin-top:3px;">${AccountsCommon.escapeHtml(hint)}</div>
        </div>`;

    document.getElementById('gstr2bSummary').innerHTML = `
        <div style="display:flex;gap:0.75rem;flex-wrap:wrap;">
            ${tile('Credit per portal', _g2bMoney(totalOf(r.itc_per_2b)), 'What GSTR-2B grants for this period')}
            ${tile('Credit per your books', _g2bMoney(totalOf(r.itc_per_books)), 'Eligible credit on matched bills')}
            ${tile('Difference', _g2bMoney(totalOf(d)),
                overclaiming ? 'Negative — you have booked MORE than the portal grants' : 'Positive means credit you have not claimed',
                overclaiming ? 'error' : null)}
            ${tile('Credit at risk', _g2bMoney(atRisk), 'On bills your suppliers have not filed', atRisk > 0.5 ? 'warning' : null)}
        </div>
        <div style="display:flex;gap:0.4rem;flex-wrap:wrap;margin-top:0.75rem;">
            <button class="btn btn-sm ${_g2bFilter === 'all' ? 'btn-primary' : 'btn-outline'}" onclick="setGstr2bFilter('all')">All ${r.rows.length}</button>
            ${G2B_BUCKETS.map(b => `
                <button class="btn btn-sm ${_g2bFilter === b.key ? 'btn-primary' : 'btn-outline'}"
                        onclick="setGstr2bFilter('${b.key}')" title="${AccountsCommon.escapeHtml(b.hint)}">
                    ${AccountsCommon.escapeHtml(b.label)} ${counts[b.key] || 0}
                </button>`).join('')}
        </div>`;

    // Ordered so the buckets that need action come FIRST — a screen that opens on 400 matched rows buries
    // the four that cost money.
    const order = G2B_BUCKETS.map(b => b.key);
    const rows = (_g2bFilter === 'all' ? r.rows : r.rows.filter(x => x.kind === _g2bFilter))
        .slice()
        .sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));

    if (!rows.length) {
        document.getElementById('gstr2bReportArea').innerHTML =
            `<div class="glass-card-body"><div class="empty-message"><p>Nothing in this group.</p></div></div>`;
        return;
    }

    const badge = kind => {
        const b = G2B_BUCKETS.find(x => x.key === kind);
        return `<span class="status-badge" style="background:var(--color-${b?.tone || 'info'});color:var(--text-inverse);">${AccountsCommon.escapeHtml(b?.label || kind)}</span>`;
    };
    const dt = v => v ? new Date(v).toLocaleDateString('en-IN') : '—';
    const headsCell = h => h
        ? `<div style="font-weight:600;">${_g2bMoney(Number(h.igst || 0) + Number(h.cgst || 0) + Number(h.sgst || 0) + Number(h.cess || 0))}</div>
           <div style="font-size:0.7rem;color:var(--text-secondary);">on ${_g2bMoney(h.taxable)}</div>`
        : '<span style="color:var(--text-secondary);">—</span>';

    document.getElementById('gstr2bReportArea').innerHTML = `
        <div class="glass-card-body" style="padding:0;">
            <div class="data-table-container">
                <table class="data-table">
                    <thead>
                        <tr>
                            <th>Status</th><th>Supplier</th>
                            <th>Portal document</th><th>Tax per portal</th>
                            <th>Your bill</th><th>Tax per books</th>
                            <th>What to do</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${rows.map(x => `
                            <tr>
                                <td>${badge(x.kind)}</td>
                                <td>
                                    <div>${AccountsCommon.escapeHtml(x.supplier_name || '—')}</div>
                                    <div style="font-size:0.7rem;color:var(--text-secondary);">${AccountsCommon.escapeHtml(x.supplier_gstin || 'no GSTIN')}</div>
                                </td>
                                <td>
                                    <div>${AccountsCommon.escapeHtml(x.portal_doc_number || '—')}</div>
                                    <div style="font-size:0.7rem;color:var(--text-secondary);">${x.portal_doc_number ? dt(x.portal_doc_date) : ''}</div>
                                </td>
                                <td>${headsCell(x.portal_heads)}</td>
                                <td>
                                    <div>${AccountsCommon.escapeHtml(x.supplier_invoice_number || x.bill_number || '—')}</div>
                                    <div style="font-size:0.7rem;color:var(--text-secondary);">${x.bill_number ? dt(x.bill_date) : ''}</div>
                                </td>
                                <td>${headsCell(x.book_heads)}</td>
                                <td style="min-width:280px;max-width:360px;font-size:0.78rem;line-height:1.45;color:var(--text-secondary);white-space:normal;overflow:visible;text-overflow:clip;">${AccountsCommon.escapeHtml(x.note || 'Agrees with the portal.')}</td>
                            </tr>`).join('')}
                    </tbody>
                </table>
            </div>
        </div>`;
}


// ============================================================================
// E-INVOICING (IRP) SETTINGS — per-tenant IRP API user; secrets never round-trip
// ============================================================================
const EINV_IRP_URLS = { sandbox: 'https://einv-apisandbox.nic.in', nic1: 'https://einvoice1.gst.gov.in', nic2: 'https://einvoice2.gst.gov.in', clear: 'https://einvoice4.gst.gov.in' };

function onEInvoiceIrpChange() {
    const irp = document.getElementById('einvIrp').value;
    const url = document.getElementById('einvBaseUrl');
    if (irp === 'custom') { url.readOnly = false; if (EINV_IRP_URLS[url.value] || Object.values(EINV_IRP_URLS).includes(url.value)) url.value = ''; url.focus(); }
    else { url.readOnly = true; url.value = EINV_IRP_URLS[irp]; }
}

async function loadEInvoiceSettings() {
    try {
        const s = await api.request(AccountsCommon.buildUrl('einvoice/settings'), { _skipSpinner: true });
        document.getElementById('einvIrp').value = s.irp || 'sandbox';
        document.getElementById('einvBaseUrl').value = s.base_url || EINV_IRP_URLS[s.irp] || '';
        document.getElementById('einvBaseUrl').readOnly = (s.irp || 'sandbox') !== 'custom';
        document.getElementById('einvClientId').value = s.client_id || '';
        document.getElementById('einvUser').value = s.api_username || '';
        document.getElementById('einvPublicKey').value = s.public_key || '';
        document.getElementById('einvAato').value = s.aato_band || 'under_5cr';
        document.getElementById('einvGstin').value = s.gstin || '— not set in Settings → Organisation —';
        document.getElementById('einvAuto').checked = !!s.auto_generate_on_approve;
        document.getElementById('einvEnabled').checked = !!s.enabled;
        document.getElementById('einvClientSecret').value = '';
        document.getElementById('einvPassword').value = '';
        document.getElementById('einvClientSecretHint').textContent = s.has_client_secret ? 'A secret is stored. Type a new one only to replace it.' : 'Not set yet.';
        document.getElementById('einvPasswordHint').textContent = s.has_api_password ? 'A password is stored. Type a new one only to replace it.' : 'Not set yet.';
        const chip = document.getElementById('einvStatusChip');
        const testTxt = s.last_test_at ? `Last test ${AccountsCommon.formatDate(s.last_test_at)}: ${s.last_test_ok ? 'OK' : 'failed'}` : 'Never tested';
        chip.innerHTML = `<span style="color:${s.enabled ? 'var(--color-success)' : 'var(--text-secondary)'};">● ${s.enabled ? 'Enabled' : (s.configured ? 'Configured, not enabled' : 'Not configured')}</span> · ${AccountsCommon.escapeHtml(testTxt)}`;
        const r = document.getElementById('einvTestResult');
        r.textContent = s.last_error ? `Last error: ${s.last_error}` : '';
        r.style.color = s.last_error ? 'var(--color-error)' : 'var(--text-secondary)';
    } catch (e) { Toast.error(e.message || 'Could not load e-invoicing settings'); }
}

function readEInvoiceForm() {
    return {
        enabled: document.getElementById('einvEnabled').checked,
        irp: document.getElementById('einvIrp').value,
        base_url: document.getElementById('einvBaseUrl').value.trim(),
        public_key: document.getElementById('einvPublicKey').value.trim(),
        client_id: document.getElementById('einvClientId').value.trim(),
        client_secret: document.getElementById('einvClientSecret').value,
        api_username: document.getElementById('einvUser').value.trim(),
        api_password: document.getElementById('einvPassword').value,
        auto_generate_on_approve: document.getElementById('einvAuto').checked,
        aato_band: document.getElementById('einvAato').value
    };
}

async function saveEInvoiceSettings() {
    try {
        await api.request(AccountsCommon.buildUrl('einvoice/settings'), { method: 'PUT', body: JSON.stringify(readEInvoiceForm()) });
        Toast.success('e-Invoicing settings saved');
    } catch (e) {
        // A 409 "Saved, but NOT enabled" is a real save with the switch refused — say exactly that.
        (e.message || '').startsWith('Saved') ? Toast.warning(e.message) : Toast.error(e.message || 'Save failed');
    }
    await loadEInvoiceSettings();
}

async function testEInvoiceConnection() {
    const r = document.getElementById('einvTestResult');
    // Save first so the test runs against what is on screen, not what was stored a minute ago.
    try { await api.request(AccountsCommon.buildUrl('einvoice/settings'), { method: 'PUT', body: JSON.stringify({ ...readEInvoiceForm(), enabled: document.getElementById('einvEnabled').checked }) }); }
    catch (e) { if (!(e.message || '').startsWith('Saved')) { Toast.error(e.message || 'Save failed'); return; } }
    r.style.color = 'var(--text-secondary)'; r.textContent = 'Contacting the IRP…';
    try {
        const res = await api.request(AccountsCommon.buildUrl('einvoice/settings/test'), { method: 'POST' });
        r.style.color = res.ok ? 'var(--color-success)' : 'var(--color-error)';
        r.textContent = res.ok ? `✓ ${res.message}` : `✗ ${res.message}`;
        res.ok ? Toast.success('IRP connection OK') : Toast.error('IRP connection failed');
    } catch (e) { r.style.color = 'var(--color-error)'; r.textContent = e.message || 'Test failed'; }
    await loadEInvoiceSettings();
}
