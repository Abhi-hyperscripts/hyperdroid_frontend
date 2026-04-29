/**
 * Procurement RFQ Management
 * Handles listing, detail view, vendor assignment, and RFQ sending.
 */

// ==================== State ====================
let allRfqs = [];
let currentRfq = null;
let rfqVendors = [];
let rfqItems = [];
let allVendorsList = [];
let allInquiriesList = [];
let currentView = 'list'; // 'list' or 'detail'
let aiAvailable = false;
let _rfqFiltered = [];
let _rfqCurrentPage = 1;
const RFQ_PAGE_SIZE = 20;

async function checkAIAvailability() {
    try {
        const resp = await api.request('/procurement/procurement-ai/status', { _skipSpinner: true });
        aiAvailable = resp.ai_available === true;
    } catch {
        aiAvailable = false;
    }
}

// ==================== Initialization ====================

document.addEventListener('DOMContentLoaded', () => {
    Navigation.init('procurement', '../');

    if (!api.isAuthenticated()) {
        window.location.href = '../login.html';
        return;
    }

    // Check AI availability (non-blocking)
    checkAIAvailability();

    // Check URL for detail view or createFrom param
    const hash = window.location.hash;
    const params = new URLSearchParams(window.location.search);
    const createFromInquiry = params.get('createFrom');

    if (hash && hash.startsWith('#detail/')) {
        const rfqId = hash.replace('#detail/', '');
        if (rfqId) {
            showDetailView(rfqId);
            return;
        }
    }

    loadRfqs();

    if (createFromInquiry) {
        // Auto-open create modal with inquiry pre-selected
        loadInquiriesForModal().then(() => {
            openCreateRfqModal();
            if (_rfqInquiryDropdown) {
                _rfqInquiryDropdown.setValue(createFromInquiry, true);
            } else {
                const inquirySelect = document.getElementById('rfqInquiry');
                if (inquirySelect) inquirySelect.value = createFromInquiry;
            }
        });
    }

    // Convert filter dropdown to searchable
    setTimeout(() => {
        if (typeof convertSelectToSearchable === 'function') {
            convertSelectToSearchable('filterStatus', {
                placeholder: 'All Statuses',
                searchPlaceholder: 'Search status...',
                compact: true,
                onChange: () => applyFilters()
            });
        }
    }, 100);
});

// Handle hash changes for back/forward navigation
window.addEventListener('hashchange', () => {
    const hash = window.location.hash;
    if (hash && hash.startsWith('#detail/')) {
        const rfqId = hash.replace('#detail/', '');
        if (rfqId) {
            showDetailView(rfqId);
        }
    } else {
        showListView();
    }
});

// ==================== Data Loading ====================

async function loadRfqs() {
    try {
        const response = await api.request('/procurement/rfqs');
        allRfqs = response.data || response || [];
        _rfqFiltered = allRfqs;
        renderRfqsTable(allRfqs);
    } catch (error) {
        console.error('Failed to load RFQs:', error);
        renderRfqsTable([]);
        Toast.error('Failed to load RFQs');
    }
}

async function loadRfqDetail(rfqId) {
    try {
        const response = await api.request(`/procurement/rfqs/${rfqId}`);
        currentRfq = response.data || response;
        renderDetailHeader();
        loadRfqVendors(rfqId);
        loadRfqItems(rfqId);
    } catch (error) {
        console.error('Failed to load RFQ detail:', error);
        Toast.error('Failed to load RFQ details');
    }
}

async function loadRfqVendors(rfqId) {
    try {
        const response = await api.request(`/procurement/rfqs/${rfqId}/vendors`, { _skipSpinner: true });
        rfqVendors = response.data || response || [];
        renderRfqVendorsTable();
        updateSendButton();
    } catch (error) {
        console.error('Failed to load RFQ vendors:', error);
        rfqVendors = [];
        renderRfqVendorsTable();
    }
}

async function loadRfqItems(rfqId) {
    try {
        const response = await api.request(`/procurement/rfqs/${rfqId}/items`, { _skipSpinner: true });
        rfqItems = response.data || response || [];
        renderRfqItemsTable();
    } catch (error) {
        console.error('Failed to load RFQ items:', error);
        rfqItems = [];
        renderRfqItemsTable();
    }
}

let _rfqInquiryDropdown = null;

async function loadInquiriesForModal() {
    try {
        const response = await api.request('/procurement/inquiries', { _skipSpinner: true });
        allInquiriesList = (response.data || response || []).filter(
            inq => inq.status === 'draft' || inq.status === 'open' || inq.status === 'in_progress'
        );
        const select = document.getElementById('rfqInquiry');
        select.innerHTML = '<option value="">Select an inquiry...</option>';
        allInquiriesList.forEach(inq => {
            select.innerHTML += `<option value="${inq.id}">${escapeHtml(inq.inquiry_number || '')} - ${escapeHtml(inq.title || 'Untitled')}</option>`;
        });

        // Convert to searchable or update options
        const opts = [{ value: '', label: 'Select an inquiry...' }].concat(
            allInquiriesList.map(inq => ({
                value: inq.id,
                label: `${inq.inquiry_number || ''} - ${inq.title || 'Untitled'}`
            }))
        );
        if (!_rfqInquiryDropdown && typeof convertSelectToSearchable === 'function') {
            _rfqInquiryDropdown = convertSelectToSearchable('rfqInquiry', {
                placeholder: 'Select an inquiry...',
                searchPlaceholder: 'Search inquiries...'
            });
        }
        if (_rfqInquiryDropdown) _rfqInquiryDropdown.setOptions(opts);
    } catch (error) {
        console.error('Failed to load inquiries:', error);
    }
}

let selectedVendorIds = new Set();
let availableVendorsForModal = [];
const VENDOR_ITEM_HEIGHT = 42; // px per vendor row for virtual scroll
let _vendorFilteredCache = [];
let _vendorScrollBound = false;

async function loadVendorsForModal() {
    selectedVendorIds.clear();
    try {
        // Backend already returns ONLY vendors mapped (via vendor_items) to
        // at least one of this RFQ's items, AND not already attached. Tenants
        // with 50+ vendors otherwise get a noisy list with most rows
        // irrelevant to the RFQ. The dedicated endpoint also keeps the
        // assigned-vendor exclusion server-side so the count is correct.
        const rfqId = currentDetailRfqId || (window.location.hash.match(/detail\/([^/?#]+)/)?.[1]);
        const endpoint = rfqId
            ? `/procurement/rfqs/${rfqId}/eligible-vendors`
            : '/procurement/vendors';
        const response = await api.request(endpoint, { _skipSpinner: true });
        allVendorsList = response.data || response || [];
        availableVendorsForModal = allVendorsList;
        renderAvailablePane();
        renderSelectedPane();
        updateVendorPickerCounts();
        // Bind scroll listener once
        if (!_vendorScrollBound) {
            const listEl = document.getElementById('vendorAvailableList');
            if (listEl) {
                listEl.addEventListener('scroll', () => _renderVirtualItems());
                _vendorScrollBound = true;
            }
        }
    } catch (error) {
        console.error('Failed to load vendors:', error);
        document.getElementById('vendorAvailableList').innerHTML =
            '<div style="padding:20px; text-align:center; color:var(--color-error); font-size:13px;">Failed to load vendors</div>';
    }
}

function getFilteredVendors() {
    const filter = (document.getElementById('vendorSearchInput')?.value || '').toLowerCase();
    if (!filter) return availableVendorsForModal;
    return availableVendorsForModal.filter(v =>
        (v.vendor_name || '').toLowerCase().includes(filter) ||
        (v.vendor_code || '').toLowerCase().includes(filter) ||
        (v.contact_email || '').toLowerCase().includes(filter));
}

function _buildVendorRowHtml(v) {
    const isSelected = selectedVendorIds.has(v.id);
    const name = escapeHtml(v.vendor_name || '');
    const code = v.vendor_code ? escapeHtml(v.vendor_code) : '';
    const toggleState = isSelected ? 'on' : 'off';
    return `<div class="vendor-pick-item${isSelected ? ' vendor-pick-selected' : ''}" onclick="toggleVendorSelection('${v.id}')" style="display:flex; align-items:center; gap:10px; padding:8px 10px; cursor:pointer; border-bottom:1px solid var(--border-primary); height:${VENDOR_ITEM_HEIGHT}px; box-sizing:border-box;">
        <div style="flex:1; min-width:0;">
            <div style="font-size:13px; font-weight:500; color:var(--text-primary); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${name}${code ? ` <span style="color:var(--text-secondary); font-weight:400; font-size:11px;">(${code})</span>` : ''}</div>
        </div>
        <div class="vendor-toggle-track ${toggleState}"><div class="vendor-toggle-knob"></div></div>
    </div>`;
}

function renderAvailablePane() {
    const container = document.getElementById('vendorAvailableList');
    _vendorFilteredCache = getFilteredVendors();
    const searchVal = document.getElementById('vendorSearchInput')?.value || '';

    if (_vendorFilteredCache.length === 0) {
        // Distinguish "filter zeroed it out" from "no vendor is mapped to
        // any of these items in the first place" — the second case needs a
        // clear next-step pointer or the user is stuck.
        const emptyHtml = searchVal
            ? `<div style="padding:20px; text-align:center; color:var(--text-secondary); font-size:12px;">No vendors match &quot;${escapeHtml(searchVal)}&quot;</div>`
            : `<div style="padding:24px 20px; text-align:center; color:var(--text-secondary); font-size:12px; line-height:1.6;">
                <div style="font-weight:600; margin-bottom:6px; color:var(--text-primary);">No vendors are eligible for this RFQ</div>
                <div>Only vendors mapped to at least one of this RFQ's items appear here.</div>
                <div style="margin-top:8px;">Open <a href="vendors.html" style="color:var(--brand-primary); text-decoration:underline;">Vendors</a> &rarr; click a vendor &rarr; <strong>Manage Items</strong> to map the items they supply.</div>
              </div>`;
        container.innerHTML = emptyHtml;
        return;
    }

    // Virtual scroll: set total height, render only visible items
    const totalHeight = _vendorFilteredCache.length * VENDOR_ITEM_HEIGHT;
    container.innerHTML = `<div id="vendorVirtualSpacer" style="height:${totalHeight}px; position:relative;"><div id="vendorVirtualViewport" style="position:absolute; left:0; right:0;"></div></div>`;
    container.scrollTop = 0;
    _renderVirtualItems();
}

function _renderVirtualItems() {
    const container = document.getElementById('vendorAvailableList');
    const viewport = document.getElementById('vendorVirtualViewport');
    if (!container || !viewport || _vendorFilteredCache.length === 0) return;

    const scrollTop = container.scrollTop;
    const containerHeight = container.clientHeight;
    const startIdx = Math.max(0, Math.floor(scrollTop / VENDOR_ITEM_HEIGHT) - 3); // 3 item buffer
    const endIdx = Math.min(_vendorFilteredCache.length, Math.ceil((scrollTop + containerHeight) / VENDOR_ITEM_HEIGHT) + 3);

    viewport.style.top = `${startIdx * VENDOR_ITEM_HEIGHT}px`;
    viewport.innerHTML = _vendorFilteredCache.slice(startIdx, endIdx).map(v => _buildVendorRowHtml(v)).join('');
}

function renderSelectedPane() {
    const container = document.getElementById('vendorSelectedList');
    const clearBtn = document.getElementById('vendorClearAllBtn');

    if (selectedVendorIds.size === 0) {
        container.innerHTML = `<div style="padding:20px; text-align:center; color:var(--text-secondary); font-size:12px;">
            <svg style="width:32px; height:32px; margin-bottom:8px; opacity:0.3;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
            <div>Select vendors from the left</div>
        </div>`;
        if (clearBtn) clearBtn.style.display = 'none';
        return;
    }

    if (clearBtn) clearBtn.style.display = '';

    container.innerHTML = Array.from(selectedVendorIds).map(id => {
        const v = availableVendorsForModal.find(x => x.id === id);
        if (!v) return '';
        const name = escapeHtml(v.vendor_name || '');
        const code = v.vendor_code ? escapeHtml(v.vendor_code) : '';
        return `<div style="display:flex; align-items:center; gap:8px; padding:7px 10px; border-bottom:1px solid var(--border-primary);">
            <div style="flex:1; min-width:0;">
                <div style="font-size:13px; font-weight:500; color:var(--text-primary); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${name}${code ? ` <span style="color:var(--text-secondary); font-weight:400; font-size:11px;">(${code})</span>` : ''}</div>
            </div>
            <button type="button" onclick="toggleVendorSelection('${id}')" style="background:none; border:none; cursor:pointer; color:var(--color-error); padding:2px; line-height:1; font-size:16px; opacity:0.7;" onmouseenter="this.style.opacity='1'" onmouseleave="this.style.opacity='0.7'" title="Remove">&times;</button>
        </div>`;
    }).join('');
}

function toggleVendorSelection(vendorId) {
    if (selectedVendorIds.has(vendorId)) {
        selectedVendorIds.delete(vendorId);
    } else {
        selectedVendorIds.add(vendorId);
    }
    // Update toggle in-place without full re-render for available pane
    _renderVirtualItems();
    renderSelectedPane();
    updateVendorPickerCounts();
}

function selectAllFilteredVendors() {
    const filtered = getFilteredVendors();
    const allSelected = filtered.every(v => selectedVendorIds.has(v.id));
    if (allSelected) {
        filtered.forEach(v => selectedVendorIds.delete(v.id));
    } else {
        filtered.forEach(v => selectedVendorIds.add(v.id));
    }
    _renderVirtualItems();
    renderSelectedPane();
    updateVendorPickerCounts();
}

function clearAllVendorSelections() {
    selectedVendorIds.clear();
    _renderVirtualItems();
    renderSelectedPane();
    updateVendorPickerCounts();
}

function updateVendorPickerCounts() {
    const count = selectedVendorIds.size;
    const filtered = _vendorFilteredCache;

    const availEl = document.getElementById('vendorAvailableCount');
    if (availEl) availEl.textContent = filtered.length;

    const selEl = document.getElementById('vendorSelectedCount');
    if (selEl) selEl.textContent = count;

    const btn = document.getElementById('vendorSelectAllBtn');
    if (btn) {
        const allSelected = filtered.length > 0 && filtered.every(v => selectedVendorIds.has(v.id));
        btn.textContent = allSelected ? 'None' : 'All';
    }

    const submitBtn = document.getElementById('addVendorSubmitBtn');
    if (submitBtn) {
        const spinner = document.getElementById('addVendorSpinner');
        const spinnerHtml = spinner ? spinner.outerHTML : '';
        submitBtn.innerHTML = count > 0 ? `${spinnerHtml} Add ${count} Vendor${count > 1 ? 's' : ''}` : `${spinnerHtml} Add Vendors`;
    }
}

// Wire up search input
document.addEventListener('DOMContentLoaded', () => {
    const searchInput = document.getElementById('vendorSearchInput');
    if (searchInput) {
        searchInput.addEventListener('input', () => {
            renderAvailablePane();
            updateVendorPickerCounts();
        });
    }
});

// ==================== View Switching ====================

function showListView() {
    currentView = 'list';
    document.getElementById('listView').style.display = '';
    document.getElementById('detailView').style.display = 'none';
    window.location.hash = '';
    document.title = 'RFQs - Procurement | Ragenaizer';
    loadRfqs();
}

function showDetailView(rfqId) {
    currentView = 'detail';
    document.getElementById('listView').style.display = 'none';
    document.getElementById('detailView').style.display = '';
    if (!window.location.hash.includes(rfqId)) {
        window.location.hash = `detail/${rfqId}`;
    }
    loadRfqDetail(rfqId);
}

// ==================== Filter Handling ====================

function applyFilters() {
    const search = document.getElementById('filterSearch').value.trim().toLowerCase();
    const status = document.getElementById('filterStatus').value;

    let filtered = allRfqs;

    if (search) {
        filtered = filtered.filter(rfq => {
            const number = (rfq.rfq_number || '').toLowerCase();
            const title = (rfq.title || '').toLowerCase();
            return number.includes(search) || title.includes(search);
        });
    }

    if (status) {
        filtered = filtered.filter(rfq => rfq.status === status);
    }

    _rfqFiltered = filtered;
    _rfqCurrentPage = 1;
    renderRfqsTable(filtered);
}

// ==================== Table Rendering ====================

function renderRfqsTable(rfqs) {
    const tbody = document.getElementById('rfqsTableBody');

    if (!rfqs || rfqs.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="9" class="crm-empty-state">
                    <div class="crm-empty-content">
                        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                            <polyline points="14 2 14 8 20 8"/>
                        </svg>
                        <p>No RFQs found</p>
                        <button class="btn btn-sm btn-primary" onclick="openCreateRfqModal()">Create your first RFQ</button>
                    </div>
                </td>
            </tr>
        `;
        rfqRenderPagination(0, 0);
        return;
    }

    const totalItems = rfqs.length;
    const totalPages = Math.ceil(totalItems / RFQ_PAGE_SIZE);
    if (_rfqCurrentPage > totalPages) _rfqCurrentPage = totalPages;
    const startIdx = (_rfqCurrentPage - 1) * RFQ_PAGE_SIZE;
    const pageItems = rfqs.slice(startIdx, startIdx + RFQ_PAGE_SIZE);

    tbody.innerHTML = pageItems.map(rfq => `
        <tr style="cursor: pointer;" onclick="showDetailView('${rfq.id}')">
            <td>
                <div style="color: var(--brand-primary); font-weight: 600;">${escapeHtml(rfq.rfq_number || '-')}</div>
            </td>
            <td>
                <div class="crm-cell-primary">
                    <div style="color: var(--text-primary); font-weight: 500;">${escapeHtml(rfq.title || 'Untitled')}</div>
                </div>
            </td>
            <td class="hide-mobile">
                <span class="crm-cell-secondary">${escapeHtml(rfq.inquiry_number || '-')}</span>
            </td>
            <td>${renderStatusBadge(rfq.status)}</td>
            <td class="hide-mobile"><span class="crm-cell-secondary">${rfq.vendor_count || 0}</span></td>
            <td class="hide-mobile"><span class="crm-cell-secondary">${rfq.item_count || 0}</span></td>
            <td class="hide-mobile"><span class="crm-cell-secondary">${rfq.quotes_received || 0}</span></td>
            <td class="hide-mobile"><span class="crm-cell-secondary">${formatDate(rfq.quote_deadline)}</span></td>
            <td>
                <div class="crm-actions">
                    <button class="crm-action-btn" onclick="event.stopPropagation(); showDetailView('${rfq.id}')" title="View">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                            <circle cx="12" cy="12" r="3"/>
                        </svg>
                    </button>
                    ${rfq.status === 'fully_quoted' ? `
                        <button class="crm-action-btn" onclick="event.stopPropagation(); navigateToComparison('${rfq.id}')" title="Compare Quotes">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <line x1="18" y1="20" x2="18" y2="10"/>
                                <line x1="12" y1="20" x2="12" y2="4"/>
                                <line x1="6" y1="20" x2="6" y2="14"/>
                            </svg>
                        </button>
                    ` : ''}
                </div>
            </td>
        </tr>
    `).join('');

    rfqRenderPagination(totalItems, totalPages);
}

function renderDetailHeader() {
    if (!currentRfq) return;
    const rfq = currentRfq;

    document.getElementById('detailTitle').textContent = rfq.title || 'Untitled RFQ';
    document.getElementById('breadcrumbRfqNumber').textContent = rfq.rfq_number || 'Detail';
    document.getElementById('detailStatusBadge').innerHTML = renderStatusBadge(rfq.status);
    document.getElementById('metaRfqNumber').textContent = rfq.rfq_number || '-';
    document.getElementById('metaInquiry').textContent = rfq.inquiry_number || rfq.inquiry_title || '-';
    document.getElementById('metaDeadline').textContent = formatDate(rfq.quote_deadline);
    document.getElementById('metaCreated').textContent = formatDate(rfq.created_at);

    const notesSection = document.getElementById('notesSection');
    if (rfq.notes_to_vendor) {
        notesSection.style.display = 'block';
        document.getElementById('detailNotes').textContent = rfq.notes_to_vendor;
    } else {
        notesSection.style.display = 'none';
    }

    // Header actions
    const actionsDiv = document.getElementById('detailActions');
    let actionsHtml = '';

    // Edit button (draft only)
    if (rfq.status === 'draft') {
        actionsHtml += `<button class="btn btn-secondary btn-sm" onclick="openEditRfqModal()">Edit</button>`;
    }

    // AI Suggest Vendors button (visible when RFQ is in draft or sent status AND AI is available)
    if (aiAvailable && (rfq.status === 'draft' || rfq.status === 'sent')) {
        actionsHtml += `
            <button class="btn btn-sm" id="aiSuggestVendorsBtn" style="background: rgba(245, 158, 11, 0.15); color: var(--color-warning); border: 1px solid rgba(245, 158, 11, 0.3); font-weight: 600;" onclick="aiSuggestVendors()">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2z"/>
                    <path d="M12 6v6l4 2"/>
                </svg>
                AI Suggest Vendors
            </button>
        `;
    }

    if (rfq.status === 'fully_quoted' || rfq.status === 'sent' || rfq.status === 'partially_quoted') {
        actionsHtml += `
            <button class="btn btn-primary btn-sm" onclick="navigateToComparison('${rfq.id}')">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="18" y1="20" x2="18" y2="10"/>
                    <line x1="12" y1="20" x2="12" y2="4"/>
                    <line x1="6" y1="20" x2="6" y2="14"/>
                </svg>
                Compare Quotes
            </button>
        `;
    }

    actionsDiv.innerHTML = actionsHtml;

    // Show/hide buttons based on status
    const addVendorBtn = document.getElementById('addVendorBtn');
    const sendRfqBtn = document.getElementById('sendRfqBtn');
    if (rfq.status === 'draft') {
        addVendorBtn.style.display = '';
        sendRfqBtn.style.display = '';
    } else {
        addVendorBtn.style.display = 'none';
        sendRfqBtn.style.display = 'none';
    }

    document.title = `${rfq.rfq_number || 'RFQ'} - Procurement | Ragenaizer`;
}

function updateSendButton() {
    const sendBtn = document.getElementById('sendRfqBtn');
    if (currentRfq && currentRfq.status === 'draft' && rfqVendors.length > 0) {
        sendBtn.style.display = '';
    } else if (currentRfq && currentRfq.status !== 'draft') {
        sendBtn.style.display = 'none';
    }
}

function renderRfqVendorsTable() {
    const tbody = document.getElementById('rfqVendorsTableBody');

    if (!rfqVendors || rfqVendors.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="4" class="crm-empty-state">
                    <div class="crm-empty-content">
                        <p>No vendors assigned yet</p>
                        ${currentRfq && currentRfq.status === 'draft' ? '<button class="btn btn-sm btn-primary" onclick="openAddVendorModal()">Add a vendor</button>' : ''}
                    </div>
                </td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = rfqVendors.map(v => {
        const vendorStatus = v.quote_status || v.status || 'pending';
        const shareToken = v.share_token || '';
        const portalUrl = shareToken ? `${window.location.origin}/pages/procurement/vendor-portal.html?token=${shareToken}` : '';
        return `
            <tr>
                <td>
                    <div class="crm-cell-primary" style="display: flex; align-items: center; gap: 10px;">
                        <div class="crm-avatar" style="width: 32px; height: 32px; border-radius: 8px; background: var(--brand-primary); color: var(--text-inverse); display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 600; flex-shrink: 0;">
                            ${getInitials(v.vendor_name)}
                        </div>
                        <div>
                            <div style="color: var(--text-primary); font-weight: 500;">${escapeHtml(v.vendor_name || '')}</div>
                            ${v.vendor_email ? `<div class="crm-cell-secondary">${escapeHtml(v.vendor_email)}</div>` : ''}
                        </div>
                    </div>
                </td>
                <td>${renderVendorQuoteStatus(vendorStatus)}</td>
                <td class="hide-mobile">
                    ${portalUrl ? `
                        <button class="btn btn-sm" style="background: rgba(var(--brand-primary-rgb, 59,130,246), 0.1); color: var(--brand-primary); border: 1px solid rgba(var(--brand-primary-rgb, 59,130,246), 0.2); border-radius: 6px; padding: 4px 12px; font-size: 12px; font-weight: 600; cursor: pointer; display: inline-flex; align-items: center; gap: 6px;" onclick="event.stopPropagation(); copyPortalLink('${escapeHtml(shareToken)}')" title="Copy Portal Link">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                            </svg>
                            Copy Link
                        </button>
                    ` : '<span class="crm-cell-secondary">-</span>'}
                </td>
                <td>
                    <div class="crm-actions">
                        ${vendorStatus === 'submitted' || vendorStatus === 'revised' ? `
                            <button class="crm-action-btn" onclick="viewVendorQuote('${v.vendor_id || v.id}')" title="View Quote">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
                                </svg>
                            </button>
                        ` : ''}
                        ${currentRfq && currentRfq.status === 'draft' ? `
                            <button class="crm-action-btn action-delete" onclick="removeVendorFromRfq('${v.vendor_id || v.id}')" title="Remove">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <polyline points="3 6 5 6 21 6"/>
                                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                                </svg>
                            </button>
                        ` : ''}
                    </div>
                </td>
            </tr>
        `;
    }).join('');
}

function renderRfqItemsTable() {
    const tbody = document.getElementById('rfqItemsTableBody');

    if (!rfqItems || rfqItems.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="4" class="crm-empty-state">
                    <div class="crm-empty-content">
                        <p>No items in this RFQ</p>
                    </div>
                </td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = rfqItems.map(item => `
        <tr>
            <td>
                <div class="crm-cell-primary">
                    <div style="color: var(--text-primary); font-weight: 500;">${escapeHtml(item.item_name || '')}</div>
                </div>
            </td>
            <td><span style="color: var(--text-primary); font-weight: 600;">${item.quantity || 0}</span></td>
            <td class="hide-mobile"><span class="crm-cell-secondary">${escapeHtml(item.unit || '-')}</span></td>
            <td class="hide-mobile"><span class="crm-cell-secondary">${escapeHtml(item.description || '-')}</span></td>
        </tr>
    `).join('');
}

// ==================== Status Badges ====================

function renderStatusBadge(status) {
    if (!status) return '';
    const colorMap = {
        'draft': 'background: var(--bg-tertiary); color: var(--text-secondary);',
        'sent': 'background: rgba(59, 130, 246, 0.15); color: var(--color-info);',
        'partially_quoted': 'background: rgba(245, 158, 11, 0.15); color: var(--color-warning);',
        'fully_quoted': 'background: rgba(16, 185, 129, 0.15); color: var(--color-success);',
        'closed': 'background: rgba(139, 92, 246, 0.15); color: var(--color-purple, #8b5cf6);',
        'cancelled': 'background: rgba(239, 68, 68, 0.15); color: var(--color-error);'
    };
    const style = colorMap[status] || 'background: var(--bg-tertiary); color: var(--text-secondary);';
    const label = status.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    return `<span class="status-badge" style="${style} padding: 3px 10px; border-radius: 12px; font-size: 11px; font-weight: 600;">${label}</span>`;
}

function renderVendorQuoteStatus(status) {
    const colorMap = {
        'pending': 'background: var(--bg-tertiary); color: var(--text-secondary);',
        'viewed': 'background: rgba(59, 130, 246, 0.15); color: var(--color-info);',
        'submitted': 'background: rgba(16, 185, 129, 0.15); color: var(--color-success);',
        'declined': 'background: rgba(239, 68, 68, 0.15); color: var(--color-error);'
    };
    const style = colorMap[status] || 'background: var(--bg-tertiary); color: var(--text-secondary);';
    const label = (status || 'pending').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    return `<span class="status-badge" style="${style} padding: 3px 10px; border-radius: 12px; font-size: 11px; font-weight: 600;">${label}</span>`;
}

// ==================== Modal Handling ====================

function openModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.classList.add('gm-animating');
        requestAnimationFrame(() => {
            modal.classList.add('active');
        });
    }
}

function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.classList.remove('active');
        setTimeout(() => {
            modal.classList.remove('gm-animating');
        }, 200);
    }
}

function openCreateRfqModal() {
    document.getElementById('createRfqForm').reset();
    if (_rfqInquiryDropdown) _rfqInquiryDropdown.setValue('');
    loadInquiriesForModal();
    openModal('createRfqModal');
}

function closeCreateRfqModal() {
    closeModal('createRfqModal');
}

function openAddVendorModal() {
    const searchInput = document.getElementById('vendorSearchInput');
    if (searchInput) searchInput.value = '';
    selectedVendorIds.clear();
    loadVendorsForModal();
    openModal('addVendorModal');
}

function closeAddVendorModal() {
    closeModal('addVendorModal');
}

// ==================== CRUD Operations ====================

async function handleCreateRfq(event) {
    event.preventDefault();

    const submitBtn = document.getElementById('createRfqSubmitBtn');
    const spinner = document.getElementById('createRfqSpinner');
    submitBtn.disabled = true;
    if (spinner) spinner.style.display = 'inline-block';

    const formData = {
        inquiry_id: document.getElementById('rfqInquiry').value,
        title: document.getElementById('rfqTitle').value.trim(),
        quote_deadline: document.getElementById('rfqDeadline').value || null,
        notes_to_vendor: document.getElementById('rfqNotes').value.trim()
    };

    try {
        const response = await api.request('/procurement/rfqs', {
            method: 'POST',
            body: JSON.stringify(formData)
        });
        Toast.success('RFQ created successfully');
        closeCreateRfqModal();
        const newRfq = response.data || response;
        if (newRfq && newRfq.id) {
            showDetailView(newRfq.id);
        } else {
            loadRfqs();
        }
    } catch (error) {
        console.error('Failed to create RFQ:', error);
        Toast.error(error.message || 'Failed to create RFQ');
    } finally {
        submitBtn.disabled = false;
        if (spinner) spinner.style.display = 'none';
    }
}

async function handleAddVendor(event) {
    if (event) event.preventDefault();

    if (selectedVendorIds.size === 0) {
        Toast.error('Please select at least one vendor');
        return;
    }

    const submitBtn = document.getElementById('addVendorSubmitBtn');
    const spinner = document.getElementById('addVendorSpinner');
    submitBtn.disabled = true;
    if (spinner) spinner.style.display = 'inline-block';

    const vendorIds = Array.from(selectedVendorIds);

    try {
        // Try batch endpoint first, fall back to individual calls
        try {
            await api.request(`/procurement/rfqs/${currentRfq.id}/vendors/batch`, {
                method: 'POST',
                body: JSON.stringify({ vendor_ids: vendorIds })
            });
        } catch (batchErr) {
            // Batch endpoint not available — add one by one
            let added = 0, failed = 0;
            for (const vid of vendorIds) {
                try {
                    await api.request(`/procurement/rfqs/${currentRfq.id}/vendors`, {
                        method: 'POST',
                        body: JSON.stringify({ vendor_id: vid })
                    });
                    added++;
                } catch (e) {
                    console.warn(`Failed to add vendor ${vid}:`, e.message);
                    failed++;
                }
            }
            if (failed > 0 && added === 0) throw new Error(`Failed to add any vendors`);
            if (failed > 0) Toast.warning(`${added} added, ${failed} failed`);
        }
        Toast.success(`${vendorIds.length} vendor${vendorIds.length > 1 ? 's' : ''} added to RFQ`);
        closeAddVendorModal();
        loadRfqVendors(currentRfq.id);
    } catch (error) {
        console.error('Failed to add vendors:', error);
        Toast.error(error.message || 'Failed to add vendors');
    } finally {
        submitBtn.disabled = false;
        if (spinner) spinner.style.display = 'none';
    }
}

async function removeVendorFromRfq(vendorId) {
    const confirmed = await showConfirm('Remove this vendor from the RFQ?', 'Remove Vendor', 'danger');
    if (!confirmed) return;

    try {
        await api.request(`/procurement/rfqs/${currentRfq.id}/vendors/${vendorId}`, { method: 'DELETE' });
        Toast.success('Vendor removed');
        loadRfqVendors(currentRfq.id);
    } catch (error) {
        console.error('Failed to remove vendor:', error);
        Toast.error('Failed to remove vendor');
    }
}

async function sendRfq() {
    if (!currentRfq || rfqVendors.length === 0) {
        Toast.error('Add at least one vendor before sending');
        return;
    }

    const confirmed = await showConfirm(
        `This will send the RFQ to ${rfqVendors.length} vendor(s) and generate portal links. Continue?`,
        'Send RFQ',
        'primary'
    );
    if (!confirmed) return;

    try {
        await api.request(`/procurement/rfqs/${currentRfq.id}/send`, { method: 'POST' });
        Toast.success('RFQ sent successfully');
        loadRfqDetail(currentRfq.id);
    } catch (error) {
        console.error('Failed to send RFQ:', error);
        Toast.error(error.message || 'Failed to send RFQ');
    }
}

// ==================== Navigation ====================

function navigateToInquiry() {
    if (currentRfq && currentRfq.inquiry_id) {
        window.location.href = `inquiry-detail.html?id=${currentRfq.inquiry_id}`;
    }
}

function navigateToComparison(rfqId) {
    window.location.href = `comparisons.html?rfqId=${rfqId}`;
}

// ==================== Utilities ====================

function copyToClipboard(text) {
    navigator.clipboard.writeText(text).then(() => {
        Toast.success('Copied to clipboard');
    }).catch(() => {
        // Fallback
        const ta = document.createElement('textarea');
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        Toast.success('Copied to clipboard');
    });
}

function copyPortalLink(token) {
    const url = `${window.location.origin}/pages/procurement/vendor-portal.html?token=${token}`;
    navigator.clipboard.writeText(url).then(() => {
        Toast.success('Link copied!');
    }).catch(() => {
        const ta = document.createElement('textarea');
        ta.value = url;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        Toast.success('Link copied!');
    });
}

function formatDate(dateStr) {
    if (!dateStr) return '-';
    try {
        const date = new Date(dateStr);
        return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    } catch {
        return dateStr;
    }
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function getInitials(name) {
    if (!name) return '?';
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) {
        return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }
    return parts[0].substring(0, 2).toUpperCase();
}

// ==================== AI Suggest Vendors ====================

async function aiSuggestVendors(forceRegenerate = false) {
    if (!currentRfq || !currentRfq.inquiry_id) {
        Toast.error('No inquiry linked to this RFQ');
        return;
    }

    const btn = document.getElementById('aiSuggestVendorsBtn');
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = `
            <span class="btn-spinner" style="display:inline-block;"></span>
            ${forceRegenerate ? 'Regenerating...' : 'Analyzing...'}
        `;
    }

    try {
        const response = await api.request('/procurement/procurement-ai/suggest-vendors', {
            method: 'POST',
            body: JSON.stringify({
                inquiry_id: currentRfq.inquiry_id,
                rfq_id: currentRfq.id,
                force_regenerate: forceRegenerate
            })
        });

        const suggestions = response.data || response;
        const isCached = suggestions.cached === true;
        showAiSuggestionsModal(suggestions, isCached, suggestions.generated_at);
    } catch (error) {
        console.error('AI suggestion failed:', error);
        if (error.status === 503) {
            Toast.error('AI service unavailable. Please try again later.');
        } else {
            Toast.error(error.message || 'AI suggestion failed');
        }
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = `
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2z"/>
                    <path d="M12 6v6l4 2"/>
                </svg>
                AI Suggest Vendors
            `;
        }
    }
}

function showAiSuggestionsModal(suggestions, isCached = false, generatedAt = null) {
    const existing = document.getElementById('aiSuggestionsModal');
    if (existing) existing.remove();

    const items = (suggestions && suggestions.item_suggestions) || (suggestions && suggestions.suggestions) || [];
    if (!items.length) {
        Toast.info('No AI suggestions available.');
        return;
    }

    // Card styles via CSS classes — responsive to theme changes
    const cardStyle = 'display:flex; align-items:flex-start; gap:14px; padding:16px; margin-bottom:10px; border-radius:12px;';
    const topCardExtra = 'border-left: 3px solid var(--color-success, #10b981);';
    // Card colors now handled by CSS classes (.ai-sug-card) with [data-theme] selectors

    // Helper: build vendor card HTML
    function buildVendorCards(itemSug) {
        const vendorList = itemSug.vendors || itemSug.recommended_vendors || [];
        if (!vendorList.length) return '<div style="color: var(--text-secondary); padding: 20px; text-align: center;">No vendor suggestions for this item.</div>';
        return vendorList.map((v, vi) => {
            const confidence = v.confidence ? Math.round(v.confidence * 100) : 0;
            const confColor = confidence >= 75 ? 'var(--color-success)' : confidence >= 50 ? 'var(--color-warning)' : 'var(--color-error)';
            const rank = vi + 1;
            const rankColor = rank === 1 ? 'var(--color-success)' : rank === 2 ? 'var(--color-warning)' : 'var(--text-secondary)';
            return `
                <div class="ai-sug-card ${vi === 0 ? 'ai-sug-card-top' : ''}" style="${cardStyle}">
                    <div style="width: 30px; height: 30px; border-radius: 50%; background: ${rankColor}20; color: ${rankColor}; display: flex; align-items: center; justify-content: center; font-size: 13px; font-weight: 700; flex-shrink: 0; border: 1px solid ${rankColor}40;">${rank}</div>
                    <div style="flex: 1; min-width: 0;">
                        <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px;">
                            <span style="font-weight: 600; color: var(--text-primary); font-size: 13px;">${escapeHtml(v.vendor_name || '')}</span>
                            <span style="font-size: 11px; font-weight: 700; color: ${confColor}; background: ${confColor}20; padding: 1px 8px; border-radius: 10px;">${confidence}%</span>
                        </div>
                        <div style="color: var(--text-secondary); font-size: 12px; line-height: 1.6;">${Array.isArray(v.reasoning) ? '<ul style="margin:2px 0 0 0; padding-left:16px;">' + v.reasoning.slice(0,4).map(r => `<li>${escapeHtml(r)}</li>`).join('') + '</ul>' : escapeHtml(v.reasoning || '')}</div>
                    </div>
                    <button class="btn btn-sm btn-primary" style="font-size: 11px; padding: 5px 14px; flex-shrink: 0; white-space: nowrap;" onclick="addSuggestedVendor('${v.vendor_id}'); this.disabled=true; this.textContent='Added'; this.style.opacity='0.6';">
                        Add to RFQ
                    </button>
                </div>`;
        }).join('');
    }

    // Build overall vendor ranking across all items
    const vendorScores = {};
    items.forEach(item => {
        const vendorList = item.vendors || item.recommended_vendors || [];
        vendorList.forEach((v, rank) => {
            if (!vendorScores[v.vendor_id]) {
                vendorScores[v.vendor_id] = { name: v.vendor_name, totalConf: 0, count: 0, topPicks: 0, items: [] };
            }
            vendorScores[v.vendor_id].totalConf += (v.confidence || 0);
            vendorScores[v.vendor_id].count++;
            if (rank === 0) vendorScores[v.vendor_id].topPicks++;
            vendorScores[v.vendor_id].items.push({ item: item.item_name, confidence: v.confidence, rank: rank + 1 });
        });
    });
    const overallRanking = Object.entries(vendorScores)
        .map(([id, s]) => ({ vendor_id: id, vendor_name: s.name, avgConf: s.totalConf / s.count, count: s.count, topPicks: s.topPicks, items: s.items }))
        .sort((a, b) => b.avgConf - a.avgConf || b.topPicks - a.topPicks);

    const overallHtml = overallRanking.map((v, i) => {
        const avgPct = Math.round(v.avgConf * 100);
        const confColor = avgPct >= 75 ? 'var(--color-success)' : avgPct >= 50 ? 'var(--color-warning)' : 'var(--color-error)';
        const rank = i + 1;
        const rankColor = rank === 1 ? 'var(--color-success)' : rank === 2 ? 'var(--color-warning)' : 'var(--text-secondary)';
        const itemBreakdown = v.items.map(it => {
            const itPct = Math.round((it.confidence || 0) * 100);
            return `<span class="ai-sug-badge" style="display:inline-flex; align-items:center; gap:3px; font-size:11px; padding:3px 10px; border-radius:6px; margin:2px;">${escapeHtml(it.item)} <span style="color:${itPct >= 75 ? 'var(--color-success, #10b981)' : itPct >= 50 ? 'var(--color-warning, #f59e0b)' : 'var(--color-error, #ef4444)'}; font-weight:600;">#${it.rank}</span></span>`;
        }).join('');
        return `
            <div class="ai-sug-card ${i === 0 ? 'ai-sug-card-top' : ''}" style="${cardStyle}">
                <div style="width: 34px; height: 34px; border-radius: 50%; background: ${rankColor}20; color: ${rankColor}; display: flex; align-items: center; justify-content: center; font-size: 14px; font-weight: 700; flex-shrink: 0; border: 1px solid ${rankColor}40;">${rank}</div>
                <div style="flex: 1; min-width: 0;">
                    <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 6px; flex-wrap: wrap;">
                        <span style="font-weight: 600; color: var(--text-primary); font-size: 14px;">${escapeHtml(v.vendor_name)}</span>
                        <span style="font-size: 12px; font-weight: 700; color: ${confColor}; background: ${confColor}20; padding: 2px 10px; border-radius: 10px;">${avgPct}% avg</span>
                        <span style="font-size: 11px; color: var(--text-secondary);">Recommended for ${v.count}/${items.length} items</span>
                        ${v.topPicks > 0 ? `<span style="font-size: 11px; color: var(--color-success); font-weight: 600;">#1 pick on ${v.topPicks} item${v.topPicks > 1 ? 's' : ''}</span>` : ''}
                    </div>
                    <div style="display: flex; flex-wrap: wrap; gap: 2px;">${itemBreakdown}</div>
                </div>
                <button class="btn btn-sm btn-primary" style="font-size: 11px; padding: 5px 14px; flex-shrink: 0; white-space: nowrap;" onclick="addSuggestedVendor('${v.vendor_id}'); this.disabled=true; this.textContent='Added'; this.style.opacity='0.6';">
                    Add to RFQ
                </button>
            </div>`;
    }).join('');

    // Build searchable dropdown options
    const dropdownOptions = [`<option value="overall" selected>Overall Ranking</option>`].concat(
        items.map((item, i) => {
            const vendorList = item.vendors || item.recommended_vendors || [];
            return `<option value="${i}">${escapeHtml(item.item_name || 'Item')} (${vendorList.length} vendors)</option>`;
        })
    ).join('');

    // Build panels
    const panelsHtml = `<div id="aiSugPanelOverall" class="ai-sug-panel" style="display: block;">${overallHtml}</div>` +
        items.map((item, i) => `
            <div id="aiSugPanel${i}" class="ai-sug-panel" style="display: none;">
                ${buildVendorCards(item)}
            </div>
        `).join('');

    const modal = document.createElement('div');
    modal.id = 'aiSuggestionsModal';
    modal.className = 'gm-overlay gm-animating';
    modal.innerHTML = `
        <style>
            .ai-sug-card { background: #f8fafc; border: 1px solid #d1d5db; box-shadow: 0 1px 4px rgba(0,0,0,0.1); }
            .ai-sug-card-top { border-left: 3px solid var(--color-success, #10b981); }
            .ai-sug-badge { background: #e2e8f0; border: 1px solid #cbd5e1; color: #334155; }
            .ai-sug-header-border { border-color: #e2e8f0; }
            [data-theme="dark"] .ai-sug-card { background: #1e293b; border: 1px solid #475569; box-shadow: 0 2px 8px rgba(0,0,0,0.3); }
            [data-theme="dark"] .ai-sug-badge { background: #0f172a; border: 1px solid #475569; color: #94a3b8; }
            [data-theme="dark"] .ai-sug-header-border { border-color: #334155; }
        </style>
        <div class="gm-modal" style="max-width: 950px; width: 92vw; max-height: 85vh; display: flex; flex-direction: column;">
            <div class="gm-header">
                <h3 class="gm-title" style="display: flex; align-items: center; gap: 8px;">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--color-warning)" stroke-width="2">
                        <path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2z"/>
                        <path d="M12 6v6l4 2"/>
                    </svg>
                    AI Vendor Suggestions
                    <span style="font-size: 12px; font-weight: 400; color: var(--text-secondary); margin-left: 4px;">(${items.length} items)</span>
                </h3>
                <button class="gm-close" onclick="document.getElementById('aiSuggestionsModal').remove();">&times;</button>
            </div>
            <div class="ai-sug-header-border" style="padding: 12px 20px; border-bottom: 1px solid; display: flex; align-items: center; gap: 12px;">
                <label style="font-size: 13px; font-weight: 600; color: var(--text-secondary, #64748b); white-space: nowrap;">View for:</label>
                <div id="aiSugDropdownContainer" style="flex: 1;"></div>
            </div>
            <div class="gm-body" style="overflow-y: auto; flex: 1; padding: 16px 20px;">
                ${panelsHtml}
            </div>
            <div class="gm-footer" style="display: flex; justify-content: space-between; align-items: center;">
                <div style="display: flex; align-items: center; gap: 12px;">
                    ${isCached && generatedAt ? `<span style="font-size: 11px; color: var(--text-secondary);">Generated ${new Date(generatedAt).toLocaleDateString()} ${new Date(generatedAt).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</span>` : ''}
                    <button class="btn btn-sm" style="font-size: 11px; padding: 4px 12px; border: 1px solid var(--border-primary); background: transparent; color: var(--text-secondary); cursor: pointer;" onclick="document.getElementById('aiSuggestionsModal').remove(); aiSuggestVendors(true);">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right: 4px;">
                            <path d="M23 4v6h-6"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
                        </svg>
                        Regenerate
                    </button>
                </div>
                <button class="btn btn-secondary btn-sm" onclick="document.getElementById('aiSuggestionsModal').remove();">Close</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);

    // Initialize SearchableDropdown for item selection
    const ddOptions = [{ value: 'overall', label: 'Overall Ranking', description: `${items.length} items` }].concat(
        items.map((item, i) => {
            const vl = item.vendors || item.recommended_vendors || [];
            return { value: String(i), label: item.item_name || 'Item', description: `${vl.length} vendors` };
        })
    );

    const aiSugDropdown = new SearchableDropdown('aiSugDropdownContainer', {
        options: ddOptions,
        value: 'overall',
        placeholder: 'Select item...',
        searchPlaceholder: 'Search items...',
        onChange: (value) => {
            document.querySelectorAll('.ai-sug-panel').forEach(p => p.style.display = 'none');
            if (value === 'overall') {
                document.getElementById('aiSugPanelOverall').style.display = 'block';
            } else {
                document.getElementById('aiSugPanel' + value).style.display = 'block';
            }
        }
    });

    // Prevent clicks inside the modal from closing overlay
    const gmModal = modal.querySelector('.gm-modal');
    if (gmModal) {
        gmModal.addEventListener('click', function(e) {
            e.stopPropagation();
        });
    }

    // Close modal when clicking the overlay background
    modal.addEventListener('click', function(e) {
        if (e.target === modal) {
            modal.remove();
        }
    });

    requestAnimationFrame(() => modal.classList.add('active'));
}

async function addSuggestedVendor(vendorId) {
    if (!currentRfq) return;
    try {
        await api.request(`/procurement/rfqs/${currentRfq.id}/vendors`, {
            method: 'POST',
            body: JSON.stringify({ vendor_id: vendorId })
        });
        Toast.success('Vendor added to RFQ');
        loadRfqVendors(currentRfq.id);
    } catch (error) {
        console.error('Failed to add suggested vendor:', error);
        Toast.error(error.message || 'Failed to add vendor');
    }
}

// ==================== Pagination ====================

function rfqGoToPage(page) {
    const totalPages = Math.ceil(_rfqFiltered.length / RFQ_PAGE_SIZE);
    if (page < 1 || page > totalPages) return;
    _rfqCurrentPage = page;
    renderRfqsTable(_rfqFiltered);
    const table = document.getElementById('rfqsTableBody')?.closest('table');
    if (table) table.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function rfqRenderPagination(totalItems, totalPages) {
    let container = document.getElementById('rfqsPagination');
    if (!container) {
        container = document.createElement('div');
        container.id = 'rfqsPagination';
        const table = document.getElementById('rfqsTableBody')?.closest('table');
        if (table) table.parentNode.insertBefore(container, table.nextSibling);
    }
    if (totalPages <= 1) {
        container.innerHTML = totalItems > 0
            ? `<div style="padding:10px 0; text-align:center; font-size:12px; color:var(--text-secondary);">${totalItems} record${totalItems !== 1 ? 's' : ''}</div>`
            : '';
        return;
    }
    const startItem = (_rfqCurrentPage - 1) * RFQ_PAGE_SIZE + 1;
    const endItem = Math.min(_rfqCurrentPage * RFQ_PAGE_SIZE, totalItems);
    let pages = [];
    if (totalPages <= 7) { for (let i = 1; i <= totalPages; i++) pages.push(i); }
    else {
        pages.push(1);
        if (_rfqCurrentPage > 3) pages.push('...');
        const start = Math.max(2, _rfqCurrentPage - 1);
        const end = Math.min(totalPages - 1, _rfqCurrentPage + 1);
        for (let i = start; i <= end; i++) pages.push(i);
        if (_rfqCurrentPage < totalPages - 2) pages.push('...');
        pages.push(totalPages);
    }
    const base = 'padding:6px 12px; border-radius:6px; font-size:13px; min-width:34px; text-align:center; transition:all 0.15s;';
    const btnStyle = `${base} background:var(--bg-tertiary); color:var(--text-primary); cursor:pointer; border:1px solid var(--border-primary);`;
    const activeBtnStyle = `${base} background:var(--brand-primary); color:#fff; cursor:default; font-weight:600; box-shadow:0 2px 6px rgba(59,130,246,0.35); border:1px solid var(--brand-primary);`;
    const navStyle = `${base} background:var(--bg-tertiary); color:var(--text-primary); cursor:pointer; font-weight:500; border:1px solid var(--border-primary);`;
    const disabledNavStyle = `${base} background:transparent; color:var(--text-secondary); cursor:not-allowed; opacity:0.4; border:1px solid var(--border-primary);`;
    container.innerHTML = `
        <div style="display:flex; align-items:center; justify-content:space-between; padding:14px 4px; flex-wrap:wrap; gap:10px; border-top:1px solid var(--border-primary);">
            <span style="font-size:13px; color:var(--text-secondary);">Showing <strong style="color:var(--text-primary);">${startItem}–${endItem}</strong> of <strong style="color:var(--text-primary);">${totalItems}</strong></span>
            <div style="display:flex; gap:6px; align-items:center;">
                <button onclick="rfqGoToPage(${_rfqCurrentPage - 1})" style="${_rfqCurrentPage === 1 ? disabledNavStyle : navStyle}" ${_rfqCurrentPage === 1 ? 'disabled' : ''}>&lsaquo; Prev</button>
                ${pages.map(p => p === '...' ? '<span style="padding:4px 4px; font-size:13px; color:var(--text-secondary);">…</span>' : `<button onclick="rfqGoToPage(${p})" style="${p === _rfqCurrentPage ? activeBtnStyle : btnStyle}">${p}</button>`).join('')}
                <button onclick="rfqGoToPage(${_rfqCurrentPage + 1})" style="${_rfqCurrentPage === totalPages ? disabledNavStyle : navStyle}" ${_rfqCurrentPage === totalPages ? 'disabled' : ''}>Next &rsaquo;</button>
            </div>
        </div>`;
}

// ==================== EDIT RFQ ====================

function openEditRfqModal() {
    if (!currentRfq) return;
    document.getElementById('editRfqTitle').value = currentRfq.title || '';
    document.getElementById('editRfqDeadline').value = currentRfq.quote_deadline ? new Date(currentRfq.quote_deadline).toISOString().split('T')[0] : '';
    document.getElementById('editRfqNotes').value = currentRfq.notes_to_vendor || '';
    openModal('editRfqModal');
}

async function handleEditRfq(event) {
    event.preventDefault();
    const btn = document.getElementById('editRfqSubmitBtn');
    btn.disabled = true;
    try {
        await api.request('/procurement/rfqs', {
            method: 'PUT',
            body: JSON.stringify({
                id: currentRfq.id,
                title: document.getElementById('editRfqTitle').value.trim() || null,
                quote_deadline: document.getElementById('editRfqDeadline').value || null,
                notes_to_vendor: document.getElementById('editRfqNotes').value.trim() || null
            })
        });
        Toast.success('RFQ updated');
        closeModal('editRfqModal');
        loadRfqDetail(currentRfq.id);
    } catch (e) {
        Toast.error(e.message || 'Failed to update RFQ');
    } finally {
        btn.disabled = false;
    }
}

// ==================== VIEW / DELETE QUOTE ====================

let currentQuoteId = null;

async function viewVendorQuote(vendorId) {
    const body = document.getElementById('viewQuoteBody');
    const footer = document.getElementById('viewQuoteFooter');
    body.innerHTML = '<div style="text-align:center;padding:30px;opacity:0.5;">Loading quote...</div>';
    footer.style.display = 'none';
    currentQuoteId = null;
    openModal('viewQuoteModal');

    try {
        // Get quotes for this RFQ, find the one for this vendor
        const data = await api.request(`/procurement/vendor-quotes?rfqId=${currentRfq.id}`);
        const quotes = data.data || data || [];
        const quote = quotes.find(q => q.vendor_id === vendorId);
        if (!quote) { body.innerHTML = '<div style="text-align:center;padding:30px;opacity:0.5;">No quote found for this vendor.</div>'; return; }

        // Load full quote detail
        const detail = await api.request(`/procurement/vendor-quotes/${quote.id}`);
        const q = detail.data || detail;
        currentQuoteId = q.id;

        document.getElementById('viewQuoteTitle').textContent = `Quote — ${escapeHtml(q.vendor_name || 'Vendor')}`;

        let html = `<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:16px;">
            <div><div style="font-size:11px;color:var(--text-secondary);text-transform:uppercase;">Total</div><div style="font-size:16px;font-weight:700;">${q.total_amount != null ? parseFloat(q.total_amount).toLocaleString('en-IN', {minimumFractionDigits:2}) : '-'}</div></div>
            <div><div style="font-size:11px;color:var(--text-secondary);text-transform:uppercase;">Delivery</div><div style="font-weight:600;">${q.delivery_days ? q.delivery_days + ' days' : '-'}</div></div>
            <div><div style="font-size:11px;color:var(--text-secondary);text-transform:uppercase;">Payment</div><div style="font-weight:600;">${escapeHtml(q.payment_terms || '-')}</div></div>
        </div>`;

        if (q.vendor_notes) {
            html += `<div style="padding:8px 12px;border:1px solid var(--border-primary);border-radius:6px;margin-bottom:16px;font-size:12px;"><strong>Vendor Notes:</strong> ${escapeHtml(q.vendor_notes)}</div>`;
        }

        const items = q.items || [];
        if (items.length > 0) {
            html += `<table style="width:100%;border-collapse:collapse;font-size:12px;border:1px solid var(--border-primary);border-radius:6px;overflow:hidden;">
                <thead><tr style="background:var(--bg-tertiary);">
                    <th style="padding:6px 10px;text-align:left;font-size:11px;text-transform:uppercase;color:var(--text-secondary);">Item</th>
                    <th style="padding:6px 10px;text-align:right;font-size:11px;text-transform:uppercase;color:var(--text-secondary);">Qty</th>
                    <th style="padding:6px 10px;text-align:right;font-size:11px;text-transform:uppercase;color:var(--text-secondary);">Unit Price</th>
                    <th style="padding:6px 10px;text-align:right;font-size:11px;text-transform:uppercase;color:var(--text-secondary);">Total</th>
                </tr></thead>
                <tbody>${items.map(it => `<tr style="border-top:1px solid var(--border-primary);">
                    <td style="padding:5px 10px;">${escapeHtml(it.vendor_item_name || it.normalized_item_name || it.inquiry_item_name || '-')}</td>
                    <td style="padding:5px 10px;text-align:right;">${it.quantity || '-'}</td>
                    <td style="padding:5px 10px;text-align:right;">${it.unit_price != null ? parseFloat(it.unit_price).toLocaleString('en-IN', {minimumFractionDigits:2}) : '-'}</td>
                    <td style="padding:5px 10px;text-align:right;font-weight:600;">${it.total_price != null ? parseFloat(it.total_price).toLocaleString('en-IN', {minimumFractionDigits:2}) : '-'}</td>
                </tr>`).join('')}</tbody>
            </table>`;
        }

        body.innerHTML = html;
        footer.style.display = '';
        // Only show Delete Quote if RFQ is still in draft (quotes not yet used in comparisons)
        const deleteBtn = document.getElementById('deleteQuoteBtn');
        if (deleteBtn) {
            deleteBtn.style.display = (currentRfq && currentRfq.status === 'draft') ? '' : 'none';
        }
    } catch (e) {
        body.innerHTML = `<div style="text-align:center;padding:30px;color:var(--color-error);">Failed to load quote: ${escapeHtml(e.message || '')}</div>`;
    }
}

async function deleteCurrentQuote() {
    if (!currentQuoteId) return;
    const confirmed = await showConfirm('Delete this vendor quote? This cannot be undone.', 'Delete Quote', 'danger');
    if (!confirmed) return;
    try {
        await api.request(`/procurement/vendor-quotes/${currentQuoteId}`, { method: 'DELETE' });
        Toast.success('Quote deleted');
        closeModal('viewQuoteModal');
        loadRfqDetail(currentRfq.id);
    } catch (e) {
        Toast.error(e.message || 'Failed to delete quote');
    }
}
