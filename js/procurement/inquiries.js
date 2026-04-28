/**
 * Procurement Inquiries Management
 * Handles listing, filtering, and creation of inquiries.
 */

// ==================== State ====================
let allInquiries = [];
let _inqFiltered = [];
let _inqCurrentPage = 1;
const INQ_PAGE_SIZE = 20;

// ==================== Initialization ====================

document.addEventListener('DOMContentLoaded', () => {
    Navigation.init('procurement', '../');

    if (!api.isAuthenticated()) {
        window.location.href = '../login.html';
        return;
    }

    loadInquiries();

    // Convert filter dropdowns to searchable after script loads
    setTimeout(() => {
        if (typeof convertSelectToSearchable === 'function') {
            convertSelectToSearchable('filterStatus', {
                placeholder: 'All Statuses',
                searchPlaceholder: 'Search status...',
                compact: true,
                onChange: () => applyFilters()
            });
            convertSelectToSearchable('filterPriority', {
                placeholder: 'All Priorities',
                searchPlaceholder: 'Search priority...',
                compact: true,
                onChange: () => applyFilters()
            });
        }
    }, 100);
});

// ==================== Data Loading ====================

async function loadInquiries() {
    try {
        const response = await api.request('/procurement/inquiries');
        allInquiries = response.data || response || [];
        _inqFiltered = allInquiries;
        renderInquiriesTable(allInquiries);
    } catch (error) {
        console.error('Failed to load inquiries:', error);
        renderInquiriesTable([]);
        Toast.error('Failed to load inquiries');
    }
}

// ==================== Filter Handling ====================

function applyFilters() {
    const search = document.getElementById('filterSearch').value.trim().toLowerCase();
    const status = document.getElementById('filterStatus').value;
    const priority = document.getElementById('filterPriority').value;

    let filtered = allInquiries;

    if (search) {
        filtered = filtered.filter(inq => {
            const number = (inq.inquiry_number || '').toLowerCase();
            const title = (inq.title || '').toLowerCase();
            const client = (inq.client_name || '').toLowerCase();
            const project = (inq.project_name || '').toLowerCase();
            return number.includes(search) || title.includes(search) || client.includes(search) || project.includes(search);
        });
    }

    if (status) {
        filtered = filtered.filter(inq => inq.status === status);
    }

    if (priority) {
        filtered = filtered.filter(inq => inq.priority === priority);
    }

    _inqFiltered = filtered;
    _inqCurrentPage = 1;
    renderInquiriesTable(filtered);
}

// ==================== Table Rendering ====================

function renderInquiriesTable(inquiries) {
    const tbody = document.getElementById('inquiriesTableBody');

    if (!inquiries || inquiries.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="9" class="crm-empty-state">
                    <div class="crm-empty-content">
                        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                            <circle cx="12" cy="12" r="10"/>
                            <line x1="12" y1="8" x2="12" y2="12"/>
                            <line x1="12" y1="16" x2="12.01" y2="16"/>
                        </svg>
                        <p>No inquiries found</p>
                        <button class="btn btn-sm btn-primary" onclick="openNewInquiryModal()">Create your first inquiry</button>
                    </div>
                </td>
            </tr>
        `;
        inqRenderPagination(0, 0);
        return;
    }

    const totalItems = inquiries.length;
    const totalPages = Math.ceil(totalItems / INQ_PAGE_SIZE);
    if (_inqCurrentPage > totalPages) _inqCurrentPage = totalPages;
    const startIdx = (_inqCurrentPage - 1) * INQ_PAGE_SIZE;
    const pageItems = inquiries.slice(startIdx, startIdx + INQ_PAGE_SIZE);

    tbody.innerHTML = pageItems.map(inq => `
        <tr style="cursor: pointer;" onclick="window.location.href='inquiry-detail.html?id=${inq.id}'">
            <td>
                <span style="color: var(--brand-primary); font-weight: 600; font-size: 13px;">${escapeHtml(inq.inquiry_number || '-')}</span>
            </td>
            <td>
                <div class="crm-cell-primary">
                    <div style="color: var(--text-primary); font-weight: 500;">${escapeHtml(inq.title || '')}</div>
                </div>
            </td>
            <td class="hide-mobile"><span class="crm-cell-secondary">${escapeHtml(inq.client_name || '-')}</span></td>
            <td class="hide-mobile"><span class="crm-cell-secondary">${escapeHtml(inq.project_name || '-')}</span></td>
            <td>${renderStatusBadge(inq.status)}</td>
            <td class="hide-mobile">${renderPriorityBadge(inq.priority)}</td>
            <td class="hide-mobile"><span class="crm-cell-secondary">${inq.item_count || 0}</span></td>
            <td class="hide-mobile"><span class="crm-cell-secondary">${formatDate(inq.due_date)}</span></td>
            <td>
                <div class="crm-actions" onclick="event.stopPropagation();">
                    <button class="crm-action-btn" onclick="window.location.href='inquiry-detail.html?id=${inq.id}'" title="View">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                            <circle cx="12" cy="12" r="3"/>
                        </svg>
                    </button>
                </div>
            </td>
        </tr>
    `).join('');

    inqRenderPagination(totalItems, totalPages);
}

function renderStatusBadge(status) {
    if (!status) return '<span class="crm-cell-secondary">-</span>';
    const colorMap = {
        'draft': 'background: var(--bg-tertiary); color: var(--text-secondary);',
        'open': 'background: rgba(var(--brand-primary-rgb), 0.15); color: var(--brand-primary);',
        'in_progress': 'background: rgba(59, 130, 246, 0.15); color: var(--color-info);',
        'rfq_sent': 'background: rgba(139, 92, 246, 0.15); color: var(--color-purple);',
        'quoted': 'background: rgba(245, 158, 11, 0.15); color: var(--color-warning);',
        'closed': 'background: rgba(16, 185, 129, 0.15); color: var(--color-success);',
        'cancelled': 'background: rgba(239, 68, 68, 0.15); color: var(--color-error);'
    };
    const style = colorMap[status] || 'background: var(--bg-tertiary); color: var(--text-secondary);';
    const label = status.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    return `<span class="status-badge" style="${style} padding: 3px 10px; border-radius: 12px; font-size: 11px; font-weight: 600;">${label}</span>`;
}

function renderPriorityBadge(priority) {
    if (!priority) return '<span class="crm-cell-secondary">-</span>';
    const colorMap = {
        'low': 'background: rgba(16, 185, 129, 0.15); color: var(--color-success);',
        'medium': 'background: rgba(59, 130, 246, 0.15); color: var(--color-info);',
        'high': 'background: rgba(245, 158, 11, 0.15); color: var(--color-warning);',
        'urgent': 'background: rgba(239, 68, 68, 0.15); color: var(--color-error);'
    };
    const style = colorMap[priority] || 'background: var(--bg-tertiary); color: var(--text-secondary);';
    const label = priority.replace(/\b\w/g, c => c.toUpperCase());
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

// Cached client list (id → display name) populated from /procurement/clients (gRPC bridge to Accounts).
let _inquiryClientCache = [];

async function loadClientsForInquiryDropdown() {
    const select = document.getElementById('inquiryClient');
    if (!select) return;
    try {
        const data = await api.request('/procurement/clients');
        const clients = Array.isArray(data) ? data : (data?.data || []);
        _inquiryClientCache = clients;

        // Build the option list as plain { value, label } pairs first — works
        // both for native <select> and for the SearchableDropdown setOptions API.
        const placeholder = clients.length === 0
            ? 'No clients yet — add one in Accounts → Customers'
            : 'Select a client...';
        const optionList = [{ value: '', label: placeholder }].concat(
            clients.map(c => {
                const name = c.customer_name || c.display_name || c.name || '(unnamed)';
                const code = c.customer_code ? c.customer_code.trim() : '';
                // Always show name + code so two clients with the same display
                // name remain distinguishable. Code is bracketed for visual scan.
                const label = code ? `${name}  ·  [${code}]` : `${name}  ·  [no code]`;
                return { value: c.id, label };
            })
        );

        // Always rewrite the underlying <select>'s options. If a SearchableDropdown
        // wraps it, prefer calling setOptions() directly (handles edge cases the
        // MutationObserver inside searchable-dropdown.js may miss when options
        // change while the wrapper is collapsed).
        select.innerHTML = optionList
            .map(o => `<option value="${o.value}">${escapeHtml(o.label)}</option>`)
            .join('');
        if (select._searchableDropdown && typeof select._searchableDropdown.setOptions === 'function') {
            select._searchableDropdown.setOptions(optionList, true);
        }
    } catch (err) {
        console.error('Failed to load clients:', err);
        select.innerHTML = '<option value="">Failed to load clients (Accounts unreachable?)</option>';
    }
}

function openNewInquiryModal() {
    document.getElementById('inquiryModalTitle').textContent = 'New Inquiry';
    document.getElementById('inquiryForm').reset();
    document.getElementById('inquiryPriority').value = 'medium';
    loadClientsForInquiryDropdown();
    openModal('inquiryModal');
}

function closeInquiryModal() {
    closeModal('inquiryModal');
}

// ==================== CRUD Operations ====================

async function handleInquirySubmit(event) {
    event.preventDefault();

    const submitBtn = document.getElementById('inquirySubmitBtn');
    const spinner = document.getElementById('inquirySubmitSpinner');
    submitBtn.disabled = true;
    if (spinner) spinner.style.display = 'inline-block';

    // Client comes from a dropdown sourced via gRPC from Accounts — see loadClientsForInquiryDropdown().
    // Save both the FK id and the display name so list/detail rendering stays cheap.
    const clientSelect = document.getElementById('inquiryClient');
    const clientId = clientSelect ? clientSelect.value : '';
    const clientLabel = clientId
        ? (_inquiryClientCache.find(c => c.id === clientId)?.customer_name
            || _inquiryClientCache.find(c => c.id === clientId)?.display_name
            || _inquiryClientCache.find(c => c.id === clientId)?.name
            || '')
        : '';

    const formData = {
        title: document.getElementById('inquiryTitle').value.trim(),
        description: document.getElementById('inquiryDescription').value.trim(),
        client_id: clientId || null,
        client_name: clientLabel || null,
        project_name: document.getElementById('inquiryProjectName').value.trim(),
        priority: document.getElementById('inquiryPriority').value,
        due_date: document.getElementById('inquiryDueDate').value || null
    };

    try {
        const response = await api.request('/procurement/inquiries', {
            method: 'POST',
            body: JSON.stringify(formData)
        });
        Toast.success('Inquiry created successfully');
        closeInquiryModal();

        // Redirect to inquiry detail page
        const newId = response?.id || response?.data?.id;
        if (newId) {
            window.location.href = `inquiry-detail.html?id=${newId}`;
        } else {
            loadInquiries();
        }
    } catch (error) {
        console.error('Failed to create inquiry:', error);
        Toast.error(error.message || 'Failed to create inquiry');
    } finally {
        if (submitBtn) submitBtn.disabled = false;
        if (spinner) spinner.style.display = 'none';
    }
}

// ==================== Utilities ====================

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

// ==================== Pagination ====================

function inqGoToPage(page) {
    const totalPages = Math.ceil(_inqFiltered.length / INQ_PAGE_SIZE);
    if (page < 1 || page > totalPages) return;
    _inqCurrentPage = page;
    renderInquiriesTable(_inqFiltered);
    const table = document.getElementById('inquiriesTableBody')?.closest('table');
    if (table) table.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function inqRenderPagination(totalItems, totalPages) {
    let container = document.getElementById('inquiriesPagination');
    if (!container) {
        container = document.createElement('div');
        container.id = 'inquiriesPagination';
        const table = document.getElementById('inquiriesTableBody')?.closest('table');
        if (table) table.parentNode.insertBefore(container, table.nextSibling);
    }
    if (totalPages <= 1) {
        container.innerHTML = totalItems > 0
            ? `<div style="padding:10px 0; text-align:center; font-size:12px; color:var(--text-secondary);">${totalItems} record${totalItems !== 1 ? 's' : ''}</div>`
            : '';
        return;
    }
    const startItem = (_inqCurrentPage - 1) * INQ_PAGE_SIZE + 1;
    const endItem = Math.min(_inqCurrentPage * INQ_PAGE_SIZE, totalItems);
    let pages = [];
    if (totalPages <= 7) { for (let i = 1; i <= totalPages; i++) pages.push(i); }
    else {
        pages.push(1);
        if (_inqCurrentPage > 3) pages.push('...');
        const start = Math.max(2, _inqCurrentPage - 1);
        const end = Math.min(totalPages - 1, _inqCurrentPage + 1);
        for (let i = start; i <= end; i++) pages.push(i);
        if (_inqCurrentPage < totalPages - 2) pages.push('...');
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
                <button onclick="inqGoToPage(${_inqCurrentPage - 1})" style="${_inqCurrentPage === 1 ? disabledNavStyle : navStyle}" ${_inqCurrentPage === 1 ? 'disabled' : ''}>&lsaquo; Prev</button>
                ${pages.map(p => p === '...' ? '<span style="padding:4px 4px; font-size:13px; color:var(--text-secondary);">…</span>' : `<button onclick="inqGoToPage(${p})" style="${p === _inqCurrentPage ? activeBtnStyle : btnStyle}">${p}</button>`).join('')}
                <button onclick="inqGoToPage(${_inqCurrentPage + 1})" style="${_inqCurrentPage === totalPages ? disabledNavStyle : navStyle}" ${_inqCurrentPage === totalPages ? 'disabled' : ''}>Next &rsaquo;</button>
            </div>
        </div>`;
}
