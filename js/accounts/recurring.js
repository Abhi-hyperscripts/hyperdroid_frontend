/**
 * Recurring Transactions page
 */

let recurringList = [];
let customersList = [];
let vendorsList = [];
let accountsList = [];

// Searchable dropdown instances
let typeDropdown = null;
let frequencyDropdown = null;
let customerDropdown = null;
let vendorDropdown = null;
let accountDropdown = null;

document.addEventListener('DOMContentLoaded', async () => {
    if (!await AccountsCommon.initPage('recurring', '../')) return;

    // Set default start date to today
    document.getElementById('rStartDate').value = new Date().toISOString().split('T')[0];

    await Promise.all([loadRecurring(), loadLookups()]);
    initDropdowns();
});

function initDropdowns() {
    if (typeof SearchableDropdown === 'undefined') {
        setTimeout(initDropdowns, 100);
        return;
    }

    typeDropdown = new SearchableDropdown(document.getElementById('rTypeContainer'), {
        options: [
            { value: 'invoice', label: 'Customer Invoice' },
            { value: 'bill', label: 'Vendor Bill' },
            { value: 'journal', label: 'Journal Entry' }
        ],
        placeholder: 'Select type',
        compact: true,
        onChange: onTypeChange
    });
    typeDropdown.setValue('invoice');

    frequencyDropdown = new SearchableDropdown(document.getElementById('rFrequencyContainer'), {
        options: [
            { value: 'daily', label: 'Daily' },
            { value: 'weekly', label: 'Weekly' },
            { value: 'monthly', label: 'Monthly' },
            { value: 'quarterly', label: 'Quarterly' },
            { value: 'yearly', label: 'Yearly' }
        ],
        placeholder: 'Select frequency',
        compact: true
    });
    frequencyDropdown.setValue('monthly');

    customerDropdown = new SearchableDropdown(document.getElementById('rCustomerContainer'), {
        options: [{ value: '', label: 'Select customer' }, ...customersList.map(c => ({ value: c.id, label: c.name }))],
        placeholder: 'Search customer...',
        compact: true
    });

    vendorDropdown = new SearchableDropdown(document.getElementById('rVendorContainer'), {
        options: [{ value: '', label: 'Select vendor' }, ...vendorsList.map(v => ({ value: v.id, label: v.name }))],
        placeholder: 'Search vendor...',
        compact: true
    });

    accountDropdown = new SearchableDropdown(document.getElementById('rAccountContainer'), {
        options: [{ value: '', label: 'Select account' }, ...accountsList.filter(a => a.allow_direct_posting).map(a => ({ value: a.id, label: `${a.account_code} - ${a.account_name}` }))],
        placeholder: 'Search GL account...',
        compact: true
    });
}

async function loadRecurring() {
    try {
        const res = await api.request(AccountsCommon.buildUrl('recurring'));
        recurringList = Array.isArray(res) ? res : (res?.data || []);
        renderTable();
        updateStats();
    } catch (err) {
        console.error('[Recurring] load error:', err);
        Toast.error('Failed to load recurring transactions');
    }
}

async function loadLookups() {
    try {
        const [custRes, vendRes, coaRes] = await Promise.all([
            api.request(AccountsCommon.buildUrl('customers'), { _skipSpinner: true }).catch(() => []),
            api.request(AccountsCommon.buildUrl('vendors'), { _skipSpinner: true }).catch(() => []),
            api.request(AccountsCommon.buildUrl('coa'), { _skipSpinner: true }).catch(() => [])
        ]);
        customersList = Array.isArray(custRes) ? custRes : (custRes?.data || []);
        vendorsList = Array.isArray(vendRes) ? vendRes : (vendRes?.data || []);
        accountsList = Array.isArray(coaRes) ? coaRes : (coaRes?.data || []);
    } catch (err) {
        console.error('[Recurring] lookups error:', err);
    }
}

function updateStats() {
    const active = recurringList.filter(r => r.status === 'active').length;
    const paused = recurringList.filter(r => r.status === 'paused').length;
    const total = recurringList.reduce((sum, r) => sum + (r.total_generated || 0), 0);
    document.getElementById('statActive').textContent = active;
    document.getElementById('statPaused').textContent = paused;
    document.getElementById('statTotal').textContent = total;
}

function renderTable() {
    const tbody = document.getElementById('recurringTable');
    if (!recurringList.length) {
        tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:2rem;color:var(--text-secondary);">No recurring transactions yet. Click "New Recurring" to create one.</td></tr>';
        return;
    }

    const statusBadge = (s) => {
        const map = { active: 'status-active', paused: 'status-pending', completed: 'status-active', cancelled: 'status-rejected' };
        return `<span class="badge ${map[s] || 'status-pending'}">${s}</span>`;
    };

    const typeLabel = (t) => ({ invoice: 'Invoice', bill: 'Bill', journal: 'Journal' })[t] || t;

    tbody.innerHTML = recurringList.map(r => {
        const actions = r.status === 'active'
            ? `<button class="btn-icon" onclick="pauseRecurring('${r.id}')" data-tooltip="Pause"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg></button>`
            : r.status === 'paused'
            ? `<button class="btn-icon" onclick="resumeRecurring('${r.id}')" data-tooltip="Resume"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg></button>`
            : '';
        const cancelBtn = r.status !== 'cancelled' && r.status !== 'completed'
            ? `<button class="btn-icon btn-icon-danger" onclick="cancelRecurring('${r.id}')" data-tooltip="Cancel"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>`
            : '';

        return `<tr>
            <td><strong>${AccountsCommon.escapeHtml(r.name)}</strong></td>
            <td>${typeLabel(r.transaction_type)}</td>
            <td>${r.frequency}</td>
            <td>${AccountsCommon.formatDate(r.start_date)}</td>
            <td>${AccountsCommon.formatDate(r.next_run_date)}</td>
            <td style="text-align:center;">${r.total_generated || 0}</td>
            <td>${statusBadge(r.status)}</td>
            <td><div style="display:flex;gap:0.35rem;align-items:center;">${actions}${cancelBtn}</div></td>
        </tr>`;
    }).join('');
}

function openCreateModal() {
    document.getElementById('rName').value = '';
    document.getElementById('rDescription').value = '';
    document.getElementById('rAmount').value = '';
    document.getElementById('rEndDate').value = '';
    document.getElementById('rStartDate').value = new Date().toISOString().split('T')[0];
    typeDropdown?.setValue('invoice');
    frequencyDropdown?.setValue('monthly');
    customerDropdown?.setValue('');
    vendorDropdown?.setValue('');
    accountDropdown?.setValue('');
    onTypeChange();
    AccountsCommon.openModal('recurringModal');
}

function onTypeChange() {
    const type = typeDropdown?.getValue() || 'invoice';
    document.getElementById('customerGroup').style.display = type === 'invoice' ? '' : 'none';
    document.getElementById('vendorGroup').style.display = type === 'bill' ? '' : 'none';
}

async function saveRecurring() {
    const name = document.getElementById('rName').value.trim();
    const type = typeDropdown?.getValue();
    const frequency = frequencyDropdown?.getValue();
    const startDate = document.getElementById('rStartDate').value;
    const endDate = document.getElementById('rEndDate').value;
    const description = document.getElementById('rDescription').value.trim();
    const amount = parseFloat(document.getElementById('rAmount').value);
    const accountId = accountDropdown?.getValue();

    if (!name || !frequency || !startDate || !description || !amount || !accountId) {
        Toast.error('Please fill all required fields');
        return;
    }

    let templateData = { lines: [{ description, quantity: 1, unit_price: amount, account_id: accountId }] };

    if (type === 'invoice') {
        const custId = customerDropdown?.getValue();
        if (!custId) { Toast.error('Please select a customer'); return; }
        templateData.customer_id = custId;
        templateData.due_days = 30;
    } else if (type === 'bill') {
        const vendId = vendorDropdown?.getValue();
        if (!vendId) { Toast.error('Please select a vendor'); return; }
        templateData.vendor_id = vendId;
        templateData.due_days = 30;
    }

    const payload = {
        name, transaction_type: type, frequency, start_date: startDate,
        end_date: endDate || null,
        template_data: JSON.stringify(templateData)
    };

    try {
        await api.request(AccountsCommon.buildUrl('recurring'), {
            method: 'POST', body: JSON.stringify(payload)
        });
        Toast.success('Recurring transaction created');
        AccountsCommon.closeModal('recurringModal');
        await loadRecurring();
    } catch (err) {
        console.error('[Recurring] save error:', err);
        Toast.error(err.message || 'Failed to create recurring');
    }
}

async function pauseRecurring(id) {
    try {
        await api.request(AccountsCommon.buildUrl(`recurring/${id}/pause`), { method: 'POST' });
        Toast.success('Paused');
        await loadRecurring();
    } catch (err) { Toast.error('Failed to pause'); }
}

async function resumeRecurring(id) {
    try {
        await api.request(AccountsCommon.buildUrl(`recurring/${id}/resume`), { method: 'POST' });
        Toast.success('Resumed');
        await loadRecurring();
    } catch (err) { Toast.error('Failed to resume'); }
}

async function cancelRecurring(id) {
    const ok = await Confirm.show({ title: 'Cancel Recurring', message: 'Are you sure? This cannot be undone.', confirmText: 'Cancel It', type: 'warning' });
    if (!ok) return;
    try {
        await api.request(AccountsCommon.buildUrl(`recurring/${id}`), { method: 'DELETE' });
        Toast.success('Cancelled');
        await loadRecurring();
    } catch (err) { Toast.error('Failed to cancel'); }
}

async function processDue() {
    const ok = await Confirm.show({ title: 'Process Due Transactions', message: 'This will generate all recurring transactions that are due. Continue?', confirmText: 'Process', type: 'info' });
    if (!ok) return;
    try {
        const res = await api.request(AccountsCommon.buildUrl('recurring/process'), { method: 'POST' });
        Toast.success(res.message || 'Processing complete');
        await loadRecurring();
    } catch (err) {
        console.error('[Recurring] process error:', err);
        Toast.error('Failed to process');
    }
}
