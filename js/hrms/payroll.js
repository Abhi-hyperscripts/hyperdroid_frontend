let currentUser = null;
let isAdmin = false;
let employees = [];
let offices = [];
let components = [];
let structures = [];
let currentPayslipId = null;
let drafts = [];

// Modal utility functions
function openModal(id) {
    document.getElementById(id).classList.add('active');
}

function closeModal(id) {
    document.getElementById(id).classList.remove('active');
}

// Modal should only be closed via the close button, not by clicking on backdrop

document.addEventListener('DOMContentLoaded', async function() {
    await loadNavigation();
    await initializePage();
});

async function initializePage() {
    try {
        showLoading();
        if (!api.isAuthenticated()) {
            window.location.href = '../login.html';
            return;
        }
        currentUser = api.getUser();

        if (!currentUser) {
            window.location.href = '../login.html';
            return;
        }

        isAdmin = currentUser.roles?.includes('HRMS_ADMIN') || currentUser.roles?.includes('SUPERADMIN');

        // Show/hide admin elements
        if (isAdmin) {
            document.getElementById('adminActions').style.display = 'flex';
            document.getElementById('payrollDraftsTab').style.display = 'block';
            document.getElementById('payrollRunsTab').style.display = 'block';
            document.getElementById('salaryTab').style.display = 'block';
            document.getElementById('componentsTab').style.display = 'block';
            document.getElementById('createStructureBtn').style.display = 'inline-flex';
            document.getElementById('createComponentBtn').style.display = 'inline-flex';
            document.getElementById('loanEmployeeRow').style.display = 'block';
        } else {
            document.getElementById('loanEmployeeRow').style.display = 'none';
        }

        // Setup tabs
        setupTabs();

        // Load initial data
        await Promise.all([
            loadMyPayslips(),
            loadOffices()
        ]);

        if (isAdmin) {
            await Promise.all([
                loadPayrollDrafts(),
                loadPayrollRuns(),
                loadComponents(),
                loadSalaryStructures(),
                loadEmployees()
            ]);
        }

        await loadLoans();

        // Set default dates for payroll run
        setDefaultPayrollDates();

        hideLoading();
    } catch (error) {
        console.error('Error initializing page:', error);
        showToast('Failed to load page data', 'error');
        hideLoading();
    }
}

function setupTabs() {
    const tabBtns = document.querySelectorAll('.tab-btn');
    tabBtns.forEach(btn => {
        btn.addEventListener('click', function() {
            const tabId = this.dataset.tab;

            // Update active states
            tabBtns.forEach(b => b.classList.remove('active'));
            this.classList.add('active');

            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            document.getElementById(tabId).classList.add('active');
        });
    });
}

function setDefaultPayrollDates() {
    // This function was used for the old Run Payroll modal which has been removed.
    // Now payroll is processed through drafts. Keeping function for compatibility.
    // Set draft filter defaults if elements exist
    const draftYear = document.getElementById('draftFilterYear');
    const draftMonth = document.getElementById('draftFilterMonth');

    if (draftYear) {
        draftYear.value = new Date().getFullYear();
    }
    if (draftMonth) {
        draftMonth.value = ''; // All months by default
    }
}

async function loadMyPayslips() {
    try {
        const year = document.getElementById('payslipYear').value;
        const response = await api.request(`/hrms/payroll-processing/my-payslips?year=${year}`);
        const payslips = response || [];

        // Update stats
        if (payslips.length > 0) {
            const lastPayslip = payslips[0];
            document.getElementById('lastGross').textContent = formatCurrency(lastPayslip.grossSalary);
            document.getElementById('lastDeductions').textContent = formatCurrency(lastPayslip.totalDeductions);
            document.getElementById('lastNet').textContent = formatCurrency(lastPayslip.netSalary);

            const ytd = payslips.reduce((sum, p) => sum + (p.netSalary || 0), 0);
            document.getElementById('ytdEarnings').textContent = formatCurrency(ytd);
        }

        updateMyPayslipsTable(payslips);
    } catch (error) {
        // If user has no employee profile (e.g., admin users), just show empty state
        if (error.message?.includes('Employee profile not found') || error.message?.includes('not found')) {
            console.log('User has no employee profile - showing empty payslips');
            updateMyPayslipsTable([]);
        } else {
            console.error('Error loading payslips:', error);
        }
    }
}

function updateMyPayslipsTable(payslips) {
    const tbody = document.getElementById('myPayslipsTable');

    if (!payslips || payslips.length === 0) {
        tbody.innerHTML = `
            <tr class="empty-state">
                <td colspan="7">
                    <div class="empty-message">
                        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">
                            <rect x="1" y="4" width="22" height="16" rx="2" ry="2"></rect>
                            <line x1="1" y1="10" x2="23" y2="10"></line>
                        </svg>
                        <p>No payslips found</p>
                    </div>
                </td>
            </tr>`;
        return;
    }

    tbody.innerHTML = payslips.map(slip => `
        <tr>
            <td><strong>${getMonthName(slip.month)} ${slip.year}</strong></td>
            <td>${formatDate(slip.periodStart)} - ${formatDate(slip.periodEnd)}</td>
            <td>${formatCurrency(slip.grossSalary)}</td>
            <td>${formatCurrency(slip.totalDeductions)}</td>
            <td><strong>${formatCurrency(slip.netSalary)}</strong></td>
            <td><span class="status-badge status-${slip.status?.toLowerCase()}">${slip.status}</span></td>
            <td>
                <div class="action-buttons">
                    <button class="action-btn" onclick="viewPayslip('${slip.id}')" title="View Payslip">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                            <circle cx="12" cy="12" r="3"></circle>
                        </svg>
                    </button>
                    <button class="action-btn" onclick="downloadPayslipById('${slip.id}')" title="Download">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                            <polyline points="7 10 12 15 17 10"></polyline>
                            <line x1="12" y1="15" x2="12" y2="3"></line>
                        </svg>
                    </button>
                </div>
            </td>
        </tr>
    `).join('');
}

async function loadPayrollRuns() {
    try {
        const year = document.getElementById('runYear').value;
        const month = document.getElementById('runMonth').value;
        const officeId = document.getElementById('runOffice').value;

        let url = `/hrms/payroll-processing/runs?year=${year}`;
        if (month) url += `&month=${month}`;
        if (officeId) url += `&officeId=${officeId}`;

        const response = await api.request(url);
        updatePayrollRunsTable(response || []);
    } catch (error) {
        console.error('Error loading payroll runs:', error);
    }
}

// =====================================================
// PAYROLL DRAFTS FUNCTIONS
// =====================================================

async function loadPayrollDrafts() {
    try {
        const year = document.getElementById('draftYear')?.value || new Date().getFullYear();
        const month = document.getElementById('draftMonth')?.value || '';
        const officeId = document.getElementById('draftOffice')?.value || '';

        let url = `/hrms/payroll-drafts?year=${year}`;
        if (month) url += `&month=${month}`;
        if (officeId) url += `&officeId=${officeId}`;

        const response = await api.request(url);
        drafts = response || [];
        updatePayrollDraftsTable(drafts);
    } catch (error) {
        console.error('Error loading payroll drafts:', error);
    }
}

function updatePayrollDraftsTable(draftsList) {
    const tbody = document.getElementById('payrollDraftsTable');
    if (!tbody) return;

    if (!draftsList || draftsList.length === 0) {
        tbody.innerHTML = `
            <tr class="empty-state">
                <td colspan="9">
                    <div class="empty-message">
                        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">
                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                            <polyline points="14 2 14 8 20 8"></polyline>
                            <line x1="16" y1="13" x2="8" y2="13"></line>
                            <line x1="16" y1="17" x2="8" y2="17"></line>
                        </svg>
                        <p>No payroll drafts found</p>
                        <p class="hint">Create a new draft to start payroll processing</p>
                    </div>
                </td>
            </tr>`;
        return;
    }

    tbody.innerHTML = draftsList.map(draft => `
        <tr>
            <td><strong>${draft.draft_name || 'Draft'}</strong> #${draft.draft_number || 1}</td>
            <td>${getMonthName(draft.payroll_month)} ${draft.payroll_year}</td>
            <td>${draft.office_name || 'All Offices'}</td>
            <td>${draft.total_employees || 0}</td>
            <td>${formatCurrency(draft.total_gross)}</td>
            <td>${formatCurrency(draft.total_net)}</td>
            <td><span class="status-badge status-${draft.status?.toLowerCase()}">${formatDraftStatus(draft.status)}</span></td>
            <td>${formatDate(draft.created_at)}</td>
            <td>
                <div class="action-buttons">
                    ${draft.status === 'pending' ? `
                    <button class="action-btn success" onclick="processDraft('${draft.id}')" title="Process Draft">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polygon points="5 3 19 12 5 21 5 3"></polygon>
                        </svg>
                    </button>
                    ` : ''}
                    ${draft.status === 'processed' ? `
                    <button class="action-btn" onclick="viewDraftDetails('${draft.id}')" title="View Details">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                            <circle cx="12" cy="12" r="3"></circle>
                        </svg>
                    </button>
                    <button class="action-btn warning" onclick="recalculateDraft('${draft.id}')" title="Recalculate">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="23 4 23 10 17 10"></polyline>
                            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path>
                        </svg>
                    </button>
                    <button class="action-btn success" onclick="finalizeDraft('${draft.id}')" title="Finalize Draft">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="20 6 9 17 4 12"></polyline>
                        </svg>
                    </button>
                    ` : ''}
                    <button class="action-btn" onclick="renameDraft('${draft.id}', '${draft.draft_name || 'Draft'}')" title="Rename">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                        </svg>
                    </button>
                    <button class="action-btn danger" onclick="deleteDraft('${draft.id}')" title="Delete">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="3 6 5 6 21 6"></polyline>
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                        </svg>
                    </button>
                </div>
            </td>
        </tr>
    `).join('');
}

function formatDraftStatus(status) {
    const statusMap = {
        'pending': 'Not Processed',
        'processing': 'Processing...',
        'processed': 'Ready to Finalize'
    };
    return statusMap[status] || status;
}

async function createPayrollDraft() {
    const form = document.getElementById('createDraftForm');
    if (!form.checkValidity()) {
        form.reportValidity();
        return;
    }

    try {
        showLoading();
        const officeId = document.getElementById('draftPayrollOffice').value;
        const data = {
            payroll_month: parseInt(document.getElementById('draftPayrollMonth').value),
            payroll_year: parseInt(document.getElementById('draftPayrollYear').value),
            office_id: officeId ? officeId : null,
            draft_name: document.getElementById('draftName').value || 'Draft',
            pay_period_start: document.getElementById('draftPeriodStart').value,
            pay_period_end: document.getElementById('draftPeriodEnd').value,
            notes: document.getElementById('draftNotes')?.value || ''
        };

        const draft = await api.request('/hrms/payroll-drafts', {
            method: 'POST',
            body: JSON.stringify(data)
        });

        closeModal('createDraftModal');
        showToast('Draft created successfully', 'success');
        await loadPayrollDrafts();
        hideLoading();
    } catch (error) {
        console.error('Error creating draft:', error);
        showToast(error.message || error.error || 'Failed to create draft', 'error');
        hideLoading();
    }
}

async function processDraft(draftId) {
    if (!confirm('Process this draft? This will generate payslips for all eligible employees.')) {
        return;
    }

    try {
        showLoading();
        const result = await api.request(`/hrms/payroll-drafts/${draftId}/process`, {
            method: 'POST'
        });

        let message = `Draft processed! ${result.payslips_generated || 0} payslips generated`;
        if (result.errors && result.errors.length > 0) {
            message += ` (${result.errors.length} errors)`;
        }
        showToast(message, result.errors?.length > 0 ? 'warning' : 'success');
        await loadPayrollDrafts();
        hideLoading();

        // Show details after processing
        if (result.draft_id) {
            await viewDraftDetails(result.draft_id);
        }
    } catch (error) {
        console.error('Error processing draft:', error);
        showToast(error.message || error.error || 'Failed to process draft', 'error');
        hideLoading();
    }
}

async function recalculateDraft(draftId) {
    if (!confirm('Recalculate this draft? This will regenerate all payslips with current data.')) {
        return;
    }

    try {
        showLoading();
        const result = await api.request(`/hrms/payroll-drafts/${draftId}/recalculate`, {
            method: 'POST'
        });

        showToast(`Draft recalculated! ${result.payslips_generated || 0} payslips regenerated`, 'success');
        await loadPayrollDrafts();
        hideLoading();

        if (result.draft_id) {
            await viewDraftDetails(result.draft_id);
        }
    } catch (error) {
        console.error('Error recalculating draft:', error);
        showToast(error.message || error.error || 'Failed to recalculate draft', 'error');
        hideLoading();
    }
}

async function viewDraftDetails(draftId) {
    try {
        showLoading();
        const details = await api.request(`/hrms/payroll-drafts/${draftId}/details`);

        // Populate modal with draft details
        const modal = document.getElementById('draftDetailsModal');
        if (!modal) {
            console.error('Draft details modal not found');
            hideLoading();
            return;
        }

        const draft = details.draft;
        const payslips = details.payslips || [];
        const summary = details.summary || {};

        document.getElementById('draftDetailTitle').textContent = `${draft.draft_name} - ${getMonthName(draft.payroll_month)} ${draft.payroll_year}`;

        // Update summary cards
        document.getElementById('draftTotalEmployees').textContent = summary.total_employees || 0;
        document.getElementById('draftTotalGross').textContent = formatCurrency(summary.total_gross || 0);
        document.getElementById('draftTotalDeductions').textContent = formatCurrency(summary.total_deductions || 0);
        document.getElementById('draftTotalNet').textContent = formatCurrency(summary.total_net || 0);

        // Update payslips table
        const tbody = document.getElementById('draftPayslipsTable');
        if (payslips.length === 0) {
            tbody.innerHTML = '<tr><td colspan="7" class="text-center">No payslips generated yet</td></tr>';
        } else {
            tbody.innerHTML = payslips.map(p => `
                <tr class="draft-payslip-row"
                    data-code="${(p.employee_code || '').toLowerCase()}"
                    data-name="${(p.employee_name || '').toLowerCase()}"
                    data-dept="${(p.department_name || '').toLowerCase()}">
                    <td><code>${p.employee_code || '-'}</code></td>
                    <td>${p.employee_name || 'Unknown'}</td>
                    <td>${p.department_name || '-'}</td>
                    <td>${formatCurrency(p.gross_earnings)}</td>
                    <td>${formatCurrency(p.total_deductions)}</td>
                    <td><strong>${formatCurrency(p.net_pay)}</strong></td>
                    <td>
                        <button class="action-btn" onclick="viewDraftPayslip('${p.id}')" title="View Details">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                                <circle cx="12" cy="12" r="3"></circle>
                            </svg>
                        </button>
                    </td>
                </tr>
            `).join('');
        }

        // Store payslips data for export
        window.currentDraftPayslips = payslips;

        // Clear search input
        const searchInput = document.getElementById('draftPayslipSearch');
        if (searchInput) searchInput.value = '';

        // Store current draft ID for finalization
        modal.dataset.draftId = draftId;

        openModal('draftDetailsModal');
        hideLoading();
    } catch (error) {
        console.error('Error loading draft details:', error);
        showToast(error.message || 'Failed to load draft details', 'error');
        hideLoading();
    }
}

async function viewDraftPayslip(payslipId) {
    try {
        showLoading();
        const payslip = await api.request(`/hrms/payroll-drafts/payslips/${payslipId}?includeItems=true`);

        // Populate payslipContent dynamically
        const contentDiv = document.getElementById('payslipContent');
        if (!contentDiv) {
            hideLoading();
            showToast('Payslip modal not found', 'error');
            return;
        }

        const items = payslip.items || [];

        // Group items by structure for compliance display
        const structureGroups = groupItemsByStructure(items);
        const hasMultipleStructures = structureGroups.length > 1;

        // Build structure-wise breakdown HTML
        let structureBreakdownHtml = '';

        if (hasMultipleStructures) {
            structureBreakdownHtml = `
                <div style="margin-bottom: 1.5rem; padding: 0.75rem; background: #fff3cd; border: 1px solid #ffc107; border-radius: 8px;">
                    <strong style="color: #856404;">Mid-Period Structure Change</strong>
                    <p style="margin: 0.5rem 0 0 0; font-size: 0.85rem; color: #856404;">
                        This employee had a salary structure change during the pay period.
                        Components are shown separately for each structure for compliance purposes.
                    </p>
                </div>
            `;

            for (const group of structureGroups) {
                const periodText = group.period_start && group.period_end
                    ? `${formatDate(group.period_start)} - ${formatDate(group.period_end)}`
                    : '';

                const groupEarnings = group.items.filter(i => i.component_type === 'earning');
                const groupDeductions = group.items.filter(i => i.component_type === 'deduction');

                const groupEarningsTotal = groupEarnings.reduce((sum, i) => sum + (i.amount || 0), 0);
                const groupDeductionsTotal = groupDeductions.reduce((sum, i) => sum + (i.amount || 0), 0);

                structureBreakdownHtml += `
                    <div style="margin-bottom: 1.5rem; padding: 1rem; border: 1px solid var(--border-color); border-radius: 8px; background: var(--bg-subtle);">
                        <div style="margin-bottom: 1rem; padding-bottom: 0.5rem; border-bottom: 1px solid var(--border-color);">
                            <h5 style="margin: 0; color: var(--primary-color);">${group.structure_name || 'Salary Structure'}</h5>
                            ${periodText ? `<p style="margin: 0.25rem 0 0 0; font-size: 0.8rem; color: var(--text-muted);">Period: ${periodText}</p>` : ''}
                        </div>

                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;">
                            <div>
                                <h6 style="margin: 0 0 0.5rem 0; font-size: 0.85rem; color: var(--success-color);">Earnings</h6>
                                <table class="data-table" style="width: 100%; font-size: 0.85rem;">
                                    <tbody>
                                        ${groupEarnings.length > 0
                                            ? groupEarnings.map(i => `
                                                <tr>
                                                    <td>${i.component_name}${i.is_prorated ? ' <span style="font-size:0.7rem;color:var(--text-muted);">(prorated)</span>' : ''}</td>
                                                    <td class="text-right">${formatCurrency(i.amount)}</td>
                                                </tr>
                                            `).join('')
                                            : '<tr><td colspan="2" class="text-muted">No earnings</td></tr>'
                                        }
                                    </tbody>
                                    <tfoot>
                                        <tr style="font-weight: 600; border-top: 1px solid var(--border-color);">
                                            <td>Subtotal</td>
                                            <td class="text-right">${formatCurrency(groupEarningsTotal)}</td>
                                        </tr>
                                    </tfoot>
                                </table>
                            </div>
                            <div>
                                <h6 style="margin: 0 0 0.5rem 0; font-size: 0.85rem; color: var(--danger-color);">Deductions</h6>
                                <table class="data-table" style="width: 100%; font-size: 0.85rem;">
                                    <tbody>
                                        ${groupDeductions.length > 0
                                            ? groupDeductions.map(i => `
                                                <tr>
                                                    <td>${i.component_name}${i.is_prorated ? ' <span style="font-size:0.7rem;color:var(--text-muted);">(prorated)</span>' : ''}</td>
                                                    <td class="text-right">${formatCurrency(i.amount)}</td>
                                                </tr>
                                            `).join('')
                                            : '<tr><td colspan="2" class="text-muted">No deductions</td></tr>'
                                        }
                                    </tbody>
                                    <tfoot>
                                        <tr style="font-weight: 600; border-top: 1px solid var(--border-color);">
                                            <td>Subtotal</td>
                                            <td class="text-right">${formatCurrency(groupDeductionsTotal)}</td>
                                        </tr>
                                    </tfoot>
                                </table>
                            </div>
                        </div>
                    </div>
                `;
            }

            // Add combined totals section for multi-structure
            structureBreakdownHtml += `
                <div style="margin-top: 1rem; padding: 1rem; background: var(--bg-secondary); border-radius: 8px; border: 2px solid var(--border-color);">
                    <h5 style="margin: 0 0 1rem 0;">Combined Totals</h5>
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;">
                        <div>
                            <div style="display: flex; justify-content: space-between; padding: 0.5rem 0; border-bottom: 1px solid var(--border-color);">
                                <span>Total Gross Earnings</span>
                                <span style="font-weight: 600; color: var(--success-color);">${formatCurrency(payslip.gross_earnings)}</span>
                            </div>
                        </div>
                        <div>
                            <div style="display: flex; justify-content: space-between; padding: 0.5rem 0; border-bottom: 1px solid var(--border-color);">
                                <span>Total Deductions</span>
                                <span style="font-weight: 600; color: var(--danger-color);">${formatCurrency(payslip.total_deductions)}</span>
                            </div>
                            ${payslip.loan_deductions > 0 ? `
                            <div style="display: flex; justify-content: space-between; padding: 0.5rem 0; border-bottom: 1px solid var(--border-color);">
                                <span>Loan Deductions</span>
                                <span style="font-weight: 600; color: var(--danger-color);">${formatCurrency(payslip.loan_deductions)}</span>
                            </div>
                            ` : ''}
                            <div style="display: flex; justify-content: space-between; padding: 0.75rem 0; margin-top: 0.5rem; background: var(--bg-tertiary); border-radius: 4px; padding-left: 0.5rem; padding-right: 0.5rem;">
                                <span style="font-weight: 700;">Net Pay</span>
                                <span style="font-weight: 700; color: var(--primary-color); font-size: 1.1rem;">${formatCurrency(payslip.net_pay)}</span>
                            </div>
                        </div>
                    </div>
                </div>
            `;
        } else {
            // Single structure - use original layout
            const earnings = items.filter(i => i.component_type === 'earning');
            const deductions = items.filter(i => i.component_type === 'deduction');

            const earningsHtml = earnings.length > 0 ?
                earnings.map(i => `<tr><td>${i.component_name}${i.is_prorated ? ' <span style="font-size:0.75rem;color:var(--text-muted);">(prorated)</span>' : ''}</td><td class="text-right">${formatCurrency(i.amount)}</td></tr>`).join('') :
                '<tr><td colspan="2" class="text-muted">No earnings</td></tr>';

            const deductionsHtml = deductions.length > 0 ?
                deductions.map(i => `<tr><td>${i.component_name}${i.is_prorated ? ' <span style="font-size:0.75rem;color:var(--text-muted);">(prorated)</span>' : ''}</td><td class="text-right">${formatCurrency(i.amount)}</td></tr>`).join('') :
                '<tr><td colspan="2" class="text-muted">No deductions</td></tr>';

            structureBreakdownHtml = `
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1.5rem;">
                    <div>
                        <h5 style="margin: 0 0 0.75rem 0; color: var(--success-color);">Earnings</h5>
                        <table class="data-table" style="width: 100%;">
                            <tbody>${earningsHtml}</tbody>
                            <tfoot>
                                <tr style="font-weight: 600; border-top: 2px solid var(--border-color);">
                                    <td>Total Gross</td>
                                    <td class="text-right">${formatCurrency(payslip.gross_earnings)}</td>
                                </tr>
                            </tfoot>
                        </table>
                    </div>
                    <div>
                        <h5 style="margin: 0 0 0.75rem 0; color: var(--danger-color);">Deductions</h5>
                        <table class="data-table" style="width: 100%;">
                            <tbody>
                                ${deductionsHtml}
                                ${payslip.loan_deductions > 0 ? `<tr><td>Loan EMI</td><td class="text-right">${formatCurrency(payslip.loan_deductions)}</td></tr>` : ''}
                            </tbody>
                            <tfoot>
                                <tr style="font-weight: 600; border-top: 2px solid var(--border-color);">
                                    <td>Total Deductions</td>
                                    <td class="text-right">${formatCurrency(payslip.total_deductions + (payslip.loan_deductions || 0))}</td>
                                </tr>
                            </tfoot>
                        </table>
                    </div>
                </div>
            `;
        }

        contentDiv.innerHTML = `
            <div class="payslip-header" style="margin-bottom: 0.75rem; padding-bottom: 0.5rem; border-bottom: 1px solid var(--border-color); display: flex; justify-content: space-between; align-items: center;">
                <div>
                    <h4 style="margin: 0 0 0.25rem 0; font-size: 1rem;">${payslip.employee_name || 'Employee'}</h4>
                    <p style="margin: 0; color: var(--text-muted); font-size: 0.75rem;">Draft Payslip - ${formatDate(payslip.pay_period_start)} to ${formatDate(payslip.pay_period_end)}</p>
                </div>
                <div style="padding: 0.5rem 1rem; background: var(--primary-color); color: white; border-radius: 6px; text-align: right;">
                    <div style="font-size: 0.65rem; opacity: 0.9;">Net Pay</div>
                    <div style="font-size: 1.1rem; font-weight: 700;">${formatCurrency(payslip.net_pay)}</div>
                </div>
            </div>

            <div class="payslip-summary" style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.5rem; margin-bottom: 0.75rem;">
                <div class="summary-item" style="padding: 0.5rem; background: var(--bg-subtle); border-radius: 6px;">
                    <div style="font-size: 0.65rem; color: var(--text-muted);">Working Days</div>
                    <div style="font-size: 1rem; font-weight: 600;">${payslip.total_working_days || 0}</div>
                </div>
                <div class="summary-item" style="padding: 0.5rem; background: var(--bg-subtle); border-radius: 6px;">
                    <div style="font-size: 0.65rem; color: var(--text-muted);">Days Worked</div>
                    <div style="font-size: 1rem; font-weight: 600;">${payslip.days_worked || 0}</div>
                </div>
                <div class="summary-item" style="padding: 0.5rem; background: var(--bg-subtle); border-radius: 6px;">
                    <div style="font-size: 0.65rem; color: var(--text-muted);">LOP Days</div>
                    <div style="font-size: 1rem; font-weight: 600;">${payslip.lop_days || 0}</div>
                </div>
            </div>

            ${structureBreakdownHtml}
        `;

        openModal('payslipModal');
        hideLoading();
    } catch (error) {
        console.error('Error loading draft payslip:', error);
        showToast('Failed to load payslip details', 'error');
        hideLoading();
    }
}

// Helper function to group payslip items by structure
function groupItemsByStructure(items) {
    const groups = [];
    const groupMap = new Map();

    for (const item of items) {
        // Group by period dates (not structure_id) to handle same structure with different salaries
        // This is critical for mid-period appraisals where structure stays same but CTC changes
        const periodKey = `${item.period_start || 'none'}_${item.period_end || 'none'}`;

        if (!groupMap.has(periodKey)) {
            const group = {
                structure_id: item.structure_id,
                structure_name: item.structure_name || 'Standard',
                period_start: item.period_start,
                period_end: item.period_end,
                items: []
            };
            groupMap.set(periodKey, group);
            groups.push(group);
        }

        groupMap.get(periodKey).items.push(item);
    }

    // Sort groups by period_start date
    groups.sort((a, b) => {
        if (!a.period_start) return -1;
        if (!b.period_start) return 1;
        return new Date(a.period_start) - new Date(b.period_start);
    });

    return groups;
}

async function finalizeDraft(draftId) {
    const confirmed = confirm('Finalize this draft?\n\nThis will:\n• Move this draft to finalized payroll runs\n• Delete ALL other drafts for this period\n\nThis action cannot be undone.');
    if (!confirmed) return;

    try {
        showLoading();
        const result = await api.request(`/hrms/payroll-drafts/${draftId}/finalize`, {
            method: 'POST'
        });

        if (result.success) {
            showToast(`Payroll finalized successfully! ${result.drafts_deleted || 0} draft(s) cleaned up.`, 'success');
            closeModal('draftDetailsModal');
            await loadPayrollDrafts();
            await loadPayrollRuns();
        } else {
            showToast(result.message || 'Failed to finalize draft', 'error');
        }
        hideLoading();
    } catch (error) {
        console.error('Error finalizing draft:', error);
        showToast(error.message || error.error || 'Failed to finalize draft', 'error');
        hideLoading();
    }
}

async function deleteDraft(draftId) {
    if (!confirm('Delete this draft? This action cannot be undone.')) {
        return;
    }

    try {
        showLoading();
        await api.request(`/hrms/payroll-drafts/${draftId}`, {
            method: 'DELETE'
        });

        showToast('Draft deleted successfully', 'success');
        await loadPayrollDrafts();
        hideLoading();
    } catch (error) {
        console.error('Error deleting draft:', error);
        showToast(error.message || error.error || 'Failed to delete draft', 'error');
        hideLoading();
    }
}

async function renameDraft(draftId, currentName) {
    const newName = prompt('Enter new draft name:', currentName);
    if (!newName || newName === currentName) return;

    try {
        showLoading();
        await api.request(`/hrms/payroll-drafts/${draftId}/rename`, {
            method: 'PUT',
            body: JSON.stringify({ draft_name: newName })
        });

        showToast('Draft renamed successfully', 'success');
        await loadPayrollDrafts();
        hideLoading();
    } catch (error) {
        console.error('Error renaming draft:', error);
        showToast(error.message || error.error || 'Failed to rename draft', 'error');
        hideLoading();
    }
}

function openCreateDraftModal() {
    // Reset form
    const form = document.getElementById('createDraftForm');
    if (form) form.reset();

    // Set default values
    const now = new Date();
    const currentMonth = now.getMonth() + 1;
    const currentYear = now.getFullYear();

    document.getElementById('draftPayrollMonth').value = currentMonth;
    document.getElementById('draftPayrollYear').value = currentYear;
    document.getElementById('draftName').value = 'Draft';

    // Set period start to 1st of month
    const periodStart = new Date(currentYear, currentMonth - 1, 1);
    document.getElementById('draftPeriodStart').value = periodStart.toISOString().split('T')[0];

    // Set period end to last day of month
    const periodEnd = new Date(currentYear, currentMonth, 0);
    document.getElementById('draftPeriodEnd').value = periodEnd.toISOString().split('T')[0];

    openModal('createDraftModal');
}

// =====================================================
// END PAYROLL DRAFTS FUNCTIONS
// =====================================================

function updatePayrollRunsTable(runs) {
    const tbody = document.getElementById('payrollRunsTable');

    if (!runs || runs.length === 0) {
        tbody.innerHTML = `
            <tr class="empty-state">
                <td colspan="8">
                    <div class="empty-message">
                        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">
                            <circle cx="12" cy="12" r="10"></circle>
                            <polyline points="12 6 12 12 16 14"></polyline>
                        </svg>
                        <p>No payroll runs found</p>
                    </div>
                </td>
            </tr>`;
        return;
    }

    tbody.innerHTML = runs.map(run => `
        <tr>
            <td><code>${run.run_number || run.id.substring(0, 8)}</code></td>
            <td>${getMonthName(run.payroll_month)} ${run.payroll_year}</td>
            <td>${run.office_name || 'All Offices'}</td>
            <td>${run.total_employees || 0}</td>
            <td>${formatCurrency(run.total_gross)}</td>
            <td>${formatCurrency(run.total_net)}</td>
            <td><span class="status-badge status-${run.status?.toLowerCase()}">${run.status}</span></td>
            <td>
                <div class="action-buttons">
                    <button class="action-btn" onclick="viewPayrollRun('${run.id}')" title="View Details">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                            <circle cx="12" cy="12" r="3"></circle>
                        </svg>
                    </button>
                    ${run.status === 'draft' ? `
                    <button class="action-btn success" onclick="processPayrollRun('${run.id}')" title="Process">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="20 6 9 17 4 12"></polyline>
                        </svg>
                    </button>
                    ` : ''}
                </div>
            </td>
        </tr>
    `).join('');
}

async function loadSalaryStructures() {
    try {
        const officeFilter = document.getElementById('structureOfficeFilter')?.value || '';
        let url = '/hrms/payroll/structures';
        if (officeFilter) {
            url = `/hrms/payroll/structures/office/${officeFilter}`;
        }

        const response = await api.request(url);
        structures = response || [];
        updateSalaryStructuresTable();

        // Also load setup status to display office structure status
        await loadOfficeStructureStatus();
    } catch (error) {
        console.error('Error loading salary structures:', error);
    }
}

async function loadOfficeStructureStatus() {
    try {
        const response = await api.request('/hrms/dashboard/setup-status');
        if (response && response.office_salary_structure_status) {
            updateOfficeStructureStatusCards(response.office_salary_structure_status);
        }
    } catch (error) {
        console.error('Error loading office structure status:', error);
    }
}

function updateOfficeStructureStatusCards(statusList) {
    const container = document.getElementById('officeStructureStatus');
    if (!container) return;

    if (!statusList || statusList.length === 0) {
        container.innerHTML = '<p class="text-muted">No offices configured yet.</p>';
        return;
    }

    container.innerHTML = statusList.map(status => `
        <div class="office-status-card ${status.has_salary_structure ? 'complete' : 'incomplete'}">
            <div class="office-status-header">
                <span class="office-name">${status.office_name}</span>
                <span class="status-icon">
                    ${status.has_salary_structure ?
                        '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>' :
                        '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>'
                    }
                </span>
            </div>
            <div class="office-status-details">
                <span class="structure-count">${status.structure_count} structure(s)</span>
                ${status.has_default_structure ?
                    '<span class="has-default">Default set</span>' :
                    '<span class="no-default">No default</span>'
                }
            </div>
        </div>
    `).join('');
}

function updateSalaryStructuresTable() {
    const tbody = document.getElementById('salaryStructuresTable');
    const searchTerm = document.getElementById('structureSearch')?.value?.toLowerCase() || '';

    const filtered = structures.filter(s =>
        (s.structure_name || '').toLowerCase().includes(searchTerm) ||
        (s.structure_code || '').toLowerCase().includes(searchTerm) ||
        (s.office_name || '').toLowerCase().includes(searchTerm)
    );

    if (filtered.length === 0) {
        tbody.innerHTML = `
            <tr class="empty-state">
                <td colspan="8">
                    <div class="empty-message">
                        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">
                            <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path>
                        </svg>
                        <p>No salary structures defined</p>
                    </div>
                </td>
            </tr>`;
        return;
    }

    tbody.innerHTML = filtered.map(s => `
        <tr>
            <td><strong>${s.office_name || 'N/A'}</strong></td>
            <td><strong>${s.structure_name}</strong></td>
            <td><code>${s.structure_code || '-'}</code></td>
            <td>${s.component_count || 0} component${s.component_count !== 1 ? 's' : ''}</td>
            <td>${s.employee_count || 0}</td>
            <td>
                ${s.is_default ?
                    '<span class="status-badge status-default">Default</span>' :
                    '<span class="text-muted">-</span>'
                }
            </td>
            <td><span class="status-badge status-${s.is_active ? 'active' : 'inactive'}">${s.is_active ? 'Active' : 'Inactive'}</span></td>
            <td>
                <div class="action-buttons">
                    <button class="action-btn" onclick="editSalaryStructure('${s.id}')" title="Edit">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                        </svg>
                    </button>
                </div>
            </td>
        </tr>
    `).join('');
}

async function loadComponents() {
    try {
        const response = await api.request('/hrms/payroll/components');
        components = response || [];
        updateComponentsTables();
    } catch (error) {
        console.error('Error loading components:', error);
    }
}

function updateComponentsTables() {
    const searchTerm = document.getElementById('componentSearch')?.value?.toLowerCase() || '';
    const typeFilter = document.getElementById('componentType')?.value || '';

    const filtered = components.filter(c => {
        const name = c.component_name || c.name || '';
        const code = c.component_code || c.code || '';
        const type = c.component_type || c.category || '';
        const matchesSearch = name.toLowerCase().includes(searchTerm) ||
                             code.toLowerCase().includes(searchTerm);
        const matchesType = !typeFilter || type === typeFilter;
        return matchesSearch && matchesType;
    });

    const earnings = filtered.filter(c => (c.component_type || c.category) === 'earning');
    const deductions = filtered.filter(c => (c.component_type || c.category) === 'deduction');

    updateEarningsTable(earnings);
    updateDeductionsTable(deductions);
}

function updateEarningsTable(earnings) {
    const tbody = document.getElementById('earningsTable');

    if (!earnings || earnings.length === 0) {
        tbody.innerHTML = '<tr class="empty-state"><td colspan="6"><p>No earnings components</p></td></tr>';
        return;
    }

    tbody.innerHTML = earnings.map(c => `
        <tr>
            <td><strong>${c.component_name || c.name}</strong></td>
            <td><code>${c.component_code || c.code}</code></td>
            <td>${c.calculation_type || c.calculationType || 'Fixed'}</td>
            <td>${(c.is_taxable !== undefined ? c.is_taxable : c.isTaxable) ? 'Yes' : 'No'}</td>
            <td><span class="status-badge status-${(c.is_active !== undefined ? c.is_active : c.isActive) ? 'active' : 'inactive'}">${(c.is_active !== undefined ? c.is_active : c.isActive) ? 'Active' : 'Inactive'}</span></td>
            <td>
                <div class="action-buttons">
                    <button class="action-btn" onclick="editComponent('${c.id}')" title="Edit">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                        </svg>
                    </button>
                </div>
            </td>
        </tr>
    `).join('');
}

function updateDeductionsTable(deductions) {
    const tbody = document.getElementById('deductionsTable');

    if (!deductions || deductions.length === 0) {
        tbody.innerHTML = '<tr class="empty-state"><td colspan="6"><p>No deduction components</p></td></tr>';
        return;
    }

    tbody.innerHTML = deductions.map(c => `
        <tr>
            <td><strong>${c.component_name || c.name}</strong></td>
            <td><code>${c.component_code || c.code}</code></td>
            <td>${c.calculation_type || c.calculationType || 'Fixed'}</td>
            <td>${(c.is_pre_tax !== undefined ? c.is_pre_tax : c.isPreTax) ? 'Yes' : 'No'}</td>
            <td><span class="status-badge status-${(c.is_active !== undefined ? c.is_active : c.isActive) ? 'active' : 'inactive'}">${(c.is_active !== undefined ? c.is_active : c.isActive) ? 'Active' : 'Inactive'}</span></td>
            <td>
                <div class="action-buttons">
                    <button class="action-btn" onclick="editComponent('${c.id}')" title="Edit">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                        </svg>
                    </button>
                </div>
            </td>
        </tr>
    `).join('');
}

async function loadLoans() {
    try {
        const status = document.getElementById('loanStatus')?.value || '';
        let url = isAdmin ? '/hrms/payroll-processing/loans' : '/hrms/payroll-processing/my-loans';
        if (status) url += `?status=${status}`;

        const response = await api.request(url);
        updateLoansTable(response || []);
    } catch (error) {
        console.error('Error loading loans:', error);
    }
}

function updateLoansTable(loans) {
    const tbody = document.getElementById('loansTable');

    if (!loans || loans.length === 0) {
        tbody.innerHTML = `
            <tr class="empty-state">
                <td colspan="8">
                    <div class="empty-message">
                        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">
                            <line x1="12" y1="1" x2="12" y2="23"></line>
                            <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path>
                        </svg>
                        <p>No loans found</p>
                    </div>
                </td>
            </tr>`;
        return;
    }

    tbody.innerHTML = loans.map(loan => `
        <tr>
            <td class="employee-cell">
                <div class="employee-info">
                    <div class="avatar">${getInitials(loan.employee_name || loan.employee_code)}</div>
                    <div class="details">
                        <span class="name">${loan.employee_name || loan.employee_code || 'Unknown'}</span>
                    </div>
                </div>
            </td>
            <td>${formatLoanType(loan.loan_type)}</td>
            <td>${formatCurrency(loan.principal_amount)}</td>
            <td>${formatCurrency(loan.emi_amount)}</td>
            <td>${formatCurrency(loan.outstanding_amount)}</td>
            <td>${formatDate(loan.start_date)}</td>
            <td><span class="status-badge status-${loan.status?.toLowerCase()}">${loan.status}</span></td>
            <td>
                <div class="action-buttons">
                    <button class="action-btn" onclick="viewLoan('${loan.id}')" title="View">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                            <circle cx="12" cy="12" r="3"></circle>
                        </svg>
                    </button>
                </div>
            </td>
        </tr>
    `).join('');
}

async function loadOffices() {
    try {
        const response = await api.request('/hrms/offices');
        offices = response || [];

        const selects = ['payrollOffice', 'runOffice', 'structureOfficeFilter', 'structureOffice', 'draftOffice', 'draftPayrollOffice'];
        selects.forEach(id => {
            const select = document.getElementById(id);
            if (select) {
                let firstOption;
                if (id === 'runOffice' || id === 'structureOfficeFilter' || id === 'draftOffice' || id === 'draftPayrollOffice') {
                    firstOption = '<option value="">All Offices</option>';
                } else if (id === 'structureOffice') {
                    firstOption = '<option value="">Select Office (Required)</option>';
                } else {
                    firstOption = '<option value="">Select Office</option>';
                }
                select.innerHTML = firstOption;
                offices.forEach(office => {
                    select.innerHTML += `<option value="${office.id}">${office.office_name}</option>`;
                });
            }
        });
    } catch (error) {
        console.error('Error loading offices:', error);
    }
}

async function loadEmployees() {
    try {
        const response = await api.request('/hrms/employees');
        employees = response || [];

        const select = document.getElementById('loanEmployee');
        if (select) {
            select.innerHTML = '<option value="">Select Employee</option>';
            employees.forEach(emp => {
                select.innerHTML += `<option value="${emp.id}">${emp.first_name} ${emp.last_name}</option>`;
            });
        }
    } catch (error) {
        console.error('Error loading employees:', error);
    }
}

// Modal functions
function showSalaryStructureModal() {
    // Navigate to structures tab first
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelector('[data-tab="salary-structures"]').classList.add('active');
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    document.getElementById('salary-structures').classList.add('active');
}

function showCreateStructureModal() {
    document.getElementById('structureForm').reset();
    document.getElementById('structureId').value = '';
    document.getElementById('structureModalTitle').textContent = 'Create Salary Structure';
    document.getElementById('structureComponents').innerHTML = '';
    structureComponentCounter = 0; // Reset counter
    // Reset office dropdown
    const officeSelect = document.getElementById('structureOffice');
    if (officeSelect) officeSelect.value = '';
    // Reset is_default select
    const isDefaultSelect = document.getElementById('structureIsDefault');
    if (isDefaultSelect) isDefaultSelect.value = 'false';
    document.getElementById('structureModal').classList.add('active');
}

async function editSalaryStructure(structureId) {
    try {
        showLoading();
        const structure = await api.request(`/hrms/payroll/structures/${structureId}`);

        if (!structure) {
            showToast('Structure not found', 'error');
            hideLoading();
            return;
        }

        document.getElementById('structureId').value = structure.id;
        document.getElementById('structureName').value = structure.structure_name || '';
        document.getElementById('structureCode').value = structure.structure_code || '';
        document.getElementById('structureDescription').value = structure.description || '';

        // Set office dropdown
        const officeSelect = document.getElementById('structureOffice');
        if (officeSelect && structure.office_id) {
            officeSelect.value = structure.office_id;
        }

        // Set is_default select
        const isDefaultSelect = document.getElementById('structureIsDefault');
        if (isDefaultSelect) {
            isDefaultSelect.value = structure.is_default ? 'true' : 'false';
        }

        // Load and populate structure components
        if (structure.components && structure.components.length > 0) {
            populateStructureComponents(structure.components);
        } else {
            document.getElementById('structureComponents').innerHTML = '';
            structureComponentCounter = 0;
        }

        document.getElementById('structureModalTitle').textContent = 'Edit Salary Structure';
        document.getElementById('structureModal').classList.add('active');
        hideLoading();
    } catch (error) {
        console.error('Error loading structure:', error);
        showToast('Failed to load structure details', 'error');
        hideLoading();
    }
}

async function saveSalaryStructure() {
    const form = document.getElementById('structureForm');
    if (!form.checkValidity()) {
        form.reportValidity();
        return;
    }

    const officeId = document.getElementById('structureOffice')?.value;
    if (!officeId) {
        showToast('Please select an office for this salary structure', 'error');
        return;
    }

    // Get structure components
    const structureComponents = getStructureComponents();

    // Validate that at least one component is added with a value
    if (!structureComponents || structureComponents.length === 0) {
        showToast('Please add at least one salary component with values', 'error');
        return;
    }

    // Validate that all components have proper values
    const invalidComponents = structureComponents.filter(c => {
        if (c.calculation_type === 'percentage') {
            return !c.percentage || c.percentage <= 0;
        } else {
            return !c.fixed_amount || c.fixed_amount <= 0;
        }
    });

    if (invalidComponents.length > 0) {
        showToast('All components must have a value greater than 0', 'error');
        return;
    }

    try {
        showLoading();
        const id = document.getElementById('structureId').value;
        const isDefaultSelect = document.getElementById('structureIsDefault');
        const isDefault = isDefaultSelect ? isDefaultSelect.value === 'true' : false;

        const data = {
            structure_name: document.getElementById('structureName').value,
            structure_code: document.getElementById('structureCode').value,
            description: document.getElementById('structureDescription').value,
            office_id: officeId,
            is_default: isDefault,
            is_active: true,
            components: structureComponents
        };

        if (id) {
            data.id = id;
            await api.request(`/hrms/payroll/structures/${id}`, {
                method: 'PUT',
                body: JSON.stringify(data)
            });
        } else {
            await api.request('/hrms/payroll/structures', {
                method: 'POST',
                body: JSON.stringify(data)
            });
        }

        closeModal('structureModal');
        showToast(`Salary structure ${id ? 'updated' : 'created'} successfully`, 'success');
        await loadSalaryStructures();
        hideLoading();
    } catch (error) {
        console.error('Error saving structure:', error);
        showToast(error.message || 'Failed to save salary structure', 'error');
        hideLoading();
    }
}

function showCreateComponentModal() {
    document.getElementById('componentForm').reset();
    document.getElementById('componentId').value = '';
    document.getElementById('componentModalTitle').textContent = 'Create Salary Component';
    document.getElementById('componentModal').classList.add('active');
    // Reset percentage fields visibility
    togglePercentageFields();
}

// Toggle percentage fields visibility based on calculation type
function togglePercentageFields() {
    const calcType = document.getElementById('calculationType').value;
    const percentageRow = document.getElementById('percentageFieldsRow');
    const percentageInput = document.getElementById('componentPercentage');

    if (calcType === 'percentage') {
        percentageRow.style.display = 'flex';
        percentageInput.required = true;
    } else {
        percentageRow.style.display = 'none';
        percentageInput.required = false;
        percentageInput.value = '';
    }
}

// Add event listener for calculation type change
document.addEventListener('DOMContentLoaded', function() {
    const calcTypeSelect = document.getElementById('calculationType');
    if (calcTypeSelect) {
        calcTypeSelect.addEventListener('change', togglePercentageFields);
    }
});

function showCreateLoanModal() {
    document.getElementById('loanForm').reset();
    document.getElementById('loanId').value = '';
    document.getElementById('loanModalTitle').textContent = 'Apply for Loan';
    document.getElementById('loanModal').classList.add('active');
}

function closeModal(modalId) {
    document.getElementById(modalId).classList.remove('active');
}

// Submit functions
async function saveComponent() {
    const form = document.getElementById('componentForm');
    if (!form.checkValidity()) {
        form.reportValidity();
        return;
    }

    try {
        showLoading();
        const id = document.getElementById('componentId').value;
        const calculationType = document.getElementById('calculationType').value;
        const data = {
            component_name: document.getElementById('componentName').value,
            component_code: document.getElementById('componentCode').value,
            component_type: document.getElementById('componentCategory').value,
            calculation_type: calculationType,
            is_taxable: document.getElementById('isTaxable').value === 'true',
            is_statutory: document.getElementById('isStatutory').value === 'true',
            description: document.getElementById('componentDescription').value
        };

        // Add percentage fields if calculation type is percentage
        if (calculationType === 'percentage') {
            data.percentage = parseFloat(document.getElementById('componentPercentage').value) || 0;
            data.calculation_base = document.getElementById('calculationBase').value;
        }

        if (id) {
            data.id = id;
            await api.request(`/hrms/payroll/components/${id}`, {
                method: 'PUT',
                body: JSON.stringify(data)
            });
        } else {
            await api.request('/hrms/payroll/components', {
                method: 'POST',
                body: JSON.stringify(data)
            });
        }

        closeModal('componentModal');
        showToast(`Component ${id ? 'updated' : 'created'} successfully`, 'success');
        await loadComponents();
        hideLoading();
    } catch (error) {
        console.error('Error saving component:', error);
        showToast(error.message || 'Failed to save component', 'error');
        hideLoading();
    }
}

async function saveLoan() {
    const form = document.getElementById('loanForm');
    if (!form.checkValidity()) {
        form.reportValidity();
        return;
    }

    try {
        showLoading();
        const data = {
            loan_type: document.getElementById('loanType').value,
            principal_amount: parseFloat(document.getElementById('loanAmount').value),
            interest_rate: parseFloat(document.getElementById('interestRate').value) || 0,
            emi_amount: parseFloat(document.getElementById('emiAmount').value),
            start_date: document.getElementById('loanStartDate').value,
            tenure_months: parseInt(document.getElementById('numberOfInstallments').value),
            reason: document.getElementById('loanReason').value
        };

        if (isAdmin) {
            data.employee_id = document.getElementById('loanEmployee').value;
        }

        await api.request('/hrms/payroll-processing/loans', {
            method: 'POST',
            body: JSON.stringify(data)
        });

        closeModal('loanModal');
        showToast('Loan application submitted successfully', 'success');
        await loadLoans();
        hideLoading();
    } catch (error) {
        console.error('Error saving loan:', error);
        showToast(error.message || 'Failed to submit loan application', 'error');
        hideLoading();
    }
}

async function viewPayslip(payslipId) {
    try {
        showLoading();
        currentPayslipId = payslipId;
        const payslip = await api.request(`/hrms/payroll-processing/payslips/${payslipId}`);

        document.getElementById('payslipContent').innerHTML = `
            <div class="payslip-header">
                <h3>${payslip.companyName || 'Company Name'}</h3>
                <p>Payslip for ${getMonthName(payslip.month)} ${payslip.year}</p>
            </div>
            <div class="payslip-employee">
                <div class="info-row">
                    <span class="label">Employee Name:</span>
                    <span class="value">${payslip.employeeName}</span>
                </div>
                <div class="info-row">
                    <span class="label">Employee ID:</span>
                    <span class="value">${payslip.employeeCode || 'N/A'}</span>
                </div>
                <div class="info-row">
                    <span class="label">Department:</span>
                    <span class="value">${payslip.departmentName || 'N/A'}</span>
                </div>
                <div class="info-row">
                    <span class="label">Pay Period:</span>
                    <span class="value">${formatDate(payslip.periodStart)} - ${formatDate(payslip.periodEnd)}</span>
                </div>
            </div>
            <div class="payslip-details">
                <div class="earnings-section">
                    <h4>Earnings</h4>
                    <table>
                        ${(payslip.earnings || []).map(e => `
                            <tr>
                                <td>${e.componentName}</td>
                                <td class="amount">${formatCurrency(e.amount)}</td>
                            </tr>
                        `).join('')}
                        <tr class="total">
                            <td>Gross Salary</td>
                            <td class="amount">${formatCurrency(payslip.grossSalary)}</td>
                        </tr>
                    </table>
                </div>
                <div class="deductions-section">
                    <h4>Deductions</h4>
                    <table>
                        ${(payslip.deductions || []).map(d => `
                            <tr>
                                <td>${d.componentName}</td>
                                <td class="amount">${formatCurrency(d.amount)}</td>
                            </tr>
                        `).join('')}
                        <tr class="total">
                            <td>Total Deductions</td>
                            <td class="amount">${formatCurrency(payslip.totalDeductions)}</td>
                        </tr>
                    </table>
                </div>
            </div>
            <div class="payslip-net">
                <span>Net Pay:</span>
                <span class="net-amount">${formatCurrency(payslip.netSalary)}</span>
            </div>
        `;

        document.getElementById('payslipModal').classList.add('active');
        hideLoading();
    } catch (error) {
        console.error('Error loading payslip:', error);
        showToast('Failed to load payslip', 'error');
        hideLoading();
    }
}

async function downloadPayslip() {
    if (currentPayslipId) {
        await downloadPayslipById(currentPayslipId);
    }
}

async function downloadPayslipById(payslipId) {
    try {
        showToast('Downloading payslip...', 'info');
        // In a real implementation, this would call an API to generate PDF
        window.open(`/hrms/payroll-processing/payslips/${payslipId}/download`, '_blank');
    } catch (error) {
        console.error('Error downloading payslip:', error);
        showToast('Failed to download payslip', 'error');
    }
}

function editComponent(componentId) {
    const component = components.find(c => c.id === componentId);
    if (!component) return;

    document.getElementById('componentId').value = component.id;
    document.getElementById('componentName').value = component.component_name || component.name || '';
    document.getElementById('componentCode').value = component.component_code || component.code || '';
    document.getElementById('componentCategory').value = component.component_type || component.category || 'earning';
    document.getElementById('calculationType').value = component.calculation_type || component.calculationType || 'fixed';
    document.getElementById('isTaxable').value = (component.is_taxable !== undefined ? component.is_taxable : component.isTaxable) ? 'true' : 'false';
    document.getElementById('isStatutory').value = (component.is_statutory !== undefined ? component.is_statutory : component.isStatutory) ? 'true' : 'false';
    document.getElementById('componentDescription').value = component.description || '';

    document.getElementById('componentModalTitle').textContent = 'Edit Salary Component';
    document.getElementById('componentModal').classList.add('active');
}

// Structure component management
let structureComponentCounter = 0;

function addStructureComponent() {
    const container = document.getElementById('structureComponents');
    const componentId = `sc_${structureComponentCounter++}`;

    const componentHtml = `
        <div class="structure-component-row" id="${componentId}">
            <div class="form-row component-row">
                <div class="form-group" style="flex: 2;">
                    <select class="form-control component-select" required>
                        <option value="">Select Component</option>
                        ${components.map(c => `<option value="${c.id}" data-type="${c.component_type || c.category}">${c.component_name || c.name} (${c.component_code || c.code})</option>`).join('')}
                    </select>
                </div>
                <div class="form-group" style="flex: 1;">
                    <select class="form-control calc-type-select" onchange="toggleComponentValueFields(this, '${componentId}')">
                        <option value="percentage">% of Basic</option>
                        <option value="fixed">Fixed Amount</option>
                    </select>
                </div>
                <div class="form-group value-field" style="flex: 1;">
                    <input type="number" class="form-control percentage-value" placeholder="%" step="0.01" min="0" max="100">
                    <input type="number" class="form-control fixed-value" placeholder="Amount" step="0.01" min="0" style="display: none;" disabled>
                </div>
                <button type="button" class="btn btn-danger btn-sm" onclick="removeStructureComponent('${componentId}')">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <line x1="18" y1="6" x2="6" y2="18"></line>
                        <line x1="6" y1="6" x2="18" y2="18"></line>
                    </svg>
                </button>
            </div>
        </div>
    `;

    container.insertAdjacentHTML('beforeend', componentHtml);
}

function removeStructureComponent(componentId) {
    const element = document.getElementById(componentId);
    if (element) {
        element.remove();
    }
}

function toggleComponentValueFields(select, componentId) {
    const row = document.getElementById(componentId);
    if (!row) return;

    const percentageInput = row.querySelector('.percentage-value');
    const fixedInput = row.querySelector('.fixed-value');

    if (select.value === 'percentage') {
        percentageInput.style.display = 'block';
        percentageInput.disabled = false;
        fixedInput.style.display = 'none';
        fixedInput.disabled = true;
        fixedInput.value = '';
    } else {
        percentageInput.style.display = 'none';
        percentageInput.disabled = true;
        fixedInput.style.display = 'block';
        fixedInput.disabled = false;
        percentageInput.value = '';
    }
}

function getStructureComponents() {
    const container = document.getElementById('structureComponents');
    const rows = container.querySelectorAll('.structure-component-row');
    const componentsList = [];

    rows.forEach((row, index) => {
        const componentSelect = row.querySelector('.component-select');
        const calcTypeSelect = row.querySelector('.calc-type-select');
        const percentageInput = row.querySelector('.percentage-value');
        const fixedInput = row.querySelector('.fixed-value');

        if (componentSelect.value) {
            componentsList.push({
                component_id: componentSelect.value,
                calculation_type: calcTypeSelect.value,
                percentage: calcTypeSelect.value === 'percentage' ? parseFloat(percentageInput.value) || 0 : null,
                fixed_amount: calcTypeSelect.value === 'fixed' ? parseFloat(fixedInput.value) || 0 : null,
                display_order: index + 1
            });
        }
    });

    return componentsList;
}

function populateStructureComponents(structureComponents) {
    const container = document.getElementById('structureComponents');
    container.innerHTML = '';
    structureComponentCounter = 0;

    if (structureComponents && structureComponents.length > 0) {
        structureComponents.forEach(sc => {
            addStructureComponent();
            const lastRow = container.lastElementChild;
            if (lastRow) {
                lastRow.querySelector('.component-select').value = sc.component_id;
                lastRow.querySelector('.calc-type-select').value = sc.calculation_type || 'percentage';

                const percentageInput = lastRow.querySelector('.percentage-value');
                const fixedInput = lastRow.querySelector('.fixed-value');

                if (sc.calculation_type === 'fixed') {
                    percentageInput.style.display = 'none';
                    percentageInput.disabled = true;
                    fixedInput.style.display = 'block';
                    fixedInput.disabled = false;
                    fixedInput.value = sc.fixed_amount || '';
                } else {
                    percentageInput.style.display = 'block';
                    percentageInput.disabled = false;
                    fixedInput.style.display = 'none';
                    fixedInput.disabled = true;
                    percentageInput.value = sc.percentage || '';
                }
            }
        });
    }
}

// Utility functions
function formatCurrency(amount) {
    if (amount === null || amount === undefined) return '₹0';
    return new Intl.NumberFormat('en-IN', {
        style: 'currency',
        currency: 'INR',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
    }).format(amount);
}

function formatDate(dateString) {
    if (!dateString) return '-';
    return new Date(dateString).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
    });
}

function getMonthName(month) {
    const months = ['January', 'February', 'March', 'April', 'May', 'June',
                   'July', 'August', 'September', 'October', 'November', 'December'];
    return months[(month - 1) % 12] || '';
}

function formatLoanType(type) {
    const types = {
        'salary_advance': 'Salary Advance',
        'personal_loan': 'Personal Loan',
        'emergency_loan': 'Emergency Loan'
    };
    return types[type] || type;
}

function getInitials(name) {
    if (!name) return '?';
    return name.split(' ').map(n => n[0]).join('').toUpperCase().substring(0, 2);
}

function showLoading() {
    document.getElementById('loadingOverlay').classList.add('active');
}

function hideLoading() {
    document.getElementById('loadingOverlay').classList.remove('active');
}

function showToast(message, type = 'info') {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.className = `toast ${type} show`;
    setTimeout(() => toast.classList.remove('show'), 3000);
}

// Store current payroll run for modal actions
let currentPayrollRunId = null;
let currentPayrollRunStatus = null;

// Virtual scroll state for payroll modal
let payrollModalState = {
    payslips: [],
    filteredPayslips: [],
    rowHeight: 36,
    visibleRows: 15,
    scrollTop: 0,
    searchTerm: '',
    dynamicColumns: [] // Dynamic columns extracted from payslip items
};

// View payroll run details - Dynamic Columns Version
async function viewPayrollRun(runId) {
    try {
        showLoading();
        currentPayrollRunId = runId;

        // Call the details endpoint which includes payslips
        const response = await api.request(`/hrms/payroll-processing/runs/${runId}/details`);
        const run = response.run;
        const payslips = response.payslips || [];
        const summary = response.summary || {};

        currentPayrollRunStatus = run.status;
        payrollModalState.payslips = payslips;
        payrollModalState.filteredPayslips = payslips;
        payrollModalState.searchTerm = '';

        // Extract dynamic columns from payslip items
        payrollModalState.dynamicColumns = extractDynamicColumns(payslips);

        // Update modal title
        document.getElementById('payrollRunDetailsTitle').textContent =
            `${getMonthName(run.payroll_month)} ${run.payroll_year} Payroll`;

        // Build compact content
        let contentHtml = `
            <div class="pr-compact-header">
                <div class="pr-stats-row">
                    <div class="pr-stat"><span class="pr-stat-val">${summary.total_employees || 0}</span><span class="pr-stat-lbl">Employees</span></div>
                    <div class="pr-stat"><span class="pr-stat-val">${formatCurrency(summary.total_gross)}</span><span class="pr-stat-lbl">Gross</span></div>
                    <div class="pr-stat"><span class="pr-stat-val">${formatCurrency(summary.total_deductions)}</span><span class="pr-stat-lbl">Deductions</span></div>
                    <div class="pr-stat pr-stat-highlight"><span class="pr-stat-val">${formatCurrency(summary.total_net)}</span><span class="pr-stat-lbl">Net Pay</span></div>
                    <div class="pr-stat-badge">
                        <span class="status-badge status-${run.status?.toLowerCase()}">${run.status}</span>
                    </div>
                </div>
                <div class="pr-meta-row">
                    <span>${run.office_name || 'All Offices'}</span>
                    <span class="pr-meta-sep">|</span>
                    <span>${formatDate(run.pay_period_start)} - ${formatDate(run.pay_period_end)}</span>
                </div>
            </div>
        `;

        // Add payslips section with search and virtual scroll
        if (payslips.length > 0) {
            contentHtml += `
                <div class="pr-table-section">
                    <div class="pr-table-toolbar">
                        <div class="pr-search-box">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <circle cx="11" cy="11" r="8"></circle><path d="m21 21-4.35-4.35"></path>
                            </svg>
                            <input type="text" id="payslipSearchInput" placeholder="Search employee..." onkeyup="filterPayslips(this.value)">
                        </div>
                        <span class="pr-count" id="payslipCount">${payslips.length} employees</span>
                    </div>
                    <div class="pr-table-container" id="payslipVirtualContainer">
                        <table class="pr-table">
                            <thead>
                                <tr>
                                    <th class="pr-col-emp">Employee</th>
                                    <th class="pr-col-dept">Dept</th>
                                    ${buildDynamicHeaders()}
                                    <th class="pr-col-num text-right">Gross</th>
                                    <th class="pr-col-num text-right">Ded.</th>
                                    <th class="pr-col-num text-right">Net</th>
                                    <th class="pr-col-days text-center">Days</th>
                                </tr>
                            </thead>
                        </table>
                        <div class="pr-virtual-scroll" id="payslipVirtualScroll" onscroll="handlePayslipScroll()">
                            <div class="pr-virtual-spacer" id="payslipSpacer"></div>
                            <table class="pr-table pr-virtual-table">
                                <tbody id="payslipTbody"></tbody>
                            </table>
                        </div>
                    </div>
                </div>
            `;
        } else {
            contentHtml += `
                <div class="pr-empty-state">
                    <p>No payslips generated. ${run.status === 'draft' ? 'Process to generate.' : ''}</p>
                </div>
            `;
        }

        document.getElementById('payrollRunDetailsContent').innerHTML = contentHtml;

        // Show/hide action buttons based on status
        const deleteBtn = document.getElementById('deletePayrollRunBtn');
        const processBtn = document.getElementById('processPayrollRunBtn');
        const downloadBtn = document.getElementById('downloadCsvBtn');

        if (deleteBtn) {
            deleteBtn.style.display = run.status === 'draft' ? 'inline-flex' : 'none';
        }
        if (processBtn) {
            processBtn.style.display = run.status === 'draft' ? 'inline-flex' : 'none';
        }
        if (downloadBtn) {
            downloadBtn.style.display = (payslips.length > 0) ? 'inline-flex' : 'none';
        }

        // Show the modal
        document.getElementById('payrollRunDetailsModal').classList.add('active');

        // Initialize virtual scroll if we have payslips
        if (payslips.length > 0) {
            initPayslipVirtualScroll();
        }

        hideLoading();
    } catch (error) {
        console.error('Error viewing payroll run:', error);
        showToast(error.message || 'Failed to load payroll run details', 'error');
        hideLoading();
    }
}

// Extract unique component columns from all payslips
function extractDynamicColumns(payslips) {
    const columnMap = new Map(); // code -> {code, name, type, order}

    payslips.forEach(slip => {
        const items = slip.items || [];
        items.forEach(item => {
            if (!columnMap.has(item.component_code)) {
                columnMap.set(item.component_code, {
                    code: item.component_code,
                    name: item.component_name || item.component_code,
                    type: item.component_type,
                    order: item.display_order || 999
                });
            }
        });
    });

    // Sort by display_order, then by type (earnings first, then deductions)
    const typeOrder = { 'earning': 0, 'deduction': 1, 'employer_contribution': 2 };
    return Array.from(columnMap.values()).sort((a, b) => {
        const typeA = typeOrder[a.type] ?? 3;
        const typeB = typeOrder[b.type] ?? 3;
        if (typeA !== typeB) return typeA - typeB;
        return a.order - b.order;
    });
}

// Build dynamic table headers from extracted columns
function buildDynamicHeaders() {
    return payrollModalState.dynamicColumns.map(col => {
        const shortName = col.name.length > 8 ? col.code : col.name;
        return `<th class="pr-col-num text-right" title="${col.name}">${shortName}</th>`;
    }).join('');
}

// Build dynamic table cells for a payslip row
function buildDynamicCells(slip) {
    const items = slip.items || [];
    const itemMap = new Map();
    items.forEach(item => {
        itemMap.set(item.component_code, item.amount);
    });

    return payrollModalState.dynamicColumns.map(col => {
        const amount = itemMap.get(col.code) || 0;
        return `<td class="pr-col-num text-right">${formatCurrencyCompact(amount)}</td>`;
    }).join('');
}

// Format currency compactly (no decimals, with commas)
function formatCurrencyCompact(amount) {
    if (amount === null || amount === undefined || amount === 0) return '0';
    return Math.round(amount).toLocaleString('en-IN');
}

// Initialize virtual scroll for payslips
function initPayslipVirtualScroll() {
    const container = document.getElementById('payslipVirtualScroll');
    if (!container) return;

    payrollModalState.scrollTop = 0;
    container.scrollTop = 0;
    updatePayslipSpacer();
    renderVisiblePayslips();
}

// Update spacer height for virtual scroll
function updatePayslipSpacer() {
    const spacer = document.getElementById('payslipSpacer');
    if (!spacer) return;

    const totalHeight = payrollModalState.filteredPayslips.length * payrollModalState.rowHeight;
    spacer.style.height = totalHeight + 'px';
}

// Handle scroll event for virtual scroll
function handlePayslipScroll() {
    const container = document.getElementById('payslipVirtualScroll');
    if (!container) return;

    payrollModalState.scrollTop = container.scrollTop;
    renderVisiblePayslips();
}

// Render only visible payslip rows
function renderVisiblePayslips() {
    const tbody = document.getElementById('payslipTbody');
    const virtualTable = document.querySelector('.pr-virtual-table');
    if (!tbody || !virtualTable) return;

    const { filteredPayslips, rowHeight, visibleRows, scrollTop } = payrollModalState;

    const startIndex = Math.floor(scrollTop / rowHeight);
    const endIndex = Math.min(startIndex + visibleRows + 2, filteredPayslips.length);
    const offsetY = startIndex * rowHeight;

    virtualTable.style.transform = `translateY(${offsetY}px)`;

    let html = '';
    for (let i = startIndex; i < endIndex; i++) {
        const slip = filteredPayslips[i];
        if (!slip) continue;

        html += `
            <tr>
                <td class="pr-col-emp">
                    <div class="pr-emp-cell">
                        <span class="pr-emp-name">${slip.employee_name || slip.employee_code || 'N/A'}</span>
                    </div>
                </td>
                <td class="pr-col-dept pr-cell-muted">${(slip.department_name || '-').substring(0, 12)}</td>
                ${buildDynamicCells(slip)}
                <td class="pr-col-num text-right pr-cell-bold">${formatCurrencyCompact(slip.gross_earnings)}</td>
                <td class="pr-col-num text-right pr-cell-muted">${formatCurrencyCompact(slip.total_deductions)}</td>
                <td class="pr-col-num text-right pr-cell-net">${formatCurrencyCompact(slip.net_pay)}</td>
                <td class="pr-col-days text-center">${Math.round(slip.days_worked || 0)}/${slip.total_working_days || 0}</td>
            </tr>
        `;
    }

    tbody.innerHTML = html;
}

// Filter payslips by search term
function filterPayslips(searchTerm) {
    payrollModalState.searchTerm = searchTerm.toLowerCase().trim();

    if (!payrollModalState.searchTerm) {
        payrollModalState.filteredPayslips = payrollModalState.payslips;
    } else {
        payrollModalState.filteredPayslips = payrollModalState.payslips.filter(slip => {
            const name = (slip.employee_name || '').toLowerCase();
            const code = (slip.employee_code || '').toLowerCase();
            const dept = (slip.department_name || '').toLowerCase();
            return name.includes(payrollModalState.searchTerm) ||
                   code.includes(payrollModalState.searchTerm) ||
                   dept.includes(payrollModalState.searchTerm);
        });
    }

    // Update count
    const countEl = document.getElementById('payslipCount');
    if (countEl) {
        countEl.textContent = `${payrollModalState.filteredPayslips.length} employees`;
    }

    // Reset scroll and re-render
    const container = document.getElementById('payslipVirtualScroll');
    if (container) container.scrollTop = 0;
    payrollModalState.scrollTop = 0;

    updatePayslipSpacer();
    renderVisiblePayslips();
}

// Delete current payroll run (draft only)
async function deleteCurrentPayrollRun() {
    if (!currentPayrollRunId) return;

    if (!confirm('Are you sure you want to delete this draft payroll run? This action cannot be undone.')) {
        return;
    }

    try {
        showLoading();
        await api.request(`/hrms/payroll-processing/runs/${currentPayrollRunId}`, {
            method: 'DELETE'
        });

        closeModal('payrollRunDetailsModal');
        showToast('Payroll run deleted successfully', 'success');
        await loadPayrollRuns();
        hideLoading();
    } catch (error) {
        console.error('Error deleting payroll run:', error);
        showToast(error.message || 'Failed to delete payroll run', 'error');
        hideLoading();
    }
}

// Download payroll CSV for bank upload
async function downloadPayrollCsv() {
    if (!currentPayrollRunId) return;

    try {
        showToast('Generating CSV file...', 'info');

        // Fetch the CSV file
        const token = localStorage.getItem('authToken');
        const response = await fetch(`${CONFIG.hrmsApiBaseUrl}/payroll-processing/runs/${currentPayrollRunId}/export-csv`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        if (!response.ok) {
            throw new Error('Failed to generate CSV');
        }

        // Get filename from Content-Disposition header or use default
        const contentDisposition = response.headers.get('Content-Disposition');
        let filename = 'payroll_export.csv';
        if (contentDisposition) {
            const match = contentDisposition.match(/filename="?(.+)"?/);
            if (match) {
                filename = match[1];
            }
        }

        // Download the file
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);

        showToast('CSV downloaded successfully', 'success');
    } catch (error) {
        console.error('Error downloading CSV:', error);
        showToast(error.message || 'Failed to download CSV', 'error');
    }
}

// Process payroll from within the modal
async function processCurrentPayrollRun() {
    if (!currentPayrollRunId) return;

    if (!confirm('Are you sure you want to process this payroll run? This will generate payslips for all eligible employees.')) {
        return;
    }

    try {
        showLoading();
        const result = await api.request(`/hrms/payroll-processing/runs/${currentPayrollRunId}/process`, {
            method: 'POST',
            body: JSON.stringify({})
        });

        // Show processing results
        let message = `Payroll processed! Processed: ${result.processed || 0}`;
        if (result.failed > 0) {
            message += `, Failed: ${result.failed}`;
        }

        showToast(message, result.failed > 0 ? 'warning' : 'success');

        // Refresh the modal to show the new payslips
        await viewPayrollRun(currentPayrollRunId);
        await loadPayrollRuns();
        hideLoading();
    } catch (error) {
        console.error('Error processing payroll:', error);
        showToast(error.message || 'Failed to process payroll', 'error');
        hideLoading();
    }
}

// Process payroll run - generate payslips for employees
async function processPayrollRun(runId) {
    if (!confirm('Are you sure you want to process this payroll run? This will generate payslips for all eligible employees.')) {
        return;
    }

    try {
        showLoading();
        const result = await api.request(`/hrms/payroll-processing/runs/${runId}/process`, {
            method: 'POST',
            body: JSON.stringify({})
        });

        // Show processing results
        let message = `Payroll processed! Processed: ${result.processed || 0}`;
        if (result.failed > 0) {
            message += `, Failed: ${result.failed}`;
        }
        if (result.errors && result.errors.length > 0) {
            console.warn('Payroll processing errors:', result.errors);
            message += `. Errors: ${result.errors.slice(0, 3).join('; ')}`;
            if (result.errors.length > 3) {
                message += `... and ${result.errors.length - 3} more`;
            }
        }

        showToast(message, result.failed > 0 ? 'warning' : 'success');
        await loadPayrollRuns();
        hideLoading();
    } catch (error) {
        console.error('Error processing payroll:', error);
        showToast(error.message || 'Failed to process payroll', 'error');
        hideLoading();
    }
}

// ======================================
// Draft Payslip Search and Export
// ======================================

/**
 * Filter draft payslips based on search query
 * @param {string} query - Search query
 */
function filterDraftPayslips(query) {
    const rows = document.querySelectorAll('.draft-payslip-row');
    const searchTerm = query.toLowerCase().trim();

    rows.forEach(row => {
        if (!searchTerm) {
            row.classList.remove('hidden');
            return;
        }

        const code = row.dataset.code || '';
        const name = row.dataset.name || '';
        const dept = row.dataset.dept || '';

        const matches = code.includes(searchTerm) ||
                       name.includes(searchTerm) ||
                       dept.includes(searchTerm);

        if (matches) {
            row.classList.remove('hidden');
        } else {
            row.classList.add('hidden');
        }
    });
}

/**
 * Export current draft payslips to CSV
 */
function exportDraftToCSV() {
    const payslips = window.currentDraftPayslips;
    if (!payslips || payslips.length === 0) {
        showToast('No payslips to export', 'warning');
        return;
    }

    // Build CSV content
    const headers = ['Employee Code', 'Employee Name', 'Department', 'Gross Earnings', 'Total Deductions', 'Net Pay'];
    const rows = payslips.map(p => [
        p.employee_code || '',
        p.employee_name || '',
        p.department_name || '',
        p.gross_earnings || 0,
        p.total_deductions || 0,
        p.net_pay || 0
    ]);

    // Create CSV string
    const csvContent = [
        headers.join(','),
        ...rows.map(row => row.map(cell => {
            // Escape quotes and wrap in quotes if contains comma
            const str = String(cell);
            if (str.includes(',') || str.includes('"') || str.includes('\n')) {
                return `"${str.replace(/"/g, '""')}"`;
            }
            return str;
        }).join(','))
    ].join('\n');

    // Get draft info for filename
    const modal = document.getElementById('draftDetailsModal');
    const title = document.getElementById('draftDetailTitle')?.textContent || 'PayrollDraft';
    const filename = `${title.replace(/[^a-zA-Z0-9]/g, '_')}.csv`;

    // Create download link
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    showToast(`Exported ${payslips.length} payslips to ${filename}`, 'success');
}

// Event listeners
document.getElementById('payslipYear')?.addEventListener('change', loadMyPayslips);
document.getElementById('runYear')?.addEventListener('change', loadPayrollRuns);
document.getElementById('runMonth')?.addEventListener('change', loadPayrollRuns);
document.getElementById('runOffice')?.addEventListener('change', loadPayrollRuns);
document.getElementById('structureSearch')?.addEventListener('input', updateSalaryStructuresTable);
document.getElementById('structureOfficeFilter')?.addEventListener('change', loadSalaryStructures);
document.getElementById('componentSearch')?.addEventListener('input', updateComponentsTables);
document.getElementById('componentType')?.addEventListener('change', updateComponentsTables);
document.getElementById('loanStatus')?.addEventListener('change', loadLoans);
