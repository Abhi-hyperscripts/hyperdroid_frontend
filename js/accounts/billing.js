/**
 * AccountsService — Billing Page
 *
 * Handles 4 sidebar tabs:
 *   1. Billing Plans
 *   2. Subscriptions
 *   3. Usage Meters
 *   4. Tokens
 */

// ============================================================================
// GLOBAL STATE
// ============================================================================

let billingPlans = [];
let subscriptions = [];
let usageMeters = [];

let subscriptionPage = 1;
const PAGE_SIZE = 50;

// ============================================================================
// PAGE INIT
// ============================================================================

document.addEventListener('DOMContentLoaded', async function () {
    if (!await AccountsCommon.initPage('billing', '../')) return;

    const tabNames = {
        'billing-plans': 'Billing Plans',
        'subscriptions': 'Subscriptions',
        'usage-meters': 'Usage Meters',
        'tokens': 'Tokens'
    };

    AccountsCommon.setupSidebar('sidebarToggle', 'accountsSidebar', 'sidebarOverlay', tabNames);
    AccountsCommon.setupTabs(tabNames, onTabSwitch);
    accountsRoles.applyRBAC();

    await loadInitialData();
    setupSearchListeners();
});

// ============================================================================
// TAB SWITCH HANDLER
// ============================================================================

function onTabSwitch(tabId) {
    switch (tabId) {
        case 'billing-plans':   loadPlans(); break;
        case 'subscriptions':   loadSubscriptions(); break;
        case 'usage-meters':    loadMeters(); break;
        case 'tokens':          break;
    }
}

// ============================================================================
// INITIAL DATA LOAD
// ============================================================================

async function loadInitialData() {
    try {
        await Promise.all([
            loadPlans(),
            loadMeters()
        ]);
    } catch (err) {
        console.error('[Billing] loadInitialData error:', err);
    }
}

function setupSearchListeners() {
    const debounce = (fn, ms = 300) => {
        let timer;
        return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); };
    };

    const planSearch = document.getElementById('planSearch');
    if (planSearch) planSearch.addEventListener('input', debounce(() => loadPlans()));

    const subSearch = document.getElementById('subscriptionSearch');
    if (subSearch) subSearch.addEventListener('input', debounce(() => { subscriptionPage = 1; loadSubscriptions(); }));
}

// ============================================================================
// 1. BILLING PLANS
// ============================================================================

async function loadPlans() {
    try {
        const search = document.getElementById('planSearch')?.value || '';
        const params = {};
        if (search) params.search = search;

        const url = AccountsCommon.buildUrl('billing/plans', params);
        const res = await api.request(url, { _skipSpinner: true });
        billingPlans = Array.isArray(res) ? res : (res?.data || res?.items || []);
        renderPlans();
    } catch (err) {
        console.error('[Billing] loadPlans error:', err);
        Toast.error('Failed to load billing plans');
    }
}

function renderPlans() {
    const tbody = document.getElementById('plansTable');
    if (!tbody) return;

    if (!billingPlans.length) {
        tbody.innerHTML = `<tr class="empty-state"><td colspan="6"><div class="empty-message">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">
                <rect x="1" y="4" width="22" height="16" rx="2" ry="2"></rect>
                <line x1="1" y1="10" x2="23" y2="10"></line>
            </svg><p>No billing plans configured</p></div></td></tr>`;
        return;
    }

    const intervalLabels = {
        'monthly': 'Monthly',
        'quarterly': 'Quarterly',
        'semi_annual': 'Semi-Annual',
        'annual': 'Annual',
        'one_time': 'One-Time'
    };

    tbody.innerHTML = billingPlans.map(p => {
        const status = p.status || (p.is_active === false ? 'inactive' : 'active');
        const viewBtn = `<button class="btn-icon" onclick="viewPlan('${p.id}')" data-tooltip="View"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg></button>`;
        const adminBtns = accountsRoles.isAdmin()
            ? `<button class="btn-icon" onclick="editPlan('${p.id}')" data-tooltip="Edit"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
               <button class="btn-icon danger" onclick="deletePlan('${p.id}')" data-tooltip="Delete"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>`
            : '';
        const actions = viewBtn + adminBtns;

        return `<tr>
            <td>${AccountsCommon.escapeHtml(p.name)}</td>
            <td><code>${AccountsCommon.escapeHtml(p.plan_code || p.code || '-')}</code></td>
            <td class="text-right">${AccountsCommon.formatCurrency(p.amount)}</td>
            <td>${AccountsCommon.escapeHtml(intervalLabels[p.billing_cycle || p.interval] || p.billing_cycle || p.interval || '-')}</td>
            <td>${AccountsCommon.statusBadge(status)}</td>
            <td class="actions-cell">${actions}</td>
        </tr>`;
    }).join('');
}

async function viewPlan(id) {
    try {
        const res = await api.request(AccountsCommon.buildUrl(`billing/plans/${id}`));
        const p = res?.data || res;
        if (!p) { Toast.error('Plan not found'); return; }

        const esc = AccountsCommon.escapeHtml;
        const fmt = AccountsCommon.formatCurrency;
        const intervalLabels = { 'monthly': 'Monthly', 'quarterly': 'Quarterly', 'semi_annual': 'Semi-Annual', 'annual': 'Annual', 'one_time': 'One-Time' };
        const status = p.status || (p.is_active === false ? 'inactive' : 'active');

        document.getElementById('billingDetailModalTitle').textContent = 'Plan Details';
        document.getElementById('billingDetailBody').innerHTML = `
            <div class="detail-grid">
                <div class="detail-row"><span class="detail-label">Name</span><span class="detail-value">${esc(p.name || '-')}</span></div>
                <div class="detail-row"><span class="detail-label">Code</span><span class="detail-value"><code>${esc(p.plan_code || p.code || '-')}</code></span></div>
                <div class="detail-row"><span class="detail-label">Amount</span><span class="detail-value">${fmt(p.amount)}</span></div>
                <div class="detail-row"><span class="detail-label">Billing Type</span><span class="detail-value">${esc(p.billing_type || '-')}</span></div>
                <div class="detail-row"><span class="detail-label">Billing Cycle</span><span class="detail-value">${esc(intervalLabels[p.billing_cycle || p.interval] || p.billing_cycle || p.interval || '-')}</span></div>
                <div class="detail-row"><span class="detail-label">Status</span><span class="detail-value">${AccountsCommon.statusBadge(status)}</span></div>
                <div class="detail-row"><span class="detail-label">Description</span><span class="detail-value">${esc(p.description || '-')}</span></div>
                <div class="detail-row"><span class="detail-label">Created</span><span class="detail-value">${AccountsCommon.formatDate(p.created_at)}</span></div>
                <div class="detail-row"><span class="detail-label">Updated</span><span class="detail-value">${AccountsCommon.formatDate(p.updated_at)}</span></div>
            </div>`;
        AccountsCommon.openModal('billingDetailModal');
    } catch (err) {
        console.error('[Billing] viewPlan error:', err);
        Toast.error('Failed to load plan details');
    }
}

function showCreatePlanModal() {
    document.getElementById('planModalTitle').textContent = 'Create Billing Plan';
    document.getElementById('planForm').reset();
    document.getElementById('planId').value = '';
    document.getElementById('planStatus').value = 'active';
    AccountsCommon.openModal('planModal');
}

function editPlan(id) {
    const plan = billingPlans.find(p => p.id === id);
    if (!plan) return;

    document.getElementById('planModalTitle').textContent = 'Edit Billing Plan';
    document.getElementById('planId').value = plan.id;
    document.getElementById('planName').value = plan.name || '';
    document.getElementById('planCode').value = plan.plan_code || plan.code || '';
    document.getElementById('planAmount').value = plan.amount ?? '';
    document.getElementById('planBillingType').value = plan.billing_type || 'subscription';
    document.getElementById('planInterval').value = plan.billing_cycle || plan.interval || '';
    document.getElementById('planStatus').value = plan.is_active === false ? 'inactive' : (plan.status || 'active');
    document.getElementById('planDescription').value = plan.description || '';
    AccountsCommon.openModal('planModal');
}

async function savePlan() {
    const id = document.getElementById('planId').value;
    const name = document.getElementById('planName').value.trim();
    const code = document.getElementById('planCode').value.trim();
    const amount = parseFloat(document.getElementById('planAmount').value);
    const interval = document.getElementById('planInterval').value;
    const status = document.getElementById('planStatus').value;
    const description = document.getElementById('planDescription').value.trim();

    if (!name || !code || isNaN(amount) || !interval) {
        Toast.error('Name, Code, Amount, and Interval are required');
        return;
    }

    const billingType = document.getElementById('planBillingType')?.value || 'subscription';
    const createPayload = { name, plan_code: code, amount, billing_type: billingType, billing_cycle: interval, description };
    const updatePayload = { name, description, amount, is_active: status !== 'inactive' };

    try {
        if (id) {
            await api.request(AccountsCommon.buildUrl(`billing/plans/${id}`), { method: 'PUT', body: JSON.stringify(updatePayload) });
            Toast.success('Billing plan updated');
        } else {
            await api.request(AccountsCommon.buildUrl('billing/plans'), { method: 'POST', body: JSON.stringify(createPayload) });
            Toast.success('Billing plan created');
        }
        AccountsCommon.closeModal('planModal');
        await loadPlans();
    } catch (err) {
        console.error('[Billing] savePlan error:', err);
        Toast.error(err.message || 'Failed to save billing plan');
    }
}

async function deletePlan(id) {
    const ok = await Confirm.danger('Are you sure you want to delete this billing plan?', 'Delete Billing Plan');
    if (!ok) return;
    try {
        await api.request(AccountsCommon.buildUrl(`billing/plans/${id}`), { method: 'DELETE' });
        Toast.success('Billing plan deleted');
        await loadPlans();
    } catch (err) {
        console.error('[Billing] deletePlan error:', err);
        Toast.error(err.message || 'Failed to delete billing plan');
    }
}

// ============================================================================
// 2. SUBSCRIPTIONS
// ============================================================================

async function loadSubscriptions() {
    try {
        const search = document.getElementById('subscriptionSearch')?.value || '';
        const params = { page: subscriptionPage, pageSize: PAGE_SIZE };
        if (search) params.search = search;

        const url = AccountsCommon.buildUrl('billing/subscriptions', params);
        const res = await api.request(url, { _skipSpinner: true });
        subscriptions = Array.isArray(res) ? res : (res?.data || res?.items || []);
        const total = res?.total || res?.totalCount || subscriptions.length;
        const totalPages = Math.ceil(total / PAGE_SIZE) || 1;

        renderSubscriptions();
        AccountsCommon.renderPagination('subscriptionsPagination', subscriptionPage, totalPages, (page) => {
            subscriptionPage = page;
            loadSubscriptions();
        });
    } catch (err) {
        console.error('[Billing] loadSubscriptions error:', err);
        Toast.error('Failed to load subscriptions');
    }
}

function renderSubscriptions() {
    const tbody = document.getElementById('subscriptionsTable');
    if (!tbody) return;

    if (!subscriptions.length) {
        tbody.innerHTML = `<tr class="empty-state"><td colspan="6"><div class="empty-message">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">
                <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                <circle cx="8.5" cy="7" r="4"></circle>
                <polyline points="17 11 19 13 23 9"></polyline>
            </svg><p>No subscriptions found</p></div></td></tr>`;
        return;
    }

    const planMap = {};
    billingPlans.forEach(p => { planMap[p.id] = p.name; });

    tbody.innerHTML = subscriptions.map(s => {
        const planName = planMap[s.plan_id] || s.plan_name || '-';
        const status = s.status || 'active';

        const viewBtn = `<button class="btn-icon" onclick="viewSubscription('${s.id}')" data-tooltip="View"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg></button>`;
        const cancelBtn = accountsRoles.isAdmin() && status === 'active'
            ? `<button class="btn-icon danger" onclick="cancelSubscription('${s.id}')" data-tooltip="Cancel"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg></button>`
            : '';
        const actions = viewBtn + cancelBtn;

        return `<tr>
            <td>${AccountsCommon.escapeHtml(s.customer_name || s.customer_id || '-')}</td>
            <td>${AccountsCommon.escapeHtml(planName)}</td>
            <td>${AccountsCommon.statusBadge(status)}</td>
            <td>${AccountsCommon.formatDate(s.start_date)}</td>
            <td>${AccountsCommon.formatDate(s.next_billing_date)}</td>
            <td class="actions-cell">${actions}</td>
        </tr>`;
    }).join('');
}

async function viewSubscription(id) {
    try {
        const res = await api.request(AccountsCommon.buildUrl(`billing/subscriptions/${id}`));
        const s = res?.data || res;
        if (!s) { Toast.error('Subscription not found'); return; }

        const esc = AccountsCommon.escapeHtml;
        const fmt = AccountsCommon.formatCurrency;
        const planMap = {};
        billingPlans.forEach(p => { planMap[p.id] = p.name; });
        const planName = planMap[s.plan_id] || s.plan_name || '-';
        const status = s.status || 'active';

        document.getElementById('billingDetailModalTitle').textContent = 'Subscription Details';
        document.getElementById('billingDetailBody').innerHTML = `
            <div class="detail-grid">
                <div class="detail-row"><span class="detail-label">Customer</span><span class="detail-value">${esc(s.customer_name || s.customer_id || '-')}</span></div>
                <div class="detail-row"><span class="detail-label">Plan</span><span class="detail-value">${esc(planName)}</span></div>
                <div class="detail-row"><span class="detail-label">Status</span><span class="detail-value">${AccountsCommon.statusBadge(status)}</span></div>
                <div class="detail-row"><span class="detail-label">Start Date</span><span class="detail-value">${AccountsCommon.formatDate(s.start_date)}</span></div>
                <div class="detail-row"><span class="detail-label">End Date</span><span class="detail-value">${AccountsCommon.formatDate(s.end_date)}</span></div>
                <div class="detail-row"><span class="detail-label">Next Billing</span><span class="detail-value">${AccountsCommon.formatDate(s.next_billing_date)}</span></div>
                <div class="detail-row"><span class="detail-label">Amount</span><span class="detail-value">${s.amount != null ? fmt(s.amount) : '-'}</span></div>
                <div class="detail-row"><span class="detail-label">Cancel Reason</span><span class="detail-value">${esc(s.cancel_reason || '-')}</span></div>
                <div class="detail-row"><span class="detail-label">Created</span><span class="detail-value">${AccountsCommon.formatDate(s.created_at)}</span></div>
                <div class="detail-row"><span class="detail-label">Updated</span><span class="detail-value">${AccountsCommon.formatDate(s.updated_at)}</span></div>
            </div>`;
        AccountsCommon.openModal('billingDetailModal');
    } catch (err) {
        console.error('[Billing] viewSubscription error:', err);
        Toast.error('Failed to load subscription details');
    }
}

async function generateInvoices() {
    const ok = await Confirm.show({ title: 'Generate Invoices', message: 'This will generate invoices for all active subscriptions due for billing. Continue?', confirmText: 'Generate', type: 'warning' });
    if (!ok) return;
    try {
        const res = await api.request(AccountsCommon.buildUrl('billing/generate-invoices'), { method: 'POST' });
        const count = res?.count || res?.invoices_generated || res?.data?.count || 0;
        Toast.success(`${count} invoice(s) generated successfully`);
        await loadSubscriptions();
    } catch (err) {
        console.error('[Billing] generateInvoices error:', err);
        Toast.error(err.message || 'Failed to generate invoices');
    }
}

function showCreateSubscriptionModal() {
    document.getElementById('subscriptionModalTitle').textContent = 'Create Subscription';
    document.getElementById('subscriptionForm').reset();
    document.getElementById('subscriptionId').value = '';
    populateSubPlanSelect();
    AccountsCommon.openModal('subscriptionModal');
}

async function saveSubscription() {
    const customer = document.getElementById('subCustomer').value.trim();
    const plan_id = document.getElementById('subPlan').value;
    const start_date = document.getElementById('subStartDate').value;
    const notes = document.getElementById('subNotes').value.trim();

    if (!customer || !plan_id || !start_date) {
        Toast.error('Customer, Plan, and Start Date are required');
        return;
    }

    // Backend expects customer_id (Guid) and billing_plan_id. For now send as-is; backend may accept customer_name.
    const payload = { customer_id: customer, billing_plan_id: plan_id, start_date };

    try {
        await api.request(AccountsCommon.buildUrl('billing/subscriptions'), { method: 'POST', body: JSON.stringify(payload) });
        Toast.success('Subscription created');
        AccountsCommon.closeModal('subscriptionModal');
        await loadSubscriptions();
    } catch (err) {
        console.error('[Billing] saveSubscription error:', err);
        Toast.error(err.message || 'Failed to create subscription');
    }
}

async function cancelSubscription(id) {
    const ok = await Confirm.danger('Are you sure you want to cancel this subscription?', 'Cancel Subscription');
    if (!ok) return;
    try {
        await api.request(AccountsCommon.buildUrl(`billing/subscriptions/${id}/cancel`), { method: 'POST', body: JSON.stringify({ reason: 'Cancelled by admin' }) });
        Toast.success('Subscription cancelled');
        await loadSubscriptions();
    } catch (err) {
        console.error('[Billing] cancelSubscription error:', err);
        Toast.error(err.message || 'Failed to cancel subscription');
    }
}

function populateSubPlanSelect(selectedValue) {
    const sel = document.getElementById('subPlan');
    if (!sel) return;
    const activePlans = billingPlans.filter(p => p.status !== 'inactive' && p.is_active !== false);
    sel.innerHTML = '<option value="">Select plan...</option>' +
        activePlans.map(p => `<option value="${p.id}" ${p.id === selectedValue ? 'selected' : ''}>${AccountsCommon.escapeHtml(p.name)} (${AccountsCommon.formatCurrency(p.amount)})</option>`).join('');
}

// ============================================================================
// 3. USAGE METERS
// ============================================================================

async function loadMeters() {
    try {
        const url = AccountsCommon.buildUrl('billing/usage-meters');
        const res = await api.request(url, { _skipSpinner: true });
        usageMeters = Array.isArray(res) ? res : (res?.data || res?.items || []);
        renderMeters();
        populateUsageMeterSelect();
    } catch (err) {
        console.error('[Billing] loadMeters error:', err);
        Toast.error('Failed to load usage meters');
    }
}

function renderMeters() {
    const tbody = document.getElementById('metersTable');
    if (!tbody) return;

    if (!usageMeters.length) {
        tbody.innerHTML = `<tr class="empty-state"><td colspan="4"><div class="empty-message">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">
                <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline>
            </svg><p>No usage meters configured</p></div></td></tr>`;
        return;
    }

    tbody.innerHTML = usageMeters.map(m => {
        const status = m.status || (m.is_active === false ? 'inactive' : 'active');
        const actions = accountsRoles.isAdmin()
            ? `<button class="btn-icon" onclick="editMeter('${m.id}')" data-tooltip="Edit"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
               <button class="btn-icon danger" onclick="deleteMeter('${m.id}')" data-tooltip="Delete"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>`
            : '-';

        return `<tr>
            <td>${AccountsCommon.escapeHtml(m.name)}</td>
            <td>${AccountsCommon.escapeHtml(m.unit || '-')}</td>
            <td>${AccountsCommon.statusBadge(status)}</td>
            <td class="actions-cell">${actions}</td>
        </tr>`;
    }).join('');
}

function showCreateMeterModal() {
    document.getElementById('meterModalTitle').textContent = 'Create Usage Meter';
    document.getElementById('meterForm').reset();
    document.getElementById('meterId').value = '';
    document.getElementById('meterStatus').value = 'active';
    AccountsCommon.openModal('meterModal');
}

function editMeter(id) {
    const meter = usageMeters.find(m => m.id === id);
    if (!meter) return;

    document.getElementById('meterModalTitle').textContent = 'Edit Usage Meter';
    document.getElementById('meterId').value = meter.id;
    document.getElementById('meterName').value = meter.name || '';
    document.getElementById('meterUnit').value = meter.unit || '';
    document.getElementById('meterStatus').value = meter.status || 'active';
    document.getElementById('meterDescription').value = meter.description || '';
    AccountsCommon.openModal('meterModal');
}

async function saveMeter() {
    const id = document.getElementById('meterId').value;
    const name = document.getElementById('meterName').value.trim();
    const unit = document.getElementById('meterUnit').value.trim();
    const status = document.getElementById('meterStatus').value;
    const description = document.getElementById('meterDescription').value.trim();

    if (!name || !unit) {
        Toast.error('Name and Unit are required');
        return;
    }

    // Backend expects: meter_code, name, unit, rate_per_unit
    const payload = { meter_code: name.toLowerCase().replace(/\s+/g, '_'), name, unit, rate_per_unit: 1 };

    try {
        if (id) {
            await api.request(AccountsCommon.buildUrl(`billing/usage-meters/${id}`), { method: 'PUT', body: JSON.stringify(payload) });
            Toast.success('Usage meter updated');
        } else {
            await api.request(AccountsCommon.buildUrl('billing/usage-meters'), { method: 'POST', body: JSON.stringify(payload) });
            Toast.success('Usage meter created');
        }
        AccountsCommon.closeModal('meterModal');
        await loadMeters();
    } catch (err) {
        console.error('[Billing] saveMeter error:', err);
        Toast.error(err.message || 'Failed to save usage meter');
    }
}

async function deleteMeter(id) {
    const ok = await Confirm.danger('Are you sure you want to delete this usage meter?', 'Delete Usage Meter');
    if (!ok) return;
    try {
        await api.request(AccountsCommon.buildUrl(`billing/usage-meters/${id}`), { method: 'DELETE' });
        Toast.success('Usage meter deleted');
        await loadMeters();
    } catch (err) {
        console.error('[Billing] deleteMeter error:', err);
        Toast.error(err.message || 'Failed to delete usage meter');
    }
}

function populateUsageMeterSelect() {
    const sel = document.getElementById('usageMeter');
    if (!sel) return;
    const activeMeters = usageMeters.filter(m => m.status !== 'inactive' && m.is_active !== false);
    sel.innerHTML = '<option value="">Select meter...</option>' +
        activeMeters.map(m => `<option value="${m.id}">${AccountsCommon.escapeHtml(m.name)} (${AccountsCommon.escapeHtml(m.unit)})</option>`).join('');
}

async function recordUsage() {
    const meter_id = document.getElementById('usageMeter').value;
    const customer = document.getElementById('usageCustomer').value.trim();
    const quantity = parseFloat(document.getElementById('usageQuantity').value);
    const date = document.getElementById('usageDate').value || null;

    if (!meter_id || !customer || isNaN(quantity)) {
        Toast.error('Meter, Customer, and Quantity are required');
        return;
    }

    try {
        await api.request(AccountsCommon.buildUrl('billing/usage'), {
            method: 'POST',
            body: JSON.stringify({ meter_code: usageMeters.find(m => m.id === meter_id)?.meter_code || meter_id, customer_id: customer, quantity })
        });
        Toast.success('Usage recorded successfully');
        document.getElementById('recordUsageForm').reset();
    } catch (err) {
        console.error('[Billing] recordUsage error:', err);
        Toast.error(err.message || 'Failed to record usage');
    }
}

// ============================================================================
// 4. TOKENS
// ============================================================================

async function loadTokenBalance() {
    const customer = document.getElementById('tokenCustomer').value.trim();
    const balanceEl = document.getElementById('tokenBalance');
    if (!customer) {
        if (balanceEl) balanceEl.textContent = '-';
        return;
    }

    try {
        const url = AccountsCommon.buildUrl(`billing/tokens/${customer}`);
        const res = await api.request(url, { _skipSpinner: true });
        const balance = res?.balance ?? res?.data?.balance ?? res ?? 0;
        if (balanceEl) balanceEl.textContent = typeof balance === 'number' ? balance.toLocaleString() : balance;
    } catch (err) {
        console.error('[Billing] loadTokenBalance error:', err);
        if (balanceEl) balanceEl.textContent = '-';
    }
}

async function purchaseTokens() {
    const customer = document.getElementById('tokenCustomer').value.trim();
    const amount = parseInt(document.getElementById('purchaseAmount').value);
    const notes = document.getElementById('purchaseNotes').value.trim();

    if (!customer) {
        Toast.error('Please select a customer first');
        return;
    }
    if (isNaN(amount) || amount <= 0) {
        Toast.error('Please enter a valid amount');
        return;
    }

    try {
        await api.request(AccountsCommon.buildUrl('billing/tokens/purchase'), {
            method: 'POST',
            body: JSON.stringify({ customer_id: customer, amount })
        });
        Toast.success(`${amount} tokens purchased successfully`);
        document.getElementById('purchaseTokenForm').reset();
        await loadTokenBalance();
    } catch (err) {
        console.error('[Billing] purchaseTokens error:', err);
        Toast.error(err.message || 'Failed to purchase tokens');
    }
}

async function deductTokens() {
    const customer = document.getElementById('tokenCustomer').value.trim();
    const amount = parseInt(document.getElementById('deductAmount').value);
    const notes = document.getElementById('deductNotes').value.trim();

    if (!customer) {
        Toast.error('Please select a customer first');
        return;
    }
    if (isNaN(amount) || amount <= 0) {
        Toast.error('Please enter a valid amount');
        return;
    }

    try {
        await api.request(AccountsCommon.buildUrl('billing/tokens/deduct'), {
            method: 'POST',
            body: JSON.stringify({ customer_id: customer, amount, reason: notes })
        });
        Toast.success(`${amount} tokens deducted successfully`);
        document.getElementById('deductTokenForm').reset();
        await loadTokenBalance();
    } catch (err) {
        console.error('[Billing] deductTokens error:', err);
        Toast.error(err.message || 'Failed to deduct tokens');
    }
}
