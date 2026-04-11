/**
 * AccountsService — Purchase Orders Page
 *
 * Handles 10 backend endpoints for purchase order lifecycle:
 *   1.  GET    /purchase-orders              — list with stats
 *   2.  GET    /purchase-orders/{id}         — single with lines
 *   3.  POST   /purchase-orders              — create draft
 *   4.  PUT    /purchase-orders/{id}         — update draft
 *   5.  DELETE /purchase-orders/{id}         — delete draft
 *   6.  POST   /purchase-orders/{id}/approve          — approve
 *   7.  POST   /purchase-orders/{id}/send              — send to vendor
 *   8.  POST   /purchase-orders/{id}/receive           — mark received
 *   9.  POST   /purchase-orders/{id}/convert-to-bill   — convert to vendor bill
 *  10.  POST   /purchase-orders/{id}/cancel             — cancel
 *
 * Status lifecycle: draft → approved → sent → received → billed
 *                   Can cancel from draft / approved / sent
 */

// ============================================================================
// GLOBAL STATE
// ============================================================================

let vendors = [];
let accounts = [];

// Module-scoped cache so row-action handlers can look up full entity by id
let purchaseOrders = [];

let poPage = 1;
const PAGE_SIZE = 50;

// Dropdown instances
let poVendorFilterDD = null;

// ============================================================================
// PAGE INIT
// ============================================================================

document.addEventListener('DOMContentLoaded', async function () {
    if (!await AccountsCommon.initPage('purchase-orders', '../')) return;

    const tabNames = {
        'po-list': 'Purchase Orders'
    };

    AccountsCommon.setupSidebar('sidebarToggle', 'accountsSidebar', 'sidebarOverlay', tabNames);
    AccountsCommon.setupTabs(tabNames, onTabSwitch);
    accountsRoles.applyRBAC();

    await loadInitialData();
    AccountsCommon.initSearchableDropdownsWithRetry(initDropdowns);
    setupSearchListeners();
    initDatePickers();
});

// ============================================================================
// TAB SWITCH
// ============================================================================

function onTabSwitch(tabId) {
    switch (tabId) {
        case 'po-list': loadPurchaseOrders(); break;
    }
}

// ============================================================================
// INITIAL DATA
// ============================================================================

async function loadInitialData() {
    try {
        const [vendRes, acctRes] = await Promise.all([
            api.request(AccountsCommon.buildUrl('vendors'), { _skipSpinner: true }).catch(() => []),
            api.request(AccountsCommon.buildUrl('coa', { isActive: true }), { _skipSpinner: true }).catch(() => [])
        ]);
        vendors = Array.isArray(vendRes) ? vendRes : (vendRes?.data || vendRes?.items || []);
        accounts = Array.isArray(acctRes) ? acctRes : (acctRes?.data || acctRes?.items || []);

        populateSelect('poVendorId', vendors, 'id', 'name', 'Select vendor...');

        loadPurchaseOrders();
    } catch (err) {
        console.error('[PurchaseOrders] loadInitialData error:', err);
    }
}

function populateSelect(selectId, items, valueField, labelField, placeholder) {
    const sel = document.getElementById(selectId);
    if (!sel) return;
    sel.innerHTML = `<option value="">${AccountsCommon.escapeHtml(placeholder)}</option>`;
    items.forEach(item => {
        sel.innerHTML += `<option value="${item[valueField]}">${AccountsCommon.escapeHtml(item[labelField] || item.code || '')}</option>`;
    });
}

// ============================================================================
// SEARCH & DATE PICKERS
// ============================================================================

function setupSearchListeners() {
    const debounce = (fn, ms = 400) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
    document.getElementById('poSearch')?.addEventListener('input', debounce(() => { poPage = 1; loadPurchaseOrders(); }));
    document.getElementById('poStatusFilter')?.addEventListener('change', () => { poPage = 1; loadPurchaseOrders(); });
}

function initDatePickers() {
    if (typeof flatpickr !== 'function') {
        setTimeout(initDatePickers, 300);
        return;
    }
    const opts = { dateFormat: 'Y-m-d', allowInput: true };
    flatpickr('#poDateFrom', { ...opts, onChange: () => { poPage = 1; loadPurchaseOrders(); } });
    flatpickr('#poDateTo', { ...opts, onChange: () => { poPage = 1; loadPurchaseOrders(); } });
    flatpickr('#poDate', opts);
    flatpickr('#poExpectedDate', opts);
}

// ============================================================================
// DROPDOWNS
// ============================================================================

function initDropdowns() {
    const vendOpts = vendors.map(v => ({ value: v.id, label: v.name }));

    poVendorFilterDD = new SearchableDropdown(document.getElementById('poVendorFilterContainer'), {
        id: 'poVendorFilter', options: vendOpts, placeholder: 'All Vendors',
        searchPlaceholder: 'Search vendors...', compact: true,
        onChange: () => { poPage = 1; loadPurchaseOrders(); }
    });
}

// ============================================================================
// PURCHASE ORDERS — LIST
// ============================================================================

async function loadPurchaseOrders() {
    const params = { limit: PAGE_SIZE, offset: (poPage - 1) * PAGE_SIZE };
    const vendorId = poVendorFilterDD?.getValue?.();
    const status = document.getElementById('poStatusFilter')?.value;
    const dateFrom = document.getElementById('poDateFrom')?.value;
    const dateTo = document.getElementById('poDateTo')?.value;
    const search = document.getElementById('poSearch')?.value?.trim();

    if (vendorId) params.vendorId = vendorId;
    if (status) params.status = status;
    if (dateFrom) params.fromDate = dateFrom;
    if (dateTo) params.toDate = dateTo;
    if (search) params.search = search;

    try {
        const res = await api.request(AccountsCommon.buildUrl('purchase-orders', params));
        const items = Array.isArray(res) ? res : (res?.data || res?.items || []);
        purchaseOrders = items;  // cache for row action handlers
        const total = res?.total || items.length;
        const totalPages = Math.ceil(total / PAGE_SIZE) || 1;

        // Stats — prefer backend stats, fallback to client-side
        const stats = res?.stats || {};
        setText('totalPOs', stats.total_count ?? total);
        setText('draftPOs', stats.draft_count ?? items.filter(i => i.status === 'draft').length);
        setText('approvedPOs', stats.approved_count ?? items.filter(i => i.status === 'approved').length);
        setText('sentPOs', stats.sent_count ?? items.filter(i => i.status === 'sent').length);
        setText('receivedPOs', stats.received_count ?? items.filter(i => i.status === 'received').length);
        setText('totalPOValue', stats.total_value != null ? AccountsCommon.formatCurrency(stats.total_value) : AccountsCommon.formatCurrency(items.reduce((s, i) => s + parseFloat(i.total_amount || 0), 0)));

        const tbody = document.getElementById('purchaseOrdersTable');
        if (!items.length) {
            tbody.innerHTML = '<tr class="empty-state"><td colspan="7"><div class="empty-message"><p>No purchase orders found</p></div></td></tr>';
        } else {
            tbody.innerHTML = items.map(po => {
                const vendName = po.vendor_name || vendors.find(v => v.id === po.vendor_id)?.name || '-';
                return `<tr>
                    <td>${AccountsCommon.escapeHtml(po.po_number || '-')}</td>
                    <td>${AccountsCommon.escapeHtml(vendName)}</td>
                    <td>${AccountsCommon.formatDate(po.po_date)}</td>
                    <td>${AccountsCommon.formatDate(po.expected_date)}</td>
                    <td class="text-right">${AccountsCommon.formatCurrency(po.total_amount)}</td>
                    <td>${AccountsCommon.statusBadge(po.status)}</td>
                    <td class="actions-cell">${poActions(po)}</td>
                </tr>`;
            }).join('');
        }
        AccountsCommon.renderPagination('posPagination', poPage, totalPages, p => { poPage = p; loadPurchaseOrders(); });
    } catch (err) {
        console.error('[PurchaseOrders] loadPurchaseOrders error:', err);
        Toast.error('Failed to load purchase orders');
    }
}

// ============================================================================
// ROW ACTIONS (status-dependent)
// ============================================================================

function poActions(po) {
    const s = (po.status || '').toLowerCase();

    // View + PDF are always available
    let html = `<button class="btn-icon" data-tooltip="View" onclick="viewPO('${po.id}')"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg></button>`;
    html += ` <button class="btn-icon" data-tooltip="Download PDF" onclick="downloadPoPdf('${po.id}', '${(po.po_number||'').replace(/'/g,'')}')"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg></button>`;

    if (s === 'draft') {
        html += ` <button class="btn-icon" data-tooltip="Edit" onclick="editPO('${po.id}')"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>`;
        html += ` <button class="btn-icon" data-tooltip="Approve" onclick="approvePO('${po.id}')"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg></button>`;
        html += ` <button class="btn-icon btn-icon-danger" data-tooltip="Delete" onclick="deletePO('${po.id}')"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>`;
    }

    if (s === 'approved') {
        html += ` <button class="btn-icon" data-tooltip="Send" onclick="sendPO('${po.id}')"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg></button>`;
        html += ` <button class="btn-icon btn-icon-danger" data-tooltip="Cancel" onclick="cancelPO('${po.id}')"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>`;
    }

    if (s === 'sent') {
        html += ` <button class="btn-icon" data-tooltip="Receive" onclick="receivePO('${po.id}')"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg></button>`;
        html += ` <button class="btn-icon btn-icon-danger" data-tooltip="Cancel" onclick="cancelPO('${po.id}')"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>`;
    }

    if (s === 'received') {
        html += ` <button class="btn-icon" data-tooltip="Convert to Bill" onclick="convertToBill('${po.id}')"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg></button>`;
    }

    return html;
}

// ============================================================================
// VIEW PURCHASE ORDER (read-only detail modal)
// ============================================================================

async function viewPO(id) {
    try {
        const po = await api.request(AccountsCommon.buildUrl(`purchase-orders/${id}`));
        const esc = AccountsCommon.escapeHtml;
        const fmt = AccountsCommon.formatCurrency;
        const fmtD = AccountsCommon.formatDate;

        document.getElementById('poViewTitle').textContent = `Purchase Order ${esc(po.po_number || '')}`;

        const vendName = po.vendor_name || vendors.find(v => v.id === po.vendor_id)?.name || '-';
        const lines = po.lines || [];

        let linesHtml = '';
        if (lines.length) {
            linesHtml = `<div class="data-table-container" style="margin-top: 1rem;">
                <table class="data-table">
                    <thead><tr><th>Description</th><th>Account</th><th style="width:80px;">Qty</th><th style="width:100px;">Unit Price</th><th style="width:100px;">Amount</th></tr></thead>
                    <tbody>${lines.map(l => `<tr>
                        <td>${esc(l.description || '-')}</td>
                        <td>${esc(l.account_code ? l.account_code + ' — ' + (l.account_name || '') : (l.account_name || '-'))}</td>
                        <td>${l.quantity}</td>
                        <td class="text-right">${fmt(l.unit_price)}</td>
                        <td class="text-right">${fmt(l.amount)}</td>
                    </tr>`).join('')}</tbody>
                </table>
            </div>`;
        }

        let approvedHtml = '';
        if (po.approved_by) {
            approvedHtml = `<div>
                <div style="color:var(--text-secondary);font-size:0.85rem;">Approved At</div>
                <div>${po.approved_at ? fmtD(po.approved_at) : '-'}</div>
            </div>`;
        }

        document.getElementById('poViewBody').innerHTML = `
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;">
                <div>
                    <div style="color:var(--text-secondary);font-size:0.85rem;">Vendor</div>
                    <div style="font-weight:500;">${esc(vendName)}</div>
                </div>
                <div>
                    <div style="color:var(--text-secondary);font-size:0.85rem;">Status</div>
                    <div>${AccountsCommon.statusBadge(po.status)}</div>
                </div>
                <div>
                    <div style="color:var(--text-secondary);font-size:0.85rem;">PO Date</div>
                    <div>${fmtD(po.po_date)}</div>
                </div>
                <div>
                    <div style="color:var(--text-secondary);font-size:0.85rem;">Expected Date</div>
                    <div>${fmtD(po.expected_date)}</div>
                </div>
                <div>
                    <div style="color:var(--text-secondary);font-size:0.85rem;">Currency</div>
                    <div>${esc(po.currency || 'INR')}</div>
                </div>
                ${approvedHtml}
            </div>
            ${po.notes ? `<div style="margin-top:1rem;color:var(--text-secondary);font-size:0.9rem;"><strong>Notes:</strong> ${esc(po.notes)}</div>` : ''}
            ${linesHtml}
            <div style="display:flex;justify-content:flex-end;margin-top:1rem;">
                <div style="min-width:250px;">
                    <div style="display:flex;justify-content:space-between;padding:0.4rem 0;color:var(--text-secondary);">
                        <span>Subtotal:</span><span>${fmt(po.subtotal)}</span>
                    </div>
                    <div style="display:flex;justify-content:space-between;padding:0.4rem 0;color:var(--text-secondary);">
                        <span>Tax:</span><span>${fmt(po.tax_amount)}</span>
                    </div>
                    <div style="display:flex;justify-content:space-between;padding:0.5rem 0;font-weight:600;border-top:1px solid var(--border-primary);color:var(--text-primary);">
                        <span>Total:</span><span>${fmt(po.total_amount)}</span>
                    </div>
                </div>
            </div>`;

        AccountsCommon.openModal('poViewModal');
    } catch (err) {
        Toast.error('Failed to load purchase order');
    }
}

// ============================================================================
// PO MODAL — CREATE / EDIT
// ============================================================================

function showCreatePOModal() {
    document.getElementById('poModalTitle').textContent = 'Create Purchase Order';
    document.getElementById('poForm').reset();
    document.getElementById('poId').value = '';
    document.getElementById('poCurrency').value = 'INR';
    document.getElementById('poLines').innerHTML = '';
    addPOLine();
    calculatePOTotals();
    AccountsCommon.openModal('purchaseOrderModal');
}

async function editPO(id) {
    try {
        const po = await api.request(AccountsCommon.buildUrl(`purchase-orders/${id}`));
        document.getElementById('poModalTitle').textContent = `Edit PO ${po.po_number || ''}`;
        document.getElementById('poId').value = po.id;
        document.getElementById('poVendorId').value = po.vendor_id || '';
        document.getElementById('poDate').value = po.po_date?.split('T')[0] || '';
        document.getElementById('poExpectedDate').value = po.expected_date?.split('T')[0] || '';
        document.getElementById('poCurrency').value = po.currency || 'INR';
        document.getElementById('poNotes').value = po.notes || '';

        const lines = po.lines || [];
        const tbody = document.getElementById('poLines');
        tbody.innerHTML = '';
        if (lines.length) {
            lines.forEach(l => addPOLine(l));
        } else {
            addPOLine();
        }
        calculatePOTotals();
        AccountsCommon.openModal('purchaseOrderModal');
    } catch (err) {
        Toast.error('Failed to load purchase order');
    }
}

// ============================================================================
// LINE ITEMS
// ============================================================================

function addPOLine(data = {}) {
    const tbody = document.getElementById('poLines');
    const row = document.createElement('tr');
    const acctOptions = accounts.map(a => {
        const code = a.account_code || a.code || '';
        const name = a.account_name || a.name || '';
        const label = code && name ? `${code} — ${name}` : (name || code);
        return `<option value="${a.id}" ${a.id === data.account_id ? 'selected' : ''}>${AccountsCommon.escapeHtml(label)}</option>`;
    }).join('');

    row.innerHTML = `
        <td><input type="text" class="form-control line-desc" value="${AccountsCommon.escapeHtml(data.description || '')}" placeholder="Description"></td>
        <td><select class="form-control line-account"><option value="">Select...</option>${acctOptions}</select></td>
        <td><input type="number" class="form-control line-qty" value="${data.quantity || 1}" min="0" step="any" oninput="calculatePOTotals()"></td>
        <td><input type="number" class="form-control line-rate" value="${data.unit_price || ''}" min="0" step="0.01" placeholder="0.00" oninput="calculatePOTotals()"></td>
        <td class="line-amount" style="text-align:right; padding-top:0.7rem;">0.00</td>
        <td><button type="button" class="btn-icon btn-icon-danger" onclick="removePOLine(this)"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button></td>`;
    tbody.appendChild(row);
    calculatePOTotals();
}

function removePOLine(btn) {
    btn.closest('tr').remove();
    calculatePOTotals();
}

function calculatePOTotals() {
    let subtotal = 0;
    document.querySelectorAll('#poLines tr').forEach(row => {
        const qty = parseFloat(row.querySelector('.line-qty')?.value) || 0;
        const rate = parseFloat(row.querySelector('.line-rate')?.value) || 0;
        const amt = qty * rate;
        subtotal += amt;
        const amtCell = row.querySelector('.line-amount');
        if (amtCell) amtCell.textContent = amt.toFixed(2);
    });
    // Tax is computed server-side; show 0 for now
    const tax = 0;
    setText('poSubtotal', subtotal.toFixed(2));
    setText('poTax', tax.toFixed(2));
    setText('poTotal', (subtotal + tax).toFixed(2));
}

// ============================================================================
// SAVE PO (CREATE / UPDATE)
// ============================================================================

async function savePO() {
    const form = document.getElementById('poForm');
    if (!form.reportValidity()) return;

    const lines = [];
    document.querySelectorAll('#poLines tr').forEach(row => {
        lines.push({
            description: row.querySelector('.line-desc')?.value || '',
            account_id: row.querySelector('.line-account')?.value || null,
            quantity: parseFloat(row.querySelector('.line-qty')?.value) || 0,
            unit_price: parseFloat(row.querySelector('.line-rate')?.value) || 0
        });
    });

    const payload = {
        vendor_id: document.getElementById('poVendorId').value,
        po_date: document.getElementById('poDate').value,
        expected_date: document.getElementById('poExpectedDate').value,
        currency: document.getElementById('poCurrency').value || 'INR',
        notes: document.getElementById('poNotes').value,
        lines
    };

    const id = document.getElementById('poId').value;
    try {
        if (id) {
            await api.request(AccountsCommon.buildUrl(`purchase-orders/${id}`), { method: 'PUT', body: JSON.stringify(payload), headers: { 'Content-Type': 'application/json' } });
            Toast.success('Purchase order updated');
        } else {
            await api.request(AccountsCommon.buildUrl('purchase-orders'), { method: 'POST', body: JSON.stringify(payload), headers: { 'Content-Type': 'application/json' } });
            Toast.success('Purchase order saved as draft');
        }
        AccountsCommon.closeModal('purchaseOrderModal');
        loadPurchaseOrders();
    } catch (err) {
        Toast.error(err.message || 'Failed to save purchase order');
    }
}

// ============================================================================
// STATUS LIFECYCLE ACTIONS
// ============================================================================

function _poLabel(id) {
    const po = purchaseOrders.find(x => x.id === id);
    if (!po) return { label: 'this purchase order', poNo: '', vendorName: '' };
    const fmt = AccountsCommon.formatCurrency;
    const poNo = po.po_number || '';
    const vendorName = po.vendor_name || vendors?.find(v => v.id === po.vendor_id)?.name || 'the vendor';
    const amount = po.total_amount != null ? fmt(po.total_amount) : '';
    const dateStr = po.po_date ? new Date(po.po_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '';
    const label = `${poNo ? poNo + ' ' : ''}for ${vendorName}${amount ? ' totalling ' + amount : ''}${dateStr ? ' dated ' + dateStr : ''}`;
    return { label, poNo, vendorName };
}

async function approvePO(id) {
    const { label } = _poLabel(id);
    const ok = await Confirm.show({
        title: 'Approve Purchase Order',
        message: `Approve ${label}? This moves the PO from Draft to Approved. Once approved, it can be sent to the vendor. Only approved POs can be sent.`,
        confirmText: 'Approve',
        type: 'info'
    });
    if (!ok) return;
    try {
        await api.request(AccountsCommon.buildUrl(`purchase-orders/${id}/approve`), { method: 'POST' });
        Toast.success('Purchase order approved');
        loadPurchaseOrders();
    } catch (err) { Toast.error(err.message || 'Failed to approve purchase order'); }
}

async function sendPO(id) {
    const { label } = _poLabel(id);
    const ok = await Confirm.show({
        title: 'Send Purchase Order',
        message: `Mark ${label} as sent to the vendor? This updates the status from Approved to Sent. Use this after you have actually emailed or delivered the PO to the vendor.`,
        confirmText: 'Mark as Sent',
        type: 'info'
    });
    if (!ok) return;
    try {
        await api.request(AccountsCommon.buildUrl(`purchase-orders/${id}/send`), { method: 'POST' });
        Toast.success('Purchase order marked as sent');
        loadPurchaseOrders();
    } catch (err) { Toast.error(err.message || 'Failed to send purchase order'); }
}

async function receivePO(id) {
    const { label } = _poLabel(id);
    const ok = await Confirm.show({
        title: 'Receive Purchase Order',
        message: `Mark ${label} as received? This confirms that the goods or services have been received from the vendor. The PO will move from Sent to Received and become eligible for conversion to a vendor bill.`,
        confirmText: 'Mark as Received',
        type: 'info'
    });
    if (!ok) return;
    try {
        await api.request(AccountsCommon.buildUrl(`purchase-orders/${id}/receive`), { method: 'POST' });
        Toast.success('Purchase order marked as received');
        loadPurchaseOrders();
    } catch (err) { Toast.error(err.message || 'Failed to mark purchase order as received'); }
}

async function convertToBill(id) {
    const { label } = _poLabel(id);
    const ok = await Confirm.show({
        title: 'Convert to Vendor Bill',
        message: `Convert ${label} to a vendor bill? This will create a new bill with the same line items and mark the PO as Billed. The new bill will start as a Draft and can then be approved and paid. This cannot be undone.`,
        confirmText: 'Convert to Bill',
        type: 'info'
    });
    if (!ok) return;
    try {
        const result = await api.request(AccountsCommon.buildUrl(`purchase-orders/${id}/convert-to-bill`), { method: 'POST' });
        const billNo = result?.bill_number || result?.id || '';
        Toast.success(`Purchase order converted to bill${billNo ? ' ' + billNo : ''}`);
        // Navigate to payables page so user can see the new bill
        window.location.href = 'payables.html';
    } catch (err) { Toast.error(err.message || 'Failed to convert to bill'); }
}

async function cancelPO(id) {
    const { label } = _poLabel(id);
    const ok = await Confirm.show({
        title: 'Cancel Purchase Order',
        message: `Cancel ${label}? The purchase order will be marked as Cancelled. This cannot be undone. Only draft, approved, and sent POs can be cancelled.`,
        confirmText: 'Cancel PO',
        type: 'danger'
    });
    if (!ok) return;
    try {
        await api.request(AccountsCommon.buildUrl(`purchase-orders/${id}/cancel`), { method: 'POST' });
        Toast.success('Purchase order cancelled');
        loadPurchaseOrders();
    } catch (err) { Toast.error(err.message || 'Failed to cancel purchase order'); }
}

async function deletePO(id) {
    const { label } = _poLabel(id);
    const ok = await Confirm.show({
        title: 'Delete Purchase Order',
        message: `Delete ${label}? Only draft purchase orders can be deleted. This cannot be undone.`,
        confirmText: 'Delete',
        type: 'danger'
    });
    if (!ok) return;
    try {
        await api.request(AccountsCommon.buildUrl(`purchase-orders/${id}`), { method: 'DELETE' });
        Toast.success('Purchase order deleted');
        loadPurchaseOrders();
    } catch (err) { Toast.error(err.message || 'Failed to delete purchase order'); }
}

// ============================================================================
// HELPERS
// ============================================================================

function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
}

async function downloadPoPdf(id, poNumber) {
    try {
        const baseUrl = api._getBaseUrl('/accounts/');
        const url = `${baseUrl}/accounts/purchase-orders/${id}/pdf?tenantId=${AccountsCommon.getTenantId()}`;
        const response = await fetch(url, { headers: { 'Authorization': `Bearer ${api.token}` } });
        if (!response.ok) throw new Error('Failed to download PDF');
        const blob = await response.blob();
        const blobUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = blobUrl;
        a.download = `PO-${poNumber || id}.pdf`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(blobUrl);
        Toast.success('PO PDF downloaded');
    } catch (err) {
        console.error('[PurchaseOrders] PDF download error:', err);
        Toast.error('Failed to download PDF');
    }
}
