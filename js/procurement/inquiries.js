/**
 * Procurement Inquiries Management
 * Handles listing, filtering, and creation of inquiries.
 */

// ==================== State ====================
let allInquiries = [];

// ==================== Initialization ====================

document.addEventListener('DOMContentLoaded', () => {
    Navigation.init('procurement', '../');

    if (!api.isAuthenticated()) {
        window.location.href = '../login.html';
        return;
    }

    loadInquiries();
});

// ==================== Data Loading ====================

async function loadInquiries() {
    try {
        const response = await api.request('/procurement/inquiries');
        allInquiries = response.data || response || [];
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
        return;
    }

    tbody.innerHTML = inquiries.map(inq => `
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

function openNewInquiryModal() {
    document.getElementById('inquiryModalTitle').textContent = 'New Inquiry';
    document.getElementById('inquiryForm').reset();
    document.getElementById('inquiryPriority').value = 'medium';
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

    const formData = {
        title: document.getElementById('inquiryTitle').value.trim(),
        description: document.getElementById('inquiryDescription').value.trim(),
        client_name: document.getElementById('inquiryClientName').value.trim(),
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
