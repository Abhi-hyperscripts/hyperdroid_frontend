/**
 * AccountsService — Accounts Payable Page
 *
 * Handles 4 sidebar tabs:
 *   1. Vendor Bills          3. AP Aging
 *   2. Payments              4. Vendor Statements
 */

// ============================================================================
// GLOBAL STATE
// ============================================================================

let vendorBills = [];
let vendors = [];
let accounts = [];
let bankAccounts = [];
let billLines = [];
let currentBillPage = 1;
const PAGE_SIZE = 50;

// Dropdown instances
let billVendorFilterDropdown = null;
let paymentVendorFilterDropdown = null;
let stmtVendorDropdown = null;

// ============================================================================
// PAGE INIT
// ============================================================================

document.addEventListener('DOMContentLoaded', async function () {
    if (!await AccountsCommon.initPage('payables', '../')) return;

    const tabNames = {
        'vendor-bills': 'Vendor Bills',
        'vendor-payments': 'Payments',
        'ap-aging': 'AP Aging',
        'vendor-statements': 'Vendor Statements'
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
        case 'vendor-bills':      loadVendorBills(); break;
        case 'vendor-payments':   loadVendorPayments(); break;
        case 'ap-aging':          loadAPAging(); break;
        case 'vendor-statements': break; // user-triggered
    }
}

// ============================================================================
// INITIAL DATA LOAD
// ============================================================================

async function loadInitialData() {
    try {
        const [vendorRes, accountRes, bankRes] = await Promise.all([
            api.request(AccountsCommon.buildUrl('vendors'), { _skipSpinner: true }).catch(() => []),
            api.request(AccountsCommon.buildUrl('coa'), { _skipSpinner: true }).catch(() => []),
            api.request(AccountsCommon.buildUrl('coa', { accountTypeClassification: 'asset', search: 'bank' }), { _skipSpinner: true }).catch(() => [])
        ]);

        vendors = Array.isArray(vendorRes) ? vendorRes : (vendorRes?.data || vendorRes?.items || []);
        const acctData = Array.isArray(accountRes) ? accountRes : (accountRes?.data || accountRes?.items || []);
        accounts = acctData;
        const bankData = Array.isArray(bankRes) ? bankRes : (bankRes?.data || bankRes?.items || []);
        bankAccounts = bankData;

        await loadVendorBills();
    } catch (err) {
        console.error('[Payables] loadInitialData error:', err);
    }
}

// ============================================================================
// SEARCH LISTENERS
// ============================================================================

function setupSearchListeners() {
    const debounce = (fn, ms = 300) => {
        let timer;
        return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); };
    };

    const billSearch = document.getElementById('billSearch');
    if (billSearch) billSearch.addEventListener('input', debounce(() => { currentBillPage = 1; loadVendorBills(); }));
}

// ============================================================================
// 1. VENDOR BILLS
// ============================================================================

async function loadVendorBills() {
    try {
        const vendorId = billVendorFilterDropdown?.getValue?.() || '';
        const status = document.getElementById('billStatusFilter')?.value || '';
        const fromDate = document.getElementById('billFromDate')?.value || '';
        const toDate = document.getElementById('billToDate')?.value || '';
        const search = document.getElementById('billSearch')?.value || '';

        const params = { limit: PAGE_SIZE, offset: (currentBillPage - 1) * PAGE_SIZE };
        if (vendorId) params.vendorId = vendorId;
        if (status) params.status = status;
        if (fromDate) params.fromDate = fromDate;
        if (toDate) params.toDate = toDate;
        if (search) params.search = search;

        const url = AccountsCommon.buildUrl('vendor-bills', params);
        const res = await api.request(url, { _skipSpinner: true });
        const data = res?.data || res?.items || (Array.isArray(res) ? res : []);
        vendorBills = data;

        const total = res?.total || res?.totalCount || vendorBills.length;
        const totalPages = Math.ceil(total / PAGE_SIZE) || 1;

        // Update stats
        const stats = res?.stats || {};
        const el = (id, val) => { const e = document.getElementById(id); if (e) e.textContent = val; };
        el('totalBills', stats.total_bills ?? total);
        el('draftBills', stats.draft_count ?? vendorBills.filter(b => b.status === 'draft').length);
        el('approvedBills', stats.approved_count ?? vendorBills.filter(b => b.status === 'approved').length);
        el('totalOutstanding', AccountsCommon.formatCurrency(stats.total_outstanding ?? vendorBills.reduce((s, b) => s + (parseFloat(b.balance) || 0), 0)));

        renderBillsTable();
        AccountsCommon.renderPagination('billsPagination', currentBillPage, totalPages, (page) => {
            currentBillPage = page;
            loadVendorBills();
        });
    } catch (err) {
        console.error('[Payables] loadVendorBills error:', err);
        Toast.error('Failed to load vendor bills');
    }
}

function renderBillsTable() {
    const tbody = document.getElementById('vendorBillsTable');
    if (!tbody) return;
    if (!vendorBills.length) {
        tbody.innerHTML = `<tr class="empty-state"><td colspan="11"><div class="empty-message">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg><p>No vendor bills found</p></div></td></tr>`;
        return;
    }
    const vendorMap = {};
    vendors.forEach(v => { vendorMap[v.id] = v.name || v.vendor_name; });
    const editSvg = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>';
    const checkSvg = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>';
    const cancelSvg = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>';
    const isAdmin = accountsRoles.isAdmin();
    const esc = AccountsCommon.escapeHtml, fmt = AccountsCommon.formatCurrency, fmtD = AccountsCommon.formatDate;

    tbody.innerHTML = vendorBills.map(b => {
        let actions = '';
        if (isAdmin && b.status === 'draft') {
            actions = `<button class="btn-icon" onclick="editBill('${b.id}')" data-tooltip="Edit">${editSvg}</button><button class="btn-icon" onclick="approveBill('${b.id}')" data-tooltip="Approve">${checkSvg}</button><button class="btn-icon danger" onclick="cancelBill('${b.id}')" data-tooltip="Cancel">${cancelSvg}</button>`;
        } else if (isAdmin && (b.status === 'approved' || b.status === 'partially_paid')) {
            actions = `<button class="btn btn-sm btn-outline" onclick="showRecordPaymentModal('${b.id}')">Pay</button>`;
        }
        return `<tr>
            <td><code>${esc(b.bill_number || '-')}</code></td>
            <td>${esc(vendorMap[b.vendor_id] || b.vendor_name || '-')}</td>
            <td>${fmtD(b.bill_date)}</td><td>${fmtD(b.due_date)}</td>
            <td class="text-right">${fmt(b.subtotal)}</td><td class="text-right">${fmt(b.tax_amount || 0)}</td>
            <td class="text-right">${fmt(b.total)}</td><td class="text-right">${fmt(b.paid_amount || 0)}</td>
            <td class="text-right">${fmt(b.balance || b.total)}</td>
            <td>${AccountsCommon.statusBadge(b.status)}</td>
            <td class="actions-cell">${actions || '<span class="text-secondary">-</span>'}</td>
        </tr>`;
    }).join('');
}

// ============================================================================
// BILL MODAL — CREATE / EDIT
// ============================================================================

function showCreateBillModal() {
    document.getElementById('billModalTitle').textContent = 'Create Vendor Bill';
    document.getElementById('billForm').reset();
    document.getElementById('billId').value = '';
    document.getElementById('billDate').value = new Date().toISOString().split('T')[0];
    populateBillVendorSelect();
    clearBillLines();
    addBillLine();
    AccountsCommon.openModal('vendorBillModal');
}

async function editBill(id) {
    try {
        const res = await api.request(AccountsCommon.buildUrl(`vendor-bills/${id}`));
        const bill = res?.data || res;
        if (!bill) { Toast.error('Bill not found'); return; }

        document.getElementById('billModalTitle').textContent = 'Edit Vendor Bill';
        document.getElementById('billId').value = bill.id;
        document.getElementById('billDate').value = (bill.bill_date || '').substring(0, 10);
        document.getElementById('billDueDate').value = (bill.due_date || '').substring(0, 10);
        document.getElementById('billPoReference').value = bill.po_reference || '';
        document.getElementById('billNotes').value = bill.notes || '';
        populateBillVendorSelect(bill.vendor_id);

        clearBillLines();
        const lines = bill.lines || bill.line_items || [];
        if (lines.length) {
            lines.forEach(l => addBillLine(l));
        } else {
            addBillLine();
        }
        calculateBillTotals();
        AccountsCommon.openModal('vendorBillModal');
    } catch (err) {
        console.error('[Payables] editBill error:', err);
        Toast.error('Failed to load bill details');
    }
}

function populateBillVendorSelect(selectedId) {
    const sel = document.getElementById('billVendor');
    if (!sel) return;
    sel.innerHTML = '<option value="">Select Vendor...</option>' +
        vendors.map(v => `<option value="${v.id}" ${v.id === selectedId ? 'selected' : ''}>${AccountsCommon.escapeHtml(v.name || v.vendor_name)}</option>`).join('');
}

// ============================================================================
// LINE ITEMS
// ============================================================================

function clearBillLines() {
    billLines = [];
    const tbody = document.getElementById('billLinesBody');
    if (tbody) tbody.innerHTML = '';
}

function addBillLine(data) {
    const idx = billLines.length;
    // Normalize: backend uses unit_price, frontend uses rate
    if (data && data.unit_price !== undefined && data.rate === undefined) {
        data.rate = data.unit_price;
    }
    billLines.push(data || { description: '', account_id: '', quantity: 1, rate: 0 });

    const tbody = document.getElementById('billLinesBody');
    if (!tbody) return;

    const row = document.createElement('tr');
    row.dataset.lineIdx = idx;

    const d = billLines[idx];
    const accountOpts = '<option value="">Select...</option>' +
        accounts.map(a => `<option value="${a.id}" ${a.id === d.account_id ? 'selected' : ''}>${AccountsCommon.escapeHtml(a.code ? a.code + ' - ' + a.name : a.name)}</option>`).join('');

    const amt = ((parseFloat(d.quantity) || 0) * (parseFloat(d.rate) || 0)).toFixed(2);

    row.innerHTML = `
        <td><input type="text" class="form-control form-control-sm line-desc" value="${AccountsCommon.escapeHtml(d.description || '')}" placeholder="Description"></td>
        <td><select class="form-control form-control-sm line-account">${accountOpts}</select></td>
        <td><input type="number" class="form-control form-control-sm line-qty" value="${d.quantity ?? 1}" min="0" step="1" onchange="calculateBillTotals()" oninput="calculateBillTotals()"></td>
        <td><input type="number" class="form-control form-control-sm line-rate" value="${d.rate ?? 0}" min="0" step="0.01" onchange="calculateBillTotals()" oninput="calculateBillTotals()"></td>
        <td class="text-right line-amount">${amt}</td>
        <td><button type="button" class="btn-icon danger" onclick="removeBillLine(${idx})" data-tooltip="Remove"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button></td>`;
    tbody.appendChild(row);
}

function removeBillLine(index) {
    const tbody = document.getElementById('billLinesBody');
    if (!tbody) return;
    const row = tbody.querySelector(`tr[data-line-idx="${index}"]`);
    if (row) row.remove();
    billLines[index] = null; // mark removed
    calculateBillTotals();
}

function calculateBillTotals() {
    const tbody = document.getElementById('billLinesBody');
    if (!tbody) return;
    let subtotal = 0;

    tbody.querySelectorAll('tr').forEach(row => {
        const qty = parseFloat(row.querySelector('.line-qty')?.value) || 0;
        const rate = parseFloat(row.querySelector('.line-rate')?.value) || 0;
        const amt = qty * rate;
        const amtCell = row.querySelector('.line-amount');
        if (amtCell) amtCell.textContent = amt.toFixed(2);
        subtotal += amt;
    });

    const el = document.getElementById('billSubtotal');
    if (el) el.textContent = subtotal.toFixed(2);
}

// ============================================================================
// SAVE / APPROVE / CANCEL BILL
// ============================================================================

async function saveBill(approve = false) {
    const id = document.getElementById('billId').value;
    const vendorId = document.getElementById('billVendor').value;
    const billDate = document.getElementById('billDate').value;
    const dueDate = document.getElementById('billDueDate').value;
    const poReference = document.getElementById('billPoReference').value.trim();
    const notes = document.getElementById('billNotes').value.trim();

    if (!vendorId || !billDate || !dueDate) {
        Toast.error('Vendor, Bill Date, and Due Date are required');
        return;
    }

    // Collect line items from DOM
    const tbody = document.getElementById('billLinesBody');
    const lines = [];
    tbody?.querySelectorAll('tr').forEach(row => {
        const description = row.querySelector('.line-desc')?.value.trim() || '';
        const account_id = row.querySelector('.line-account')?.value || '';
        const quantity = parseFloat(row.querySelector('.line-qty')?.value) || 0;
        const rate = parseFloat(row.querySelector('.line-rate')?.value) || 0;
        if (description || account_id) {
            lines.push({ description, account_id: account_id || null, quantity, unit_price: rate });
        }
    });

    if (!lines.length) {
        Toast.error('At least one line item is required');
        return;
    }

    const payload = {
        vendor_id: vendorId, bill_date: billDate, due_date: dueDate,
        po_reference: poReference, notes, lines,
        status: approve ? 'approved' : 'draft'
    };

    try {
        if (id) {
            await api.request(AccountsCommon.buildUrl(`vendor-bills/${id}`), { method: 'PUT', body: JSON.stringify(payload) });
            Toast.success('Bill updated');
        } else {
            await api.request(AccountsCommon.buildUrl('vendor-bills'), { method: 'POST', body: JSON.stringify(payload) });
            Toast.success(approve ? 'Bill created and approved' : 'Bill saved as draft');
        }
        AccountsCommon.closeModal('vendorBillModal');
        await loadVendorBills();
    } catch (err) {
        console.error('[Payables] saveBill error:', err);
        Toast.error(err.message || 'Failed to save bill');
    }
}

async function approveBill(id) {
    const ok = await Confirm.show({ title: 'Approve Bill', message: 'Approve this vendor bill?', confirmText: 'Approve', type: 'info' });
    if (!ok) return;
    try {
        await api.request(AccountsCommon.buildUrl(`vendor-bills/${id}/approve`), { method: 'POST' });
        Toast.success('Bill approved');
        await loadVendorBills();
    } catch (err) {
        console.error('[Payables] approveBill error:', err);
        Toast.error(err.message || 'Failed to approve bill');
    }
}

async function cancelBill(id) {
    const ok = await Confirm.danger('Cancel this vendor bill? This cannot be undone.', 'Cancel Bill');
    if (!ok) return;
    try {
        await api.request(AccountsCommon.buildUrl(`vendor-bills/${id}/cancel`), { method: 'POST' });
        Toast.success('Bill cancelled');
        await loadVendorBills();
    } catch (err) {
        console.error('[Payables] cancelBill error:', err);
        Toast.error(err.message || 'Failed to cancel bill');
    }
}

// ============================================================================
// BULK BILL IMPORT
// ============================================================================

function showBulkBillModal() {
    document.getElementById('bulkBillData').value = '';
    const fileInput = document.getElementById('bulkBillFile');
    if (fileInput) fileInput.value = '';
    AccountsCommon.openModal('bulkBillModal');
}

function handleBulkBillFileUpload(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function (e) {
        const content = e.target.result;
        if (file.name.endsWith('.json')) {
            document.getElementById('bulkBillData').value = content;
        } else if (file.name.endsWith('.csv')) {
            // Basic CSV to JSON conversion — assume header row
            try {
                const lines = content.split('\n').filter(l => l.trim());
                if (lines.length < 2) { Toast.error('CSV must have a header row and at least one data row'); return; }
                const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
                const rows = lines.slice(1).map(line => {
                    const vals = line.split(',').map(v => v.trim().replace(/^"|"$/g, ''));
                    const obj = {};
                    headers.forEach((h, i) => { obj[h] = vals[i] || ''; });
                    return obj;
                });
                document.getElementById('bulkBillData').value = JSON.stringify(rows, null, 2);
            } catch (csvErr) {
                Toast.error('Failed to parse CSV file');
            }
        } else {
            Toast.error('Unsupported file type. Use .json or .csv');
        }
    };
    reader.readAsText(file);
}

async function submitBulkBills() {
    const text = document.getElementById('bulkBillData').value.trim();
    if (!text) { Toast.error('Please paste bill data or upload a file'); return; }
    try {
        const bills = JSON.parse(text);
        if (!Array.isArray(bills)) { Toast.error('Data must be a JSON array'); return; }
        if (!bills.length) { Toast.error('Array is empty'); return; }
        const res = await api.request(AccountsCommon.buildUrl('vendor-bills/bulk'), {
            method: 'POST',
            body: JSON.stringify({ bills })
        });
        const created = res?.created || res?.success_count || bills.length;
        const failed = res?.failed || res?.error_count || 0;
        if (failed > 0) {
            Toast.warning(`${created} bills created, ${failed} failed`);
        } else {
            Toast.success(`${created} bills created successfully`);
        }
        AccountsCommon.closeModal('bulkBillModal');
        await loadVendorBills();
    } catch (err) {
        console.error('[Payables] submitBulkBills error:', err);
        Toast.error(err.message || 'Failed to import bills');
    }
}

// ============================================================================
// 2. VENDOR PAYMENTS
// ============================================================================

async function loadVendorPayments() {
    try {
        const vendorId = paymentVendorFilterDropdown?.getValue?.() || '';
        const params = {};
        if (vendorId) params.vendorId = vendorId;

        const url = AccountsCommon.buildUrl('vendor-bills/payments', params);
        const res = await api.request(url, { _skipSpinner: true });
        const payments = Array.isArray(res) ? res : (res?.data || res?.items || []);
        renderPaymentsTable(payments);
    } catch (err) {
        console.error('[Payables] loadVendorPayments error:', err);
        Toast.error('Failed to load payments');
    }
}

function renderPaymentsTable(payments) {
    const tbody = document.getElementById('vendorPaymentsTable');
    if (!tbody) return;
    if (!payments.length) {
        tbody.innerHTML = `<tr class="empty-state"><td colspan="7"><div class="empty-message">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg><p>No payments recorded</p></div></td></tr>`;
        return;
    }
    const vendorMap = {}, acctMap = {};
    vendors.forEach(v => { vendorMap[v.id] = v.name || v.vendor_name; });
    accounts.forEach(a => { acctMap[a.id] = a.name; });
    const esc = AccountsCommon.escapeHtml, fmt = AccountsCommon.formatCurrency, fmtD = AccountsCommon.formatDate;
    const voidSvg = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>';
    const isAdmin = accountsRoles.isAdmin();

    tbody.innerHTML = payments.map(p => `<tr>
        <td><code>${esc(p.payment_number || '-')}</code></td>
        <td>${esc(vendorMap[p.vendor_id] || p.vendor_name || '-')}</td>
        <td>${fmtD(p.payment_date)}</td>
        <td class="text-right">${fmt(p.amount)}</td>
        <td>${esc(acctMap[p.bank_account_id] || p.bank_account_name || '-')}</td>
        <td>${esc(p.reference_number || '-')}</td>
        <td class="actions-cell">${isAdmin ? `<button class="btn-icon danger" onclick="deletePayment('${p.id}')" data-tooltip="Void">${voidSvg}</button>` : '-'}</td>
    </tr>`).join('');
}

// ============================================================================
// PAYMENT MODAL
// ============================================================================

function showRecordPaymentModal(billId) {
    document.getElementById('paymentForm').reset();
    document.getElementById('paymentDate').value = new Date().toISOString().split('T')[0];
    populatePaymentVendorSelect();
    populatePaymentBankSelect();

    const allocBody = document.getElementById('paymentAllocBody');
    if (allocBody) allocBody.innerHTML = '<tr class="empty-state"><td colspan="4" style="text-align:center; padding:1rem; color:var(--text-secondary);">Select a vendor to see open bills</td></tr>';

    if (billId) {
        const bill = vendorBills.find(b => b.id === billId);
        if (bill) {
            document.getElementById('paymentVendor').value = bill.vendor_id;
            document.getElementById('paymentAmount').value = bill.balance || bill.total || '';
            loadVendorOpenBills(billId);
        }
    }
    AccountsCommon.openModal('vendorPaymentModal');
}

function populatePaymentVendorSelect(selectedId) {
    const sel = document.getElementById('paymentVendor');
    if (!sel) return;
    sel.innerHTML = '<option value="">Select Vendor...</option>' +
        vendors.map(v => `<option value="${v.id}" ${v.id === selectedId ? 'selected' : ''}>${AccountsCommon.escapeHtml(v.name || v.vendor_name)}</option>`).join('');
}

function populatePaymentBankSelect(selectedId) {
    const sel = document.getElementById('paymentBankAccount');
    if (!sel) return;
    sel.innerHTML = '<option value="">Select Account...</option>' +
        bankAccounts.map(a => `<option value="${a.id}" ${a.id === selectedId ? 'selected' : ''}>${AccountsCommon.escapeHtml(a.code ? a.code + ' - ' + a.name : a.name)}</option>`).join('');
}

async function loadVendorOpenBills(preSelectBillId) {
    const vendorId = document.getElementById('paymentVendor')?.value;
    const allocBody = document.getElementById('paymentAllocBody');
    if (!allocBody) return;

    if (!vendorId) {
        allocBody.innerHTML = '<tr class="empty-state"><td colspan="4" style="text-align:center; padding:1rem; color:var(--text-secondary);">Select a vendor to see open bills</td></tr>';
        return;
    }

    try {
        const url = AccountsCommon.buildUrl('vendor-bills', { vendorId, status: 'approved' });
        const res = await api.request(url, { _skipSpinner: true });
        const openBills = (Array.isArray(res) ? res : (res?.data || res?.items || [])).filter(b => parseFloat(b.balance || b.total) > 0);

        if (!openBills.length) {
            allocBody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding:1rem; color:var(--text-secondary);">No open bills for this vendor</td></tr>';
            return;
        }

        allocBody.innerHTML = openBills.map(b => {
            const balance = parseFloat(b.balance || b.total) || 0;
            const preAlloc = (preSelectBillId === b.id) ? balance.toFixed(2) : '';
            return `<tr>
                <td><code>${AccountsCommon.escapeHtml(b.bill_number || '-')}</code></td>
                <td>${AccountsCommon.formatDate(b.due_date)}</td>
                <td class="text-right">${AccountsCommon.formatCurrency(balance)}</td>
                <td><input type="number" class="form-control form-control-sm alloc-amount" data-bill-id="${b.id}" data-balance="${balance}" value="${preAlloc}" min="0" max="${balance}" step="0.01" placeholder="0.00"></td>
            </tr>`;
        }).join('');
    } catch (err) {
        console.error('[Payables] loadVendorOpenBills error:', err);
        allocBody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding:1rem; color:var(--text-secondary);">Failed to load bills</td></tr>';
    }
}

async function saveVendorPayment() {
    const vendorId = document.getElementById('paymentVendor').value;
    const paymentDate = document.getElementById('paymentDate').value;
    const amount = parseFloat(document.getElementById('paymentAmount').value) || 0;
    const bankAccountId = document.getElementById('paymentBankAccount').value;
    const referenceNumber = document.getElementById('paymentReference').value.trim();

    if (!vendorId || !paymentDate || !amount || !bankAccountId) {
        Toast.error('Vendor, Date, Amount, and Bank Account are required');
        return;
    }

    // Collect allocations
    const allocations = [];
    document.querySelectorAll('.alloc-amount').forEach(input => {
        const allocAmt = parseFloat(input.value) || 0;
        if (allocAmt > 0) {
            allocations.push({ bill_id: input.dataset.billId, amount: allocAmt });
        }
    });

    const payload = {
        vendor_id: vendorId, payment_date: paymentDate, amount,
        bank_account_id: bankAccountId, reference_number: referenceNumber,
        payment_method: document.getElementById('paymentMethod')?.value || 'bank_transfer',
        allocations
    };

    try {
        await api.request(AccountsCommon.buildUrl('vendor-bills/payments'), { method: 'POST', body: JSON.stringify(payload) });
        Toast.success('Payment recorded');
        AccountsCommon.closeModal('vendorPaymentModal');
        await loadVendorBills();
        await loadVendorPayments();
    } catch (err) {
        console.error('[Payables] saveVendorPayment error:', err);
        Toast.error(err.message || 'Failed to record payment');
    }
}

async function deletePayment(id) {
    const ok = await Confirm.danger('Void this payment? The allocated bills will be updated.', 'Void Payment');
    if (!ok) return;
    try {
        await api.request(AccountsCommon.buildUrl(`vendor-bills/payments/${id}`), { method: 'DELETE' });
        Toast.success('Payment voided');
        await loadVendorPayments();
        await loadVendorBills();
    } catch (err) {
        console.error('[Payables] deletePayment error:', err);
        Toast.error(err.message || 'Failed to void payment');
    }
}

// ============================================================================
// 3. AP AGING
// ============================================================================

async function loadAPAging() {
    try {
        const url = AccountsCommon.buildUrl('vendor-bills/aging');
        const res = await api.request(url, { _skipSpinner: true });
        const rawData = Array.isArray(res) ? res : (res?.data || res?.items || []);

        // Normalize field names from backend (current_amount, days_30...) to frontend (current, days_1_30...)
        const data = rawData.map(row => ({
            vendor_name: row.vendor_name,
            vendor_id: row.vendor_id,
            current: row.current_amount ?? row.current ?? 0,
            days_1_30: row.days_30 ?? row.days_1_30 ?? 0,
            days_31_60: row.days_60 ?? row.days_31_60 ?? 0,
            days_61_90: row.days_90 ?? row.days_61_90 ?? 0,
            days_90_plus: row.days_120_plus ?? row.days_90_plus ?? 0,
            total: row.total ?? 0
        }));

        // Compute summary from data
        const summary = res?.summary || {};
        const sumField = (field) => data.reduce((s, r) => s + (parseFloat(r[field]) || 0), 0);
        const fmt = (v) => AccountsCommon.formatCurrency(v || 0);
        const el = (id, val) => { const e = document.getElementById(id); if (e) e.textContent = val; };
        el('apCurrent', fmt(summary.current ?? sumField('current')));
        el('ap30', fmt(summary.days_1_30 ?? sumField('days_1_30')));
        el('ap60', fmt(summary.days_31_60 ?? sumField('days_31_60')));
        el('ap90', fmt(summary.days_61_90 ?? sumField('days_61_90')));
        el('ap90Plus', fmt(summary.days_90_plus ?? sumField('days_90_plus')));

        renderAPAgingTable(data);
    } catch (err) {
        console.error('[Payables] loadAPAging error:', err);
        Toast.error('Failed to load AP aging');
    }
}

function renderAPAgingTable(data) {
    const tbody = document.getElementById('apAgingTable');
    if (!tbody) return;
    if (!data.length) {
        tbody.innerHTML = `<tr class="empty-state"><td colspan="7"><div class="empty-message">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg><p>No aging data available</p></div></td></tr>`;
        return;
    }
    const fmt = (v) => AccountsCommon.formatCurrency(v || 0);
    const warn = (v) => (parseFloat(v) || 0) > 0 ? ' style="color:var(--color-error)"' : '';

    tbody.innerHTML = data.map(row => {
        const t = [row.current, row.days_1_30, row.days_31_60, row.days_61_90, row.days_90_plus].reduce((s, v) => s + (parseFloat(v) || 0), 0);
        return `<tr><td>${AccountsCommon.escapeHtml(row.vendor_name || '-')}</td>
            <td class="text-right">${fmt(row.current)}</td><td class="text-right">${fmt(row.days_1_30)}</td>
            <td class="text-right"${warn(row.days_31_60)}>${fmt(row.days_31_60)}</td>
            <td class="text-right"${warn(row.days_61_90)}>${fmt(row.days_61_90)}</td>
            <td class="text-right"${warn(row.days_90_plus)}>${fmt(row.days_90_plus)}</td>
            <td class="text-right"><strong>${fmt(t)}</strong></td></tr>`;
    }).join('');
}

// ============================================================================
// 4. VENDOR STATEMENTS
// ============================================================================

async function loadVendorStatement() {
    const vendorId = stmtVendorDropdown?.getValue?.();
    const fromDate = document.getElementById('stmtFromDate')?.value || '';
    const toDate = document.getElementById('stmtToDate')?.value || '';
    const container = document.getElementById('vendorStatementContent');

    if (!vendorId) {
        Toast.error('Please select a vendor');
        return;
    }

    try {
        const params = {};
        if (fromDate) params.fromDate = fromDate;
        if (toDate) params.toDate = toDate;

        const url = AccountsCommon.buildUrl(`vendor-bills/vendors/${vendorId}/statement`, params);
        const res = await api.request(url, { _skipSpinner: true });
        const stmt = res?.data || res;

        // Merge bills and payments into a single transaction list
        const bills = (stmt.bills || []).map(b => ({
            date: b.bill_date,
            reference: b.bill_number,
            description: 'Vendor Bill',
            debit: parseFloat(b.total_amount) || 0,
            credit: 0
        }));
        const payments = (stmt.payments || []).map(p => ({
            date: p.payment_date,
            reference: p.payment_number,
            description: `Payment (${p.payment_method || 'bank_transfer'})`,
            debit: 0,
            credit: parseFloat(p.amount) || 0
        }));
        const txns = stmt.transactions || [...bills, ...payments].sort((a, b) => new Date(a.date) - new Date(b.date));

        if (!txns.length) {
            container.innerHTML = '<div class="empty-message"><p>No transactions found for this vendor in the selected period</p></div>';
            return;
        }

        const vendor = vendors.find(v => v.id === vendorId);
        const vendorName = stmt.vendor_name || (vendor ? (vendor.name || vendor.vendor_name) : 'Vendor');
        const fmt = AccountsCommon.formatCurrency, esc = AccountsCommon.escapeHtml, fmtD = AccountsCommon.formatDate;
        let bal = parseFloat(stmt.opening_balance) || 0;
        const rows = txns.map(t => {
            const dr = parseFloat(t.debit) || parseFloat(t.bill_amount) || 0;
            const cr = parseFloat(t.credit) || parseFloat(t.payment_amount) || 0;
            bal += dr - cr;
            return `<tr><td>${fmtD(t.date || t.bill_date || t.payment_date)}</td>
                <td>${esc(t.reference || t.bill_number || t.payment_number || '-')}</td>
                <td>${esc(t.description || t.type || '-')}</td>
                <td class="text-right">${dr ? fmt(dr) : '-'}</td><td class="text-right">${cr ? fmt(cr) : '-'}</td>
                <td class="text-right">${fmt(bal)}</td></tr>`;
        }).join('');

        const closingBal = bal;
        const totalBilled = fmt(stmt.total_billed || bills.reduce((s, b) => s + b.debit, 0));
        const totalPaid = fmt(stmt.total_paid || payments.reduce((s, p) => s + p.credit, 0));

        container.innerHTML = `<div class="glass-card" style="margin-bottom:1rem;"><div class="glass-card-body">
            <h4>${esc(vendorName)} — Statement</h4>
            <p style="color:var(--text-secondary);margin:0;">${fromDate ? fmtD(fromDate) : 'Start'} to ${toDate ? fmtD(toDate) : 'Today'} | Total Billed: ${totalBilled} | Total Paid: ${totalPaid} | Outstanding: <strong>${fmt(stmt.total_outstanding || closingBal)}</strong></p>
            </div></div>
            <div class="data-table-container"><table class="data-table">
            <thead><tr><th>Date</th><th>Reference</th><th>Description</th><th>Debit</th><th>Credit</th><th>Balance</th></tr></thead>
            <tbody>${rows || '<tr><td colspan="6" style="text-align:center;padding:1rem;">No transactions</td></tr>'}</tbody>
            </table></div>`;
    } catch (err) {
        console.error('[Payables] loadVendorStatement error:', err);
        Toast.error('Failed to load vendor statement');
        container.innerHTML = '<div class="empty-message"><p>Failed to load statement</p></div>';
    }
}

// ============================================================================
// SEARCHABLE DROPDOWNS INIT
// ============================================================================

function initDropdowns() {
    const vendorOpts = [{ value: '', label: 'All Vendors' }, ...vendors.map(v => ({ value: v.id, label: v.name || v.vendor_name }))];

    // Bill vendor filter
    const billVendorContainer = document.getElementById('billVendorFilterContainer');
    if (billVendorContainer) {
        billVendorFilterDropdown = new SearchableDropdown(billVendorContainer, {
            id: 'billVendorFilter',
            options: vendorOpts,
            placeholder: 'Filter by Vendor',
            compact: true,
            onChange: () => { currentBillPage = 1; loadVendorBills(); }
        });
    }

    // Payment vendor filter
    const paymentVendorContainer = document.getElementById('paymentVendorFilterContainer');
    if (paymentVendorContainer) {
        paymentVendorFilterDropdown = new SearchableDropdown(paymentVendorContainer, {
            id: 'paymentVendorFilter',
            options: vendorOpts,
            placeholder: 'Filter by Vendor',
            compact: true,
            onChange: () => loadVendorPayments()
        });
    }

    // Statement vendor dropdown
    const stmtContainer = document.getElementById('stmtVendorContainer');
    if (stmtContainer) {
        stmtVendorDropdown = new SearchableDropdown(stmtContainer, {
            id: 'stmtVendor',
            options: [{ value: '', label: 'Select Vendor' }, ...vendors.map(v => ({ value: v.id, label: v.name || v.vendor_name }))],
            placeholder: 'Select Vendor',
            compact: true
        });
    }
}
