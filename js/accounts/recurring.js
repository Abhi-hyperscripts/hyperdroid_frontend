/**
 * Recurring Transactions page
 */

let recurringList = [];
let recurringPage = 1;   // server-side pagination
let recurringTotal = 0;
const PAGE_SIZE = 50;
let customersList = [];
let vendorsList = [];
let accountsList = [];
let journalTypesList = [];

// Searchable dropdown instances
let typeDropdown = null;
let frequencyDropdown = null;
let customerDropdown = null;
let vendorDropdown = null;
let accountDropdown = null;
let journalTypeDropdown = null;
let debitAccountDropdown = null;
let creditAccountDropdown = null;

document.addEventListener('DOMContentLoaded', async () => {
    if (!await AccountsCommon.initPage('recurring', '../')) return;

    const tabNames = { 'recurring-list': 'Recurring List' };
    AccountsCommon.setupSidebar('sidebarToggle', 'accountsSidebar', 'sidebarOverlay', tabNames);
    AccountsCommon.setupTabs(tabNames);

    accountsRoles.applyRBAC();

    // Recurring is manager/admin-only (RecurringController). Block USER/AUDITOR up front so they don't
    // hit a wall of 403s and see action buttons that all fail; show a clear no-access message instead.
    if (!accountsRoles.isManager()) {
        const host = document.getElementById('recurringTable') || document.querySelector('table tbody');
        if (host) host.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:2rem;color:var(--text-secondary);">You do not have access to recurring transactions. This feature requires an Accounts Manager or Admin role.</td></tr>';
        return;
    }

    // Set default start date to today
    document.getElementById('rStartDate').value = AccountsCommon.todayLocal();

    AccountsCommon.initDatePickers(['rStartDate', 'rEndDate']);
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

    // Backend requires an Income account for invoice templates and an
    // Expenses account for bill templates — options are re-filtered per
    // selected type in onTypeChange() to avoid guaranteed 400s.
    accountDropdown = new SearchableDropdown(document.getElementById('rAccountContainer'), {
        options: accountOptionsForType(typeDropdown?.getValue() || 'invoice'),
        placeholder: 'Search GL account...',
        compact: true
    });

    journalTypeDropdown = new SearchableDropdown(document.getElementById('rJournalTypeContainer'), {
        options: [{ value: '', label: 'Select journal type' }, ...journalTypesList.map(j => ({ value: j.id, label: j.name || j.journal_type_name || j.type }))],
        placeholder: 'Select journal type',
        compact: true
    });

    debitAccountDropdown = new SearchableDropdown(document.getElementById('rDebitAccountContainer'), {
        options: accountOptionsForType('journal'),
        placeholder: 'Search debit account...',
        compact: true
    });

    creditAccountDropdown = new SearchableDropdown(document.getElementById('rCreditAccountContainer'), {
        options: accountOptionsForType('journal'),
        placeholder: 'Search credit account...',
        compact: true
    });
}

function accountOptionsForType(type) {
    // invoice → Income accounts, bill → Expenses accounts, journal → any
    // direct-posting account (used for both debit and credit sides).
    const wanted = type === 'invoice' ? 'Income' : type === 'bill' ? 'Expenses' : null;
    return [{ value: '', label: 'Select account' }, ...accountsList
        .filter(a => a.allow_direct_posting && (!wanted || a.account_type_name === wanted))
        .map(a => ({ value: a.id, label: `${a.account_code} - ${a.account_name}` }))];
}

async function loadRecurring(page = recurringPage) {
    try {
        recurringPage = page;
        AccountsCommon.setTableLoading('recurringTable', 8, 'Loading recurring transactions…');
        const params = { limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE };
        const res = await api.request(AccountsCommon.buildUrl('recurring', params), { _skipSpinner: true });
        const env = Array.isArray(res) ? { data: res, total: res.length, stats: null } : (res || {});
        recurringList = env.data || [];
        recurringTotal = env.total ?? recurringList.length;
        updateStats(env.stats);
        renderTable();
        renderRecurringCharts();
        _acActiveRender = renderRecurringCharts;
    } catch (err) {
        console.error('[Recurring] load error:', err);
        Toast.error('Failed to load recurring transactions');
    }
}

// Recurring charts — committed value by type + top rules, normalized to a
// monthly-equivalent so a yearly ₹1.2L and a monthly ₹10k rank the same.
const _FREQ_MONTHLY_FACTOR = { daily: 30.44, weekly: 4.33, fortnightly: 2.17, monthly: 1, quarterly: 1 / 3, half_yearly: 1 / 6, yearly: 1 / 12, annually: 1 / 12 };
function renderRecurringCharts() {
    if (typeof acDonut !== 'function') return;
    const active = recurringList.filter(r => r.status === 'active');
    if (!active.length) { _acEmpty('recurringTypeChart', 'No active rules'); _acEmpty('recurringTopChart', 'No active rules'); return; }
    // The rule row carries no amount column — the value lives in template_data JSON:
    // invoice/bill lines are {quantity, unit_price}; journal lines are {debit_amount, credit_amount}.
    const ruleAmount = (r) => {
        try {
            const td = typeof r.template_data === 'string' ? JSON.parse(r.template_data) : (r.template_data || {});
            return (td.lines || []).reduce((s, l) =>
                s + (l.unit_price != null
                    ? (parseFloat(l.quantity ?? 1) || 1) * (parseFloat(l.unit_price) || 0)
                    : (parseFloat(l.debit_amount) || 0)), 0);
        } catch { return 0; }
    };
    const monthlyEq = (r) => ruleAmount(r) * (_FREQ_MONTHLY_FACTOR[r.frequency] ?? 1);
    const typeLabel = (t) => ({ invoice: 'Invoices', bill: 'Bills', journal: 'Journals' })[t] || (t || 'Other');
    const typeColor = { Invoices: '#10b981', Bills: '#ef4444', Journals: '#3b82f6' };
    const byType = {};
    active.forEach(r => { const k = typeLabel(r.transaction_type); byType[k] = (byType[k] || 0) + monthlyEq(r); });
    const types = Object.keys(byType).filter(k => byType[k] > 0).sort();
    types.length
        ? acDonut('recurringTypeChart', types, types.map(k => Math.round(byType[k] * 100) / 100),
                  types.map((k, i) => typeColor[k] || _acPalette[i % _acPalette.length]))
        : _acEmpty('recurringTypeChart');
    const short = (s) => (s || '—').length > 18 ? s.slice(0, 17) + '…' : (s || '—');
    const rank = _acRank(active.map(r => ({ name: short(r.name), amt: monthlyEq(r) })), 'name', 'amt', 6);
    rank.labels.length ? acBarH('recurringTopChart', rank.labels, rank.data) : _acEmpty('recurringTopChart');
}

async function loadLookups() {
    try {
        const [custRes, vendRes, coaRes, jtRes] = await Promise.all([
            api.request(AccountsCommon.buildUrl('customers'), { _skipSpinner: true }).catch(() => []),
            api.request(AccountsCommon.buildUrl('vendors'), { _skipSpinner: true }).catch(() => []),
            api.request(AccountsCommon.buildUrl('coa'), { _skipSpinner: true }).catch(() => []),
            api.request(AccountsCommon.buildUrl('journals/types'), { _skipSpinner: true }).catch(() => [])
        ]);
        customersList = Array.isArray(custRes) ? custRes : (custRes?.data || []);
        vendorsList = Array.isArray(vendRes) ? vendRes : (vendRes?.data || []);
        accountsList = Array.isArray(coaRes) ? coaRes : (coaRes?.data || []);
        journalTypesList = Array.isArray(jtRes) ? jtRes : (jtRes?.data || []);
    } catch (err) {
        console.error('[Recurring] lookups error:', err);
    }
}

function updateStats(stats) {
    const el = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
    if (stats) {
        el('statActive', stats.active_count);
        el('statPaused', stats.paused_count);
        el('statTotal', stats.total_generated);
    } else {
        el('statActive', recurringList.filter(r => r.status === 'active').length);
        el('statPaused', recurringList.filter(r => r.status === 'paused').length);
        el('statTotal', recurringList.reduce((sum, r) => sum + (r.total_generated || 0), 0));
    }
}

function renderTable() {
    const tbody = document.getElementById('recurringTable');
    if (!recurringList.length) {
        tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:2rem;color:var(--text-secondary);">No recurring transactions yet. Click "New Recurring" to create one.</td></tr>';
        AccountsCommon.renderPagination('recurringPagination', 1, 1, () => {});
        return;
    }

    const totalPages = Math.max(1, Math.ceil((recurringTotal || recurringList.length) / PAGE_SIZE));
    AccountsCommon.renderPagination('recurringPagination', recurringPage, totalPages, (p) => loadRecurring(p));

    const statusBadge = (s) => {
        const map = { active: 'status-active', paused: 'status-pending', completed: 'status-active', cancelled: 'status-rejected' };
        return `<span class="badge ${map[s] || 'status-pending'}">${s}</span>`;
    };

    const typeLabel = (t) => ({ invoice: 'Invoice', bill: 'Bill', journal: 'Journal' })[t] || t;

    // Recurring writes require admin (MANAGE_BILLING). Managers may view the
    // list but only admins see the Pause/Resume/Cancel actions.
    const isAdmin = accountsRoles.isAdmin();
    tbody.innerHTML = recurringList.map(r => {
        const actions = !isAdmin
            ? ''
            : r.status === 'active'
            ? `<button class="btn-icon" onclick="pauseRecurring('${r.id}')" data-tooltip="Pause"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg></button>`
            : r.status === 'paused'
            ? `<button class="btn-icon" onclick="resumeRecurring('${r.id}')" data-tooltip="Resume"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg></button>`
            : '';
        const cancelBtn = isAdmin && r.status !== 'cancelled' && r.status !== 'completed'
            ? `<button class="btn-icon btn-icon-danger" onclick="cancelRecurring('${r.id}')" data-tooltip="Cancel"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>`
            : '';

        // Surface auto-pause diagnostics so a failing schedule isn't blindly
        // resumed — backend pauses after consecutive failures and emits
        // last_error / consecutive_failures on the row.
        let pausedNote = '';
        if (r.status === 'paused' && (r.last_error || r.consecutive_failures > 0)) {
            const failures = r.consecutive_failures > 0
                ? `Auto-paused after ${r.consecutive_failures} failure${r.consecutive_failures === 1 ? '' : 's'}`
                : 'Paused with error';
            const errText = r.last_error ? `: ${AccountsCommon.escapeHtml(String(r.last_error).slice(0, 140))}` : '';
            pausedNote = `<div style="font-size:0.72rem;color:var(--color-error);margin-top:2px;max-width:240px;white-space:normal;">${failures}${errText}</div>`;
        }

        return `<tr>
            <td><strong>${AccountsCommon.escapeHtml(r.name)}</strong></td>
            <td>${typeLabel(r.transaction_type)}</td>
            <td>${r.frequency}</td>
            <td>${AccountsCommon.formatDate(r.start_date)}</td>
            <td>${AccountsCommon.formatDate(r.next_run_date)}</td>
            <td style="text-align:center;">${r.total_generated || 0}</td>
            <td>${statusBadge(r.status)}${pausedNote}</td>
            <td><div style="display:flex;gap:0.35rem;align-items:center;">${actions}${cancelBtn}</div></td>
        </tr>`;
    }).join('');
}

function openCreateModal() {
    document.getElementById('rName').value = '';
    document.getElementById('rDescription').value = '';
    document.getElementById('rAmount').value = '';
    AccountsCommon.setDateField('rEndDate', '');
    AccountsCommon.setDateField('rStartDate', AccountsCommon.todayLocal());
    typeDropdown?.setValue('invoice');
    frequencyDropdown?.setValue('monthly');
    customerDropdown?.setValue('');
    vendorDropdown?.setValue('');
    accountDropdown?.setValue('');
    journalTypeDropdown?.setValue('');
    debitAccountDropdown?.setValue('');
    creditAccountDropdown?.setValue('');
    onTypeChange();
    AccountsCommon.openModal('recurringModal');
}

function onTypeChange() {
    const type = typeDropdown?.getValue() || 'invoice';
    document.getElementById('customerGroup').style.display = type === 'invoice' ? '' : 'none';
    document.getElementById('vendorGroup').style.display = type === 'bill' ? '' : 'none';
    document.getElementById('glAccountGroup').style.display = type === 'journal' ? 'none' : '';
    document.getElementById('journalGroup').style.display = type === 'journal' ? '' : 'none';
    const label = document.getElementById('rAccountLabel');
    if (label) label.textContent = type === 'bill' ? 'Expense Account *' : 'Income Account *';
    // Re-filter the GL account list to match the backend's per-type
    // requirement (Income for invoices, Expenses for bills).
    if (accountDropdown && type !== 'journal') accountDropdown.setOptions(accountOptionsForType(type), true);
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

    if (!name || !frequency || !startDate || !description || !amount) {
        Toast.error('Please fill all required fields');
        return;
    }

    let templateData;
    if (type === 'journal') {
        // Journal templates need a journal type + balanced debit/credit lines.
        const journalTypeId = journalTypeDropdown?.getValue();
        const debitId = debitAccountDropdown?.getValue();
        const creditId = creditAccountDropdown?.getValue();
        if (!journalTypeId) { Toast.error('Please select a journal type'); return; }
        if (!debitId || !creditId) { Toast.error('Please select both debit and credit accounts'); return; }
        if (debitId === creditId) { Toast.error('Debit and credit accounts must be different'); return; }
        templateData = {
            journal_type_id: journalTypeId,
            lines: [
                { account_id: debitId, debit_amount: amount, credit_amount: 0, description },
                { account_id: creditId, debit_amount: 0, credit_amount: amount, description }
            ]
        };
    } else {
        if (!accountId) { Toast.error('Please select a GL account'); return; }
        templateData = { lines: [{ description, quantity: 1, unit_price: amount, account_id: accountId }] };

        // The key MUST be payment_terms_days — that is what the generator reads
        // (due_date = occurrenceDate + payment_terms_days, falling back to 30) and what the template
        // validator bounds to 0..3650. We previously wrote `due_days`, which no backend code reads: the
        // value was silently discarded and every generated invoice/bill fell through to the same hardcoded
        // 30, so the bug was invisible only because the dead key's value equalled the default. Making this
        // number user-configurable while the key stayed wrong would have shipped a silent data bug.
        if (type === 'invoice') {
            const custId = customerDropdown?.getValue();
            if (!custId) { Toast.error('Please select a customer'); return; }
            templateData.customer_id = custId;
            templateData.payment_terms_days = 30;
        } else if (type === 'bill') {
            const vendId = vendorDropdown?.getValue();
            if (!vendId) { Toast.error('Please select a vendor'); return; }
            templateData.vendor_id = vendId;
            templateData.payment_terms_days = 30;
        }
    }

    const payload = {
        name, transaction_type: type, frequency, start_date: startDate,
        end_date: endDate || null,
        template_data: JSON.stringify(templateData)
    };

    if (!AccountsCommon.beginSubmit('saveRecurring')) return;
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
    } finally {
        AccountsCommon.endSubmit('saveRecurring');
    }
}

async function pauseRecurring(id) {
    if (!AccountsCommon.beginSubmit('pauseRecurring')) return;
    try {
        await api.request(AccountsCommon.buildUrl(`recurring/${id}/pause`), { method: 'POST' });
        Toast.success('Paused');
        await loadRecurring();
    } catch (err) { Toast.error(err.message || 'Failed to pause'); }
    finally { AccountsCommon.endSubmit('pauseRecurring'); }
}

async function resumeRecurring(id) {
    if (!AccountsCommon.beginSubmit('resumeRecurring')) return;
    try {
        await api.request(AccountsCommon.buildUrl(`recurring/${id}/resume`), { method: 'POST' });
        Toast.success('Resumed');
        await loadRecurring();
    } catch (err) { Toast.error(err.message || 'Failed to resume'); }
    finally { AccountsCommon.endSubmit('resumeRecurring'); }
}

async function cancelRecurring(id) {
    const ok = await Confirm.show({ title: 'Cancel Recurring', message: 'Are you sure? This cannot be undone.', confirmText: 'Cancel It', type: 'warning' });
    if (!ok) return;
    try {
        await api.request(AccountsCommon.buildUrl(`recurring/${id}`), { method: 'DELETE' });
        Toast.success('Cancelled');
        await loadRecurring();
    } catch (err) { Toast.error(err.message || 'Failed to cancel'); }
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
