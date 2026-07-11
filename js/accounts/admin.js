/**
 * AccountsService — Administration Page
 *
 * Handles 6 sidebar tabs:
 *   1. Audit Logs          4. Job Log
 *   2. Pending Approvals   5. Closing Checklists
 *   3. Integrity Check     6. Year-End Closing
 */

// ============================================================================
// GLOBAL STATE
// ============================================================================

let auditLogs = [];
let pendingApprovals = [];
let jobLogs = [];
let closingChecklists = [];
let fiscalYears = [];

let auditLogPage = 1;
let jobLogPage = 1;
const PAGE_SIZE = 50;

// Dropdown instances
let checklistFYDropdown = null;
let yearEndFYDropdown = null;

// ============================================================================
// PAGE INIT
// ============================================================================

document.addEventListener('DOMContentLoaded', async function () {
    if (!await AccountsCommon.initPage('admin', '../')) return;

    // Reveal Danger Zone tab + nav group ONLY for SUPERADMIN. Backend
    // also enforces SUPERADMIN on /api/accounts-admin/*, so a forged
    // client-side toggle would still get 401/403 from the server.
    const isSuperadmin = readRolesFromJwt().includes('SUPERADMIN');
    const tabNames = {
        'audit-logs': 'Audit Logs',
        'pending-approvals': 'Pending Approvals',
        'integrity-check': 'Integrity Check',
        'job-log': 'Job Log',
        'closing-checklists': 'Closing Checklists',
        'year-end': 'Year-End Closing'
    };
    if (isSuperadmin) {
        const grp = document.getElementById('superadminNavGroup');
        if (grp) grp.style.display = '';
        tabNames['danger-zone'] = 'Danger Zone';
        wireWipeFlow();
    }

    AccountsCommon.setupSidebar('sidebarToggle', 'accountsSidebar', 'sidebarOverlay', tabNames);
    AccountsCommon.setupTabs(tabNames, onTabSwitch);
    accountsRoles.applyRBAC();

    await loadInitialData();
    AccountsCommon.initSearchableDropdownsWithRetry(initDropdowns);
    setupSearchListeners();
});

// ────────────────────────────────────────────────────────────────────────
// Danger Zone — SUPERADMIN tenant wipe. Mirrors HRMS admin.js pattern.
// ────────────────────────────────────────────────────────────────────────

function readRolesFromJwt() {
    try {
        const tok = localStorage.getItem('ragenaizer_authToken') || '';
        const payload = JSON.parse(atob(tok.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
        const role = payload['http://schemas.microsoft.com/ws/2008/06/identity/claims/role']
            || payload['role']
            || payload['roles']
            || [];
        return Array.isArray(role) ? role : [role];
    } catch {
        return [];
    }
}

function readTenantIdFromJwt() {
    try {
        const tok = localStorage.getItem('ragenaizer_authToken') || '';
        const payload = JSON.parse(atob(tok.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
        return payload.tenant_id || '(unknown)';
    } catch {
        return '(unknown)';
    }
}

function wireWipeFlow() {
    const wipeBtn       = document.getElementById('accountsWipeAllBtn');
    const modal         = document.getElementById('accountsWipeModal');
    const tenantSpan    = document.getElementById('accountsWipeTenantId');
    const input         = document.getElementById('accountsWipeConfirmInput');
    const confirmBtn    = document.getElementById('accountsWipeConfirmBtn');
    const closeBtn      = document.getElementById('accountsWipeModalCloseBtn');
    const cancelBtn     = document.getElementById('accountsWipeCancelBtn');
    const resultModal   = document.getElementById('accountsWipeResultModal');
    const resultClose   = document.getElementById('accountsWipeResultCloseBtn');
    const resultDone    = document.getElementById('accountsWipeResultDoneBtn');
    const resultSummary = document.getElementById('accountsWipeResultSummary');

    if (!wipeBtn || !modal) return;

    wipeBtn.addEventListener('click', () => {
        tenantSpan.textContent = readTenantIdFromJwt();
        input.value = '';
        confirmBtn.disabled = true;
        confirmBtn.textContent = 'Wipe Now';
        modal.hidden = false;
        modal.classList.add('active');
        setTimeout(() => input.focus(), 50);
    });

    input.addEventListener('input', () => {
        confirmBtn.disabled = (input.value !== 'WIPE');
    });

    function closeModal() {
        modal.classList.remove('active');
        modal.hidden = true;
    }
    function openResult() {
        resultModal.hidden = false;
        resultModal.classList.add('active');
    }
    function hideResult() {
        resultModal.classList.remove('active');
        resultModal.hidden = true;
    }
    closeBtn.addEventListener('click', closeModal);
    cancelBtn.addEventListener('click', closeModal);

    confirmBtn.addEventListener('click', async () => {
        if (input.value !== 'WIPE') return;
        confirmBtn.disabled = true;
        confirmBtn.textContent = 'Wiping…';
        try {
            const res = await api.request('/accounts/admin/wipe-all', {
                method: 'POST',
                body: JSON.stringify({ Confirm: 'WIPE' })
            });
            closeModal();
            showResult(res);
        } catch (err) {
            console.error('[Accounts admin] wipe failed', err);
            Toast?.error?.(err?.message || 'Wipe failed');
            confirmBtn.disabled = false;
            confirmBtn.textContent = 'Wipe Now';
        }
    });

    function showResult(res) {
        const ok = res?.success === true;
        const total = res?.deleted_rows ?? 0;
        const tableCount = res?.table_count ?? 0;
        const perTable = res?.per_table || {};
        // Top 8 tables by deleted-row count, for the summary.
        const top = Object.entries(perTable)
            .filter(([, v]) => typeof v === 'number' && v > 0)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 8);

        document.getElementById('accountsWipeResultTitle').textContent =
            ok ? 'Wipe Complete' : 'Wipe finished with issues';
        document.getElementById('accountsWipeResultTitle').style.color =
            ok ? 'var(--color-success, #10b981)' : 'var(--color-warning, #f59e0b)';

        const topRows = top.length
            ? `<table style="width:100%; margin-top:6px; font-size:0.88rem;">
                ${top.map(([t, n]) => `<tr><td style="padding:2px 6px; color:var(--text-secondary);">${escapeHtml(t)}</td><td style="padding:2px 6px; text-align:right;">${n.toLocaleString()}</td></tr>`).join('')}
               </table>`
            : '<div style="color:var(--text-secondary); font-size:0.88rem; margin-top:6px;">No rows present — tenant was already empty.</div>';

        resultSummary.innerHTML = `
            <div style="margin-bottom:10px;"><strong>${total.toLocaleString()}</strong> rows deleted across <strong>${tableCount}</strong> tables in a single transaction.</div>
            <details ${top.length ? 'open' : ''} style="margin-top:8px;">
                <summary style="cursor:pointer; color:var(--text-secondary); font-size:0.88rem;">Top tables affected</summary>
                ${topRows}
            </details>
        `;
        openResult();
    }

    function closeResult() {
        hideResult();
        // Reload — current page may reference resources that no longer exist.
        window.location.reload();
    }
    resultClose.addEventListener('click', closeResult);
    resultDone.addEventListener('click', closeResult);
}

function escapeHtml(s) {
    return String(s ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// ============================================================================
// TAB SWITCH HANDLER
// ============================================================================

function onTabSwitch(tabId) {
    switch (tabId) {
        case 'audit-logs':          loadAuditLogs(); break;
        case 'pending-approvals':   loadPendingApprovals(); break;
        case 'integrity-check':     break;
        case 'job-log':             loadJobLogs(); break;
        case 'closing-checklists':  loadChecklists(); break;
        case 'year-end':            break;
    }
}

// ============================================================================
// INITIAL DATA LOAD
// ============================================================================

async function loadInitialData() {
    try {
        await Promise.all([
            loadAuditLogs(),
            loadFiscalYears()
        ]);
    } catch (err) {
        console.error('[Admin] loadInitialData error:', err);
    }
}

async function loadFiscalYears() {
    try {
        const url = AccountsCommon.buildUrl('fiscal/years');
        const res = await api.request(url, { _skipSpinner: true });
        fiscalYears = Array.isArray(res) ? res : (res?.data || res?.items || []);
    } catch (err) {
        console.error('[Admin] loadFiscalYears error:', err);
    }
}

function initDropdowns() {
    if (typeof SearchableDropdown === 'undefined') return;

    const fyOptions = fiscalYears.map(fy => ({ value: fy.id, label: fy.name }));

    checklistFYDropdown = new SearchableDropdown('checklistFYContainer', {
        placeholder: 'Filter by fiscal year...',
        options: [{ value: '', label: 'All Fiscal Years' }, ...fyOptions],
        onChange: () => loadChecklists()
    });

    yearEndFYDropdown = new SearchableDropdown('yearEndFYContainer', {
        placeholder: 'Select fiscal year...',
        options: [{ value: '', label: 'Select...' }, ...fyOptions],
        onChange: (val) => { if (val) loadYearEndPreflight(val); }
    });
}

function setupSearchListeners() {
    const debounce = (fn, ms = 300) => {
        let timer;
        return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); };
    };

    const auditSearch = document.getElementById('auditUserSearch');
    if (auditSearch) auditSearch.addEventListener('input', debounce(() => { auditLogPage = 1; loadAuditLogs(); }));
}

// ============================================================================
// 1. AUDIT LOGS
// ============================================================================

async function loadAuditLogs() {
    try {
        const entityFilter = document.getElementById('auditEntityFilter')?.value || '';
        const from = document.getElementById('auditFrom')?.value || '';
        const to = document.getElementById('auditTo')?.value || '';
        const userSearch = document.getElementById('auditUserSearch')?.value || '';

        const params = { limit: PAGE_SIZE, offset: (auditLogPage - 1) * PAGE_SIZE };
        if (entityFilter) params.entityType = entityFilter;
        if (from) params.fromDate = from;
        if (to) params.toDate = to;
        if (userSearch) params.performedBy = userSearch;

        const url = AccountsCommon.buildUrl('audit/logs', params);
        const res = await api.request(url, { _skipSpinner: true });
        auditLogs = Array.isArray(res) ? res : (res?.data || res?.items || []);
        const total = res?.total || res?.totalCount || auditLogs.length;
        const totalPages = Math.ceil(total / PAGE_SIZE) || 1;

        renderAuditLogs();
        AccountsCommon.renderPagination('auditLogsPagination', auditLogPage, totalPages, (page) => {
            auditLogPage = page;
            loadAuditLogs();
        });
    } catch (err) {
        console.error('[Admin] loadAuditLogs error:', err);
        Toast.error('Failed to load audit logs');
    }
}

function renderAuditLogs() {
    const tbody = document.getElementById('auditLogsTable');
    if (!tbody) return;

    if (!auditLogs.length) {
        tbody.innerHTML = `<tr class="empty-state"><td colspan="5"><div class="empty-message">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                <polyline points="14 2 14 8 20 8"></polyline>
            </svg><p>No audit logs found</p></div></td></tr>`;
        return;
    }

    tbody.innerHTML = auditLogs.map((l, i) => {
        const actionLower = (l.action || '').toLowerCase();
        const actionBadge = ['created', 'approved', 'submitted', 'reimbursed', 'posted', 'completed'].includes(actionLower) || actionLower === 'create' ? 'status-active'
            : ['deleted', 'rejected', 'cancelled', 'reversed'].includes(actionLower) || actionLower === 'delete' ? 'status-rejected'
            : 'status-pending';

        return `<tr>
            <td>${AccountsCommon.formatDate(l.timestamp || l.created_at, true)}</td>
            <td>${AccountsCommon.escapeHtml(l.entity_type || '-')}</td>
            <td><span class="badge ${actionBadge}">${AccountsCommon.escapeHtml(l.action || '-')}</span></td>
            <td>${AccountsCommon.escapeHtml(l.performed_by_name || l.user_name || (l.performed_by === 'system' ? 'System' : l.performed_by ? l.performed_by.substring(0, 8) + '...' : '-'))}</td>
            <td>
                <button class="btn btn-outline" style="padding:0.2rem 0.6rem;font-size:0.8rem;" onclick="viewAuditLogDetail(${i})">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                    View
                </button>
            </td>
        </tr>`;
    }).join('');
}

let auditLogPanel = null;

function viewAuditLogDetail(index) {
    const l = auditLogs[index];
    if (!l) return;

    if (!auditLogPanel) {
        auditLogPanel = new SlidePanel({ id: 'auditLogDetailPanel', title: 'Audit Detail', width: '440px' });
    }

    const formatType = (t) => (t || '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

    // Parse details JSON into key-value pairs (filter out internal GUID fields)
    const HIDDEN_KEYS = new Set(['tenant_id','tenantid','created_by','createdby','updated_by','updatedby',
        'invoice_id','invoiceid','bill_id','billid','customer_id','customerid','vendor_id','vendorid',
        'account_id','accountid','id','entry_id','entryid','reference_id','referenceid','gl_entry_id','glentryid',
        'bank_account_id','bankaccountid','fiscal_year_id','fiscalyearid','fiscal_period_id','fiscalperiodid']);
    const isGuid = (s) => typeof s === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
    let detailItems = [];
    try {
        let raw = typeof l.details === 'string' ? JSON.parse(l.details) : l.details;
        if (typeof raw === 'string') { try { raw = JSON.parse(raw); } catch {} }
        if (raw && typeof raw === 'object') {
            // Escape at the call site: SlidePanel.createInfoSection interpolates
            // label/value into innerHTML unescaped — details come from stored
            // user input, so unescaped values are a stored-XSS vector.
            detailItems = Object.entries(raw)
                .filter(([k, v]) => !HIDDEN_KEYS.has(k.toLowerCase()) && !isGuid(v))
                .map(([key, val]) => ({
                    label: escapeHtml(key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())),
                    value: escapeHtml(val != null ? (typeof val === 'object' ? JSON.stringify(val) : String(val)) : '-')
                }));
        }
    } catch { /* ignore parse errors */ }

    const actionLower = (l.action || '').toLowerCase();
    const actionBadge = ['created', 'approved', 'submitted', 'reimbursed', 'posted', 'completed'].includes(actionLower) || actionLower === 'create' ? 'status-active'
        : ['deleted', 'rejected', 'cancelled', 'reversed'].includes(actionLower) || actionLower === 'delete' ? 'status-rejected'
        : 'status-pending';

    // SlidePanel helpers interpolate into innerHTML unescaped — escape every
    // dynamic value here at the call site.
    let body = SlidePanel.createHeaderCard({
        avatar: { initials: escapeHtml(formatType(l.entity_type)?.[0] || 'A') },
        title: escapeHtml(formatType(l.entity_type)),
        subtitle: AccountsCommon.formatDate(l.timestamp || l.created_at, true),
        badges: [{ text: escapeHtml(l.action || '-'), class: actionBadge }]
    });

    const entityDisplay = l.entity_display_name
        ? `<strong>${AccountsCommon.escapeHtml(l.entity_display_name)}</strong>`
        : (l.entity_id ? `<code style="font-size:0.75rem">${AccountsCommon.escapeHtml(l.entity_id)}</code>` : '-');

    body += SlidePanel.createInfoSection({
        title: 'Overview', icon: 'info', iconColor: 'blue',
        items: [
            { label: 'Action', value: escapeHtml(formatType(l.action)) },
            { label: 'Entity Type', value: escapeHtml(formatType(l.entity_type)) },
            { label: 'Reference', value: entityDisplay },
            { label: 'Performed By', value: escapeHtml(l.performed_by_name || l.user_name || (l.performed_by === 'system' ? 'System' : l.performed_by || '-')) },
            { label: 'IP Address', value: escapeHtml(l.ip_address || '-') },
            { label: 'Timestamp', value: AccountsCommon.formatDate(l.timestamp || l.created_at, true) }
        ]
    });

    if (detailItems.length > 0) {
        body += SlidePanel.createInfoSection({
            title: 'Details', icon: 'file', iconColor: 'green',
            items: detailItems
        });
    }

    if (l.entity_id && l.entity_type) {
        body += `<div style="margin-top:1rem;"><button class="btn btn-outline" style="width:100%;" onclick="viewEntityAudit('${AccountsCommon.escapeHtml(l.entity_type)}', '${AccountsCommon.escapeHtml(l.entity_id)}')">View Full Audit Trail</button></div>`;
    }

    auditLogPanel.setTitle(`${formatType(l.entity_type)} — ${formatType(l.action)}`);
    auditLogPanel.open({ body });
}

function truncateStr(str, max) {
    if (!str || typeof str !== 'string') return '-';
    return str.length > max ? str.substring(0, max) + '...' : str;
}

async function viewEntityAudit(entityType, entityId) {
    const body = document.getElementById('entityAuditBody');
    if (!body) return;

    body.innerHTML = `<div class="empty-message"><p>Loading audit trail...</p></div>`;
    AccountsCommon.openModal('entityAuditModal');

    try {
        const url = AccountsCommon.buildUrl(`audit/logs/${encodeURIComponent(entityType)}/${encodeURIComponent(entityId)}`);
        const res = await api.request(url, { _skipSpinner: true });
        const logs = Array.isArray(res) ? res : (res?.data || res?.items || []);

        if (!logs.length) {
            body.innerHTML = `<div class="empty-message"><p>No audit trail found for this entity.</p></div>`;
            return;
        }

        const formatLabel = (k) => k.replace(/_/g, ' ').replace(/([A-Z])/g, ' $1').replace(/\s+/g, ' ').trim().replace(/\b\w/g, c => c.toUpperCase());
        // Hide internal ID fields — they're GUIDs that mean nothing to users
        const HIDDEN_KEYS = new Set(['tenant_id','tenantid','created_by','createdby','updated_by','updatedby',
            'invoice_id','invoiceid','bill_id','billid','customer_id','customerid','vendor_id','vendorid',
            'account_id','accountid','id','entry_id','entryid','reference_id','referenceid','gl_entry_id','glentryid',
            'bank_account_id','bankaccountid','fiscal_year_id','fiscalyearid','fiscal_period_id','fiscalperiodid']);
        const isGuid = (s) => typeof s === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
        const parseDetails = (d) => {
            try {
                let raw = typeof d === 'string' ? JSON.parse(d) : d;
                if (typeof raw === 'string') { try { raw = JSON.parse(raw); } catch {} }
                if (raw && typeof raw === 'object') {
                    return Object.entries(raw)
                        .filter(([k, v]) => {
                            const kLower = k.toLowerCase();
                            if (HIDDEN_KEYS.has(kLower)) return false;
                            // Also filter out any remaining raw GUID values
                            if (isGuid(v)) return false;
                            return true;
                        })
                        .map(([k, v]) => ({
                            label: formatLabel(k),
                            value: v == null ? '-' : (typeof v === 'object' ? JSON.stringify(v) : String(v))
                        }));
                }
            } catch {}
            return [];
        };

        const entityLabel = entityType.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
        body.innerHTML = `
            <p style="color: var(--text-secondary); margin-bottom: 1rem; font-size: 0.85rem;">
                ${AccountsCommon.escapeHtml(entityLabel)}
            </p>
            <div class="entity-audit-timeline">
                ${logs.map(l => {
                    const items = parseDetails(l.details);
                    const actionLower = (l.action || '').toLowerCase();
                    const badgeClass = ['created','approved','submitted','reimbursed','posted','completed','create'].includes(actionLower) ? 'status-active'
                        : ['deleted','rejected','cancelled','reversed','delete'].includes(actionLower) ? 'status-rejected'
                        : 'status-pending';
                    const detailsHtml = items.length > 0
                        ? `<div style="margin-top: 0.5rem; display: grid; grid-template-columns: max-content 1fr; gap: 0.25rem 0.75rem; font-size: 0.8rem;">
                            ${items.map(it => `
                                <div style="color: var(--text-secondary); white-space: nowrap;">${AccountsCommon.escapeHtml(it.label)}:</div>
                                <div style="color: var(--text-primary); word-break: break-word;">${AccountsCommon.escapeHtml(it.value)}</div>
                            `).join('')}
                        </div>`
                        : (l.details_summary ? `<div style="margin-top: 0.25rem; font-size: 0.8rem; color: var(--text-secondary);">${AccountsCommon.escapeHtml(l.details_summary)}</div>` : '');
                    return `
                    <div class="audit-timeline-item" style="display: flex; gap: 1rem; padding: 0.75rem 0; border-bottom: 1px solid var(--border-primary);">
                        <div style="min-width: 120px; color: var(--text-secondary); font-size: 0.8rem;">
                            ${AccountsCommon.formatDate(l.timestamp || l.created_at, true)}
                        </div>
                        <div style="flex: 1; min-width: 0;">
                            <span class="badge ${badgeClass}">${AccountsCommon.escapeHtml(l.action || '-')}</span>
                            <span style="margin-left: 0.5rem; color: var(--text-secondary); font-size: 0.85rem;">by ${AccountsCommon.escapeHtml(l.performed_by_name || l.user_name || (l.performed_by === 'system' ? 'System' : l.performed_by ? l.performed_by.substring(0, 8) + '...' : '-'))}</span>
                            ${detailsHtml}
                        </div>
                    </div>`;
                }).join('')}
            </div>`;
    } catch (err) {
        console.error('[Admin] viewEntityAudit error:', err);
        body.innerHTML = `<div class="empty-message"><p>Failed to load audit trail.</p></div>`;
        Toast.error(err.message || 'Failed to load entity audit trail');
    }
}

async function exportAuditLogs() {
    try {
        const entityFilter = document.getElementById('auditEntityFilter')?.value || '';
        const from = document.getElementById('auditFrom')?.value || '';
        const to = document.getElementById('auditTo')?.value || '';
        const userSearch = document.getElementById('auditUserSearch')?.value || '';

        const params = { format: 'csv' };
        if (entityFilter) params.entityType = entityFilter;
        if (from) params.fromDate = from;
        if (to) params.toDate = to;
        if (userSearch) params.performedBy = userSearch;

        const url = AccountsCommon.buildUrl('audit/export', params);
        const res = await api.request(url, { method: 'POST', _skipSpinner: true, _rawResponse: true });

        // Handle blob download
        if (res instanceof Blob) {
            const a = document.createElement('a');
            a.href = URL.createObjectURL(res);
            a.download = `audit-logs-${new Date().toISOString().split('T')[0]}.csv`;
            a.click();
            URL.revokeObjectURL(a.href);
        } else {
            // If response is text/json, convert to CSV client-side
            const data = Array.isArray(res) ? res : (res?.data || res?.items || auditLogs);
            if (!data.length) {
                Toast.error('No data to export');
                return;
            }
            const headers = ['Timestamp', 'Entity', 'Action', 'User', 'Details'];
            const csvRows = [headers.join(',')];
            data.forEach(l => {
                csvRows.push([
                    l.timestamp || l.created_at || '',
                    l.entity_type || '',
                    l.action || '',
                    l.performed_by || l.user_name || '',
                    '"' + (l.details_summary || JSON.stringify(l.details || '')).replace(/"/g, '""') + '"'
                ].join(','));
            });
            const blob = new Blob([csvRows.join('\n')], { type: 'text/csv' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = `audit-logs-${new Date().toISOString().split('T')[0]}.csv`;
            a.click();
            URL.revokeObjectURL(a.href);
        }
        Toast.success('Audit logs exported');
    } catch (err) {
        console.error('[Admin] exportAuditLogs error:', err);
        Toast.error(err.message || 'Failed to export audit logs');
    }
}

// ============================================================================
// 2. PENDING APPROVALS
// ============================================================================

async function loadPendingApprovals() {
    const container = document.getElementById('pendingApprovalsContainer');
    if (!container) return;

    try {
        // Fetch BOTH sources in parallel:
        //   1. Expense claims awaiting manager approval
        //   2. Client/Vendor master-record requests submitted by CRM/PMS/
        //      Procurement that need finance approval before becoming
        //      Customers/Vendors in Accounts. We pull ALL statuses here
        //      (pending + approved + rejected) so the page also serves as
        //      an audit trail for cross-service master-data requests.
        const [expRes, cvrRes] = await Promise.all([
            api.request(AccountsCommon.buildUrl('audit/approvals/pending'), { _skipSpinner: true }).catch(() => null),
            api.request(AccountsCommon.buildUrl('requests', { limit: 200 }), { _skipSpinner: true }).catch(() => null)
        ]);

        const expenseClaims = Array.isArray(expRes?.expense_claims) ? expRes.expense_claims : [];
        const cvrItems      = Array.isArray(cvrRes?.items) ? cvrRes.items : [];

        pendingApprovals = [
            ...expenseClaims.map(c => ({
                id: c.id,
                entity_type: 'expense_claim',
                type: 'Expense Claim',
                title: c.claim_number || 'Expense Claim',
                description: c.description || c.claim_number || 'Expense Claim',
                requested_by: c.employee_name || c.employee_id || '-',
                requested_from_service: 'HRMS',
                amount: c.total_amount,
                status: 'pending',
                created_at: c.claim_date || c.created_at
            })),
            ...cvrItems.map(r => ({
                id: r.id,
                entity_type: r.request_type === 'client' ? 'client_request' : 'vendor_request',
                type: r.request_type === 'client' ? 'Client request' : 'Vendor request',
                title: r.name,
                description: [r.email, r.phone, r.gst_number, r.tax_id].filter(Boolean).join(' · ') || r.notes || '',
                requested_by: r.requested_by_name || r.requested_by || '-',
                requested_from_service: r.requested_from_service || '-',
                amount: null,
                status: r.status || 'pending',
                rejection_reason: r.rejection_reason || null,
                created_entity_id: r.created_entity_id || null,
                created_at: r.created_at
            }))
        ];

        if (!pendingApprovals.length) {
            container.innerHTML = `<div class="empty-message">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">
                    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
                    <polyline points="22 4 12 14.01 9 11.01"></polyline>
                </svg><p>No approval requests</p></div>`;
            return;
        }

        const statusBadge = s => {
            const map = {
                pending:  { bg:'rgba(245,158,11,0.15)', fg:'#f59e0b', label:'Pending'  },
                approved: { bg:'rgba(16,185,129,0.15)', fg:'#10b981', label:'Approved' },
                rejected: { bg:'rgba(239, 68, 68,0.15)', fg:'#ef4444', label:'Rejected' }
            };
            const m = map[s] || { bg:'rgba(148,163,184,0.15)', fg:'#94a3b8', label:s || 'unknown' };
            return `<span style="display:inline-block; padding:2px 8px; border-radius:10px; font-size:11px; font-weight:600; background:${m.bg}; color:${m.fg};">${m.label}</span>`;
        };

        container.innerHTML = pendingApprovals.map(a => {
            const isCVR     = a.entity_type === 'client_request' || a.entity_type === 'vendor_request';
            // CVR review endpoint (POST requests/{id}/review) requires
            // ACCOUNTS_ADMIN/SUPERADMIN — managers get a 403. Expense-claim
            // approvals do allow MANAGER, so keep isManager() for those.
            const showActions = a.status === 'pending' && (isCVR ? accountsRoles.isAdmin() : accountsRoles.isManager());
            const extra = a.status === 'rejected' && a.rejection_reason
                ? `<div style="font-size:12px; color:var(--text-secondary); margin-top:6px;"><strong>Reason:</strong> ${AccountsCommon.escapeHtml(a.rejection_reason)}</div>`
                : (a.status === 'approved' && a.created_entity_id
                    ? `<div style="font-size:12px; color:var(--text-secondary); margin-top:6px;"><strong>Created entity:</strong> <code>${AccountsCommon.escapeHtml(a.created_entity_id)}</code></div>`
                    : '');
            return `
            <div class="glass-card" style="margin-bottom: 1rem;">
                <div class="glass-card-body" style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 1rem;">
                    <div style="flex:1; min-width:280px;">
                        <h4 style="margin-bottom: 0.25rem; display:flex; align-items:center; gap:8px;">
                            ${AccountsCommon.escapeHtml(a.title || a.description || 'Approval Request')}
                            ${statusBadge(a.status)}
                        </h4>
                        <p style="color: var(--text-secondary); margin: 0; font-size: 0.85rem;">
                            ${AccountsCommon.escapeHtml(a.type || '-')} &bull;
                            from <strong>${AccountsCommon.escapeHtml(a.requested_from_service || '-')}</strong> &bull;
                            ${AccountsCommon.escapeHtml(a.requested_by || '-')} &bull;
                            ${AccountsCommon.formatDate(a.created_at)}
                            ${a.amount != null ? ' &bull; ' + AccountsCommon.formatCurrency(a.amount) : ''}
                        </p>
                        ${a.description && isCVR ? `<p style="color: var(--text-secondary); margin: 4px 0 0; font-size: 0.8rem;">${AccountsCommon.escapeHtml(a.description)}</p>` : ''}
                        ${extra}
                    </div>
                    <div style="display: flex; gap: 0.5rem;">
                        ${showActions ? `
                            <button class="btn btn-primary" onclick="approveItem('${a.id}')" data-entity="${a.entity_type}" style="padding: 0.4rem 1rem;">Approve</button>
                            <button class="btn btn-outline" onclick="rejectItem('${a.id}')" data-entity="${a.entity_type}" style="padding: 0.4rem 1rem; color: var(--color-danger); border-color: var(--color-danger);">Reject</button>
                        ` : ''}
                    </div>
                </div>
            </div>`;
        }).join('');
    } catch (err) {
        console.error('[Admin] loadPendingApprovals error:', err);
        container.innerHTML = `<div class="empty-message"><p>Failed to load approval requests</p></div>`;
    }
}

function _pendingApprovalLabel(id) {
    const item = (typeof pendingApprovals !== 'undefined' ? pendingApprovals : []).find(x => x.id === id);
    if (!item) return 'this pending item';
    const fmt = AccountsCommon.formatCurrency;
    const type = item.entity_type || item.type || 'item';
    const title = item.title || item.description || item.entity_name || '';
    const amount = item.amount != null ? fmt(item.amount) : '';
    const requestedBy = item.requested_by_name || item.created_by_name || '';
    const parts = [];
    parts.push(`${type.charAt(0).toUpperCase() + type.slice(1).replace(/_/g, ' ')}`);
    if (title) parts.push(`"${title}"`);
    if (amount) parts.push(`for ${amount}`);
    if (requestedBy) parts.push(`requested by ${requestedBy}`);
    return parts.join(' ');
}

// Look up the entity type for a given pending-approval id so we know which
// backend endpoint to call (expense_claim approval vs CVR approval).
function _entityTypeFor(id) {
    const item = (typeof pendingApprovals !== 'undefined' ? pendingApprovals : []).find(x => x.id === id);
    return item?.entity_type || 'expense_claim';
}

async function approveItem(id) {
    const label = _pendingApprovalLabel(id);
    const entity = _entityTypeFor(id);
    const ok = await Confirm.show({
        title: 'Approve Request',
        message: `Approve ${label}? The action will be executed on behalf of the requester and the approval will be logged in the audit trail with your user id.`,
        confirmText: 'Approve',
        type: 'info'
    });
    if (!ok) return;
    try {
        if (entity === 'client_request' || entity === 'vendor_request') {
            // CVR review endpoint: POST /api/accounts/requests/{id}/review
            // with body { action: "approve" }. On success the master record
            // is created in customers/vendors and the CVR row is marked
            // approved with created_entity_id linkage.
            await api.request(AccountsCommon.buildUrl(`requests/${id}/review`), {
                method: 'POST',
                body: JSON.stringify({ action: 'approve' })
            });
        } else {
            await api.request(AccountsCommon.buildUrl(`audit/approvals/${id}/approve`), { method: 'POST' });
        }
        Toast.success('Approved');
        await loadPendingApprovals();
    } catch (err) {
        console.error('[Admin] approveItem error:', err);
        Toast.error(err.message || 'Failed to approve');
    }
}

async function rejectItem(id) {
    const label = _pendingApprovalLabel(id);
    const entity = _entityTypeFor(id);
    const ok = await Confirm.show({
        title: 'Reject Request',
        message: `Reject ${label}? The request will be marked as rejected and the requester will be notified. The rejection is logged in the audit trail with your user id.`,
        confirmText: 'Reject',
        type: 'danger'
    });
    if (!ok) return;
    let reason = null;
    if (entity === 'client_request' || entity === 'vendor_request') {
        reason = window.prompt('Reason for rejection (optional but recommended):', '') || '';
    }
    try {
        if (entity === 'client_request' || entity === 'vendor_request') {
            await api.request(AccountsCommon.buildUrl(`requests/${id}/review`), {
                method: 'POST',
                body: JSON.stringify({ action: 'reject', rejection_reason: reason })
            });
        } else {
            await api.request(AccountsCommon.buildUrl(`audit/approvals/${id}/reject`), { method: 'POST' });
        }
        Toast.success('Rejected');
        await loadPendingApprovals();
    } catch (err) {
        console.error('[Admin] rejectItem error:', err);
        Toast.error(err.message || 'Failed to reject');
    }
}

// ============================================================================
// 3. INTEGRITY CHECK
// ============================================================================

// Map backend check_type identifiers to human-readable names and descriptions.
// Backend emits: `gl_level_balance`, `account_balance_drift`, `period_balance_consistency`.
const INTEGRITY_CHECK_LABELS = {
    gl_level_balance: { name: 'GL Balance (Dr = Cr)', description: 'Every posted journal entry has balanced debit and credit totals.' },
    account_balance_drift: { name: 'Account Balance Drift', description: 'Stored account balances match the sum of their posted journal entry lines.' },
    period_balance_consistency: { name: 'Period Balance Consistency', description: 'Fiscal period opening and closing balances reconcile across periods.' }
};

// Render the details object into a short human-readable summary instead of
// the literal string "[object Object]" that JavaScript's default toString emits.
function formatIntegrityDetails(c) {
    if (c == null) return '-';
    if (typeof c.details === 'string') return c.details;
    if (typeof c.message === 'string') return c.message;
    const d = c.details;
    if (d == null) return '-';
    if (typeof d !== 'object') return String(d);

    const fmt = AccountsCommon.formatCurrency;
    // gl_balance: { total_debit, total_credit, difference }
    if ('total_debit' in d && 'total_credit' in d) {
        return `Total Debit ${fmt(d.total_debit)} · Total Credit ${fmt(d.total_credit)} · Difference ${fmt(d.difference ?? 0)}`;
    }
    // account_drift: { drifted_accounts, accounts: [...] }
    if ('drifted_accounts' in d) {
        const n = d.drifted_accounts;
        if (n === 0) return 'No drifted accounts — all stored balances reconcile with posted JEs.';
        const sample = Array.isArray(d.accounts) ? d.accounts.slice(0, 3).map(a => `${a.account_code || ''} ${a.account_name || ''}`.trim()).filter(Boolean) : [];
        return `${n} account${n === 1 ? '' : 's'} drifted${sample.length ? ': ' + sample.join(', ') + (n > sample.length ? ', …' : '') : ''}`;
    }
    // period_balance: { inconsistent_period_balances }
    if ('inconsistent_period_balances' in d) {
        const n = d.inconsistent_period_balances;
        return n === 0 ? 'All fiscal period balances consistent.' : `${n} period${n === 1 ? '' : 's'} with inconsistent opening/closing balances.`;
    }
    // Fallback: pretty-print the object fields as key: value pairs.
    try {
        const pairs = Object.entries(d).filter(([, v]) => v !== null && typeof v !== 'object' && !Array.isArray(v));
        if (pairs.length) return pairs.map(([k, v]) => `${k}: ${v}`).join(' · ');
        return JSON.stringify(d);
    } catch {
        return '-';
    }
}

function integrityCheckLabel(c) {
    const key = c.check_type || c.check || c.name;
    return INTEGRITY_CHECK_LABELS[key]?.name || key || '-';
}

function integrityCheckPassed(c) {
    // Backend uses status === 'passed'/'failed'; tolerate older `passed` boolean shape too.
    if (typeof c.passed === 'boolean') return c.passed;
    if (typeof c.status === 'string') return c.status === 'passed';
    return false;
}

async function runIntegrityCheck() {
    const resultsContainer = document.getElementById('integrityResults');
    if (!resultsContainer) return;

    resultsContainer.innerHTML = `<div class="empty-message"><p>Running integrity check...</p></div>`;

    try {
        const url = AccountsCommon.buildUrl('system/integrity-check');
        const res = await api.request(url, { method: 'POST' });
        const data = res?.data || res;
        const checks = Array.isArray(data) ? data : (data?.checks || []);

        if (!checks.length) {
            resultsContainer.innerHTML = `<div class="glass-card"><div class="glass-card-body">
                <h4 style="margin-bottom:1rem;">Integrity Check Results</h4>
                <p style="color: var(--color-success);">All checks passed. No issues found.</p>
            </div></div>`;
            return;
        }

        const overallHealthy = (data?.overall_status === 'healthy') || checks.every(integrityCheckPassed);
        resultsContainer.innerHTML = `<div class="data-table-container"><table class="data-table">
            <thead><tr><th>Check</th><th>Status</th><th>Details</th></tr></thead>
            <tbody>${checks.map(c => {
                const passed = integrityCheckPassed(c);
                const label = integrityCheckLabel(c);
                const description = INTEGRITY_CHECK_LABELS[c.check_type || c.check || c.name]?.description || '';
                const details = formatIntegrityDetails(c);
                return `<tr>
                    <td><div style="font-weight:600;">${AccountsCommon.escapeHtml(label)}</div>${description ? `<div style="font-size:0.75rem;color:var(--text-secondary);margin-top:2px;">${AccountsCommon.escapeHtml(description)}</div>` : ''}</td>
                    <td><span class="badge ${passed ? 'status-active' : 'status-rejected'}">${passed ? 'PASS' : 'FAIL'}</span></td>
                    <td>${AccountsCommon.escapeHtml(details)}</td>
                </tr>`;
            }).join('')}</tbody>
        </table></div>`;

        if (overallHealthy) {
            Toast.success('All integrity checks passed');
        } else {
            Toast.error('Some integrity checks failed. Review results.');
        }
    } catch (err) {
        console.error('[Admin] runIntegrityCheck error:', err);
        Toast.error(err.message || 'Failed to run integrity check');
        resultsContainer.innerHTML = `<div class="empty-message"><p>Integrity check failed. Please try again.</p></div>`;
    }
}

async function loadIntegrityCheckResults() {
    const resultsContainer = document.getElementById('integrityResults');
    if (!resultsContainer) return;

    resultsContainer.innerHTML = `<div class="empty-message"><p>Loading previous results...</p></div>`;

    try {
        const url = AccountsCommon.buildUrl('system/integrity-check/results');
        const res = await api.request(url, { _skipSpinner: true });
        const results = Array.isArray(res) ? res : (res?.data || res?.items || []);

        if (!results.length) {
            resultsContainer.innerHTML = `<div class="empty-message"><p>No previous integrity check results found.</p></div>`;
            return;
        }

        resultsContainer.innerHTML = `<div class="data-table-container"><table class="data-table">
            <thead><tr><th>Run Date</th><th>Check</th><th>Status</th><th>Details</th></tr></thead>
            <tbody>${results.map(r => {
                const checks = r.checks || [r];
                return checks.map(c => {
                    const passed = integrityCheckPassed(c);
                    const label = integrityCheckLabel(c);
                    const details = formatIntegrityDetails(c);
                    return `<tr>
                        <td>${AccountsCommon.formatDate(r.checked_at || r.run_date || r.timestamp || r.created_at, true)}</td>
                        <td>${AccountsCommon.escapeHtml(label)}</td>
                        <td><span class="badge ${passed ? 'status-active' : 'status-rejected'}">${passed ? 'PASS' : 'FAIL'}</span></td>
                        <td>${AccountsCommon.escapeHtml(details)}</td>
                    </tr>`;
                }).join('');
            }).join('')}</tbody>
        </table></div>`;
    } catch (err) {
        console.error('[Admin] loadIntegrityCheckResults error:', err);
        Toast.error(err.message || 'Failed to load previous results');
        resultsContainer.innerHTML = `<div class="empty-message"><p>Failed to load previous results.</p></div>`;
    }
}

async function recomputeBalances() {
    const ok = await Confirm.show({ title: 'Recompute Balances', message: 'This will recompute all account balances from journal entries. This may take a while. Continue?', confirmText: 'Continue', type: 'warning' });
    if (!ok) return;

    try {
        const url = AccountsCommon.buildUrl('system/recompute-balances');
        await api.request(url, { method: 'POST' });
        Toast.success('Balances recomputed successfully');
    } catch (err) {
        console.error('[Admin] recomputeBalances error:', err);
        Toast.error(err.message || 'Failed to recompute balances');
    }
}

// ============================================================================
// 4. JOB LOG
// ============================================================================

async function loadJobLogs() {
    try {
        const jobType = document.getElementById('jobTypeFilter')?.value || '';
        const params = { limit: PAGE_SIZE, offset: (jobLogPage - 1) * PAGE_SIZE };
        if (jobType) params.jobType = jobType;

        const url = AccountsCommon.buildUrl('system/job-log', params);
        const res = await api.request(url, { _skipSpinner: true });
        jobLogs = Array.isArray(res) ? res : (res?.data || res?.items || []);
        const total = res?.total || res?.totalCount || jobLogs.length;
        const totalPages = Math.ceil(total / PAGE_SIZE) || 1;

        renderJobLogs();
        AccountsCommon.renderPagination('jobLogsPagination', jobLogPage, totalPages, (page) => {
            jobLogPage = page;
            loadJobLogs();
        });
    } catch (err) {
        console.error('[Admin] loadJobLogs error:', err);
        Toast.error('Failed to load job logs');
    }
}

let jobLogPanel = null;

function renderJobLogs() {
    const tbody = document.getElementById('jobLogsTable');
    if (!tbody) return;

    if (!jobLogs.length) {
        tbody.innerHTML = `<tr class="empty-state"><td colspan="5"><div class="empty-message">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">
                <rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect>
                <line x1="8" y1="21" x2="16" y2="21"></line><line x1="12" y1="17" x2="12" y2="21"></line>
            </svg><p>No job logs found</p></div></td></tr>`;
        return;
    }

    const actionBadge = (action) => {
        const map = {
            'recorded': 'status-active', 'approved': 'status-active', 'created': 'status-active',
            'deleted': 'status-rejected', 'voided': 'status-rejected', 'cancelled': 'status-rejected',
            'rejected': 'status-rejected',
            'updated': 'status-pending', 'submitted': 'status-pending'
        };
        return map[action] || 'status-pending';
    };

    const formatType = (type) => (type || '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

    tbody.innerHTML = jobLogs.map((j, i) => `<tr>
            <td>${AccountsCommon.formatDate(j.timestamp || j.created_at, true)}</td>
            <td>${AccountsCommon.escapeHtml(formatType(j.entity_type || j.job_type || '-'))}</td>
            <td><span class="badge ${actionBadge(j.action || j.status)}">${AccountsCommon.escapeHtml(j.action || j.status || '-')}</span></td>
            <td>${AccountsCommon.escapeHtml(j.performed_by_name || j.performed_by?.substring(0, 8) || '-')}</td>
            <td>
                <button class="btn btn-outline" style="padding:0.2rem 0.6rem;font-size:0.8rem;" onclick="viewJobLogDetail(${i})">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                    View
                </button>
            </td>
        </tr>`).join('');
}

function viewJobLogDetail(index) {
    const j = jobLogs[index];
    if (!j) return;

    if (!jobLogPanel) {
        jobLogPanel = new SlidePanel({ id: 'jobLogDetailPanel', title: 'Activity Detail', width: '440px' });
    }

    const formatType = (t) => (t || '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

    // Parse details JSON into key-value pairs. Escape at the call site:
    // SlidePanel.createInfoSection interpolates values into innerHTML unescaped,
    // and details contain stored user input (stored-XSS vector otherwise).
    let detailItems = [];
    try {
        const raw = typeof j.details === 'string' ? JSON.parse(j.details) : j.details;
        if (raw && typeof raw === 'object') {
            detailItems = Object.entries(raw).map(([key, val]) => ({
                label: escapeHtml(key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())),
                value: escapeHtml(val != null ? (typeof val === 'object' ? JSON.stringify(val) : String(val)) : '-')
            }));
        }
    } catch { /* ignore parse errors */ }

    const actionBadge = (a) => {
        if (['recorded', 'approved', 'created'].includes(a)) return 'status-active';
        if (['deleted', 'voided', 'cancelled', 'rejected'].includes(a)) return 'status-rejected';
        return 'status-pending';
    };

    // SlidePanel helpers interpolate into innerHTML unescaped — escape every
    // dynamic value here at the call site.
    let body = SlidePanel.createHeaderCard({
        avatar: { initials: escapeHtml(formatType(j.entity_type)?.[0] || 'J') },
        title: escapeHtml(formatType(j.entity_type)),
        subtitle: AccountsCommon.formatDate(j.created_at || j.timestamp, true),
        badges: [{ text: escapeHtml(j.action || j.status || '-'), class: actionBadge(j.action || j.status) }]
    });

    // Show entity_display_name (resolved by backend) or fall back to truncated ID
    const entityDisplay = j.entity_display_name
        ? `<strong>${AccountsCommon.escapeHtml(j.entity_display_name)}</strong>`
        : (j.entity_id ? `<code style="font-size:0.75rem">${AccountsCommon.escapeHtml(j.entity_id)}</code>` : '-');

    body += SlidePanel.createInfoSection({
        title: 'Overview', icon: 'info', iconColor: 'blue',
        items: [
            { label: 'Action', value: escapeHtml(formatType(j.action || j.status)) },
            { label: 'Entity Type', value: escapeHtml(formatType(j.entity_type || j.job_type)) },
            { label: 'Reference', value: entityDisplay },
            { label: 'Performed By', value: escapeHtml(j.performed_by_name || j.performed_by || '-') },
            { label: 'Timestamp', value: AccountsCommon.formatDate(j.created_at || j.timestamp, true) }
        ]
    });

    if (detailItems.length > 0) {
        body += SlidePanel.createInfoSection({
            title: 'Details', icon: 'file', iconColor: 'green',
            items: detailItems
        });
    }

    jobLogPanel.setTitle(`${formatType(j.entity_type)} — ${formatType(j.action || j.status)}`);
    jobLogPanel.open({ body });
}

// ============================================================================
// 5. CLOSING CHECKLISTS
// ============================================================================

async function loadChecklists() {
    try {
        const fyFilter = checklistFYDropdown?.getValue?.() || '';
        const params = {};
        if (fyFilter) params.fiscalYearId = fyFilter;

        const url = AccountsCommon.buildUrl('closing/checklists', params);
        const res = await api.request(url, { _skipSpinner: true });
        closingChecklists = Array.isArray(res) ? res : (res?.data || res?.items || []);
        renderChecklists();
    } catch (err) {
        console.error('[Admin] loadChecklists error:', err);
        Toast.error('Failed to load closing checklists');
    }
}

function renderChecklists() {
    const tbody = document.getElementById('checklistsTable');
    if (!tbody) return;

    if (!closingChecklists.length) {
        tbody.innerHTML = `<tr class="empty-state"><td colspan="5"><div class="empty-message">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">
                <polyline points="9 11 12 14 22 4"></polyline>
                <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"></path>
            </svg><p>No closing checklists found</p></div></td></tr>`;
        return;
    }

    const fyMap = {};
    fiscalYears.forEach(fy => { fyMap[fy.id] = fy.name; });

    tbody.innerHTML = closingChecklists.map(c => {
        const fyName = fyMap[c.fiscal_year_id] || c.fiscal_year_name || '-';
        const status = c.status || 'pending';
        const progress = c.items?.length ? (c.items.filter(i => i.is_completed).length + '/' + c.items.length) : (c.status === 'completed' ? 'Done' : c.status === 'in_progress' ? 'In Progress' : 'Not Started');

        const actions = accountsRoles.isAdmin()
            ? `<button class="btn-icon" onclick="viewChecklist('${c.id}')" data-tooltip="View"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg></button>
               <button class="btn-icon danger" onclick="deleteChecklist('${c.id}')" data-tooltip="Delete"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>`
            : `<button class="btn-icon" onclick="viewChecklist('${c.id}')" data-tooltip="View"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg></button>`;

        return `<tr>
            <td>${AccountsCommon.escapeHtml((c.closing_type || '').replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()) || '-')}</td>
            <td>${AccountsCommon.escapeHtml(c.period_name || fyMap[c.fiscal_period_id] || '-')}</td>
            <td>${AccountsCommon.statusBadge(status)}</td>
            <td>${c.items ? (c.items.filter(i => i.is_completed).length + '/' + c.items.length) : '-'}</td>
            <td class="actions-cell">${actions}</td>
        </tr>`;
    }).join('');
}

function showCreateChecklistModal() {
    document.getElementById('checklistModalTitle').textContent = 'Create Closing Checklist';
    document.getElementById('checklistForm').reset();
    document.getElementById('checklistId').value = '';
    populateChecklistFYSelect();
    AccountsCommon.openModal('checklistModal');
}

function populateChecklistFYSelect(selectedValue) {
    const sel = document.getElementById('checklistFY');
    if (!sel) return;
    sel.innerHTML = '<option value="">Select...</option>' +
        fiscalYears.map(fy => `<option value="${fy.id}" ${fy.id === selectedValue ? 'selected' : ''}>${AccountsCommon.escapeHtml(fy.name)}</option>`).join('');
}

async function saveChecklist() {
    const id = document.getElementById('checklistId').value;
    const fiscal_year_id = document.getElementById('checklistFY').value;

    // Backend StartClosingRequest only has fiscal_period_id + closing_type —
    // there is no name/description to store, so the modal no longer asks for them.
    if (!fiscal_year_id) {
        Toast.error('Fiscal Year is required');
        return;
    }

    // Backend requires fiscal_period_id — find the current/latest open period for the selected FY
    let fiscal_period_id = null;
    try {
        const periodsRes = await api.request(AccountsCommon.buildUrl('fiscal/periods', { fiscalYearId: fiscal_year_id }), { _skipSpinner: true });
        const periods = Array.isArray(periodsRes) ? periodsRes : (periodsRes?.data || periodsRes?.items || []);
        const now = new Date().toISOString().split('T')[0];
        // Pick the period that contains today, or fallback to the latest open period
        fiscal_period_id = (periods.find(p => p.start_date <= now && p.end_date >= now) || periods.find(p => p.status === 'open') || periods[0])?.id;
    } catch (e) { /* ignore */ }
    if (!fiscal_period_id) {
        Toast.error('No fiscal period found for the selected fiscal year');
        return;
    }

    const closing_type = document.getElementById('checklistClosingType')?.value || 'month_end';
    const payload = { fiscal_period_id, closing_type };

    try {
        if (id) {
            await api.request(AccountsCommon.buildUrl(`closing/checklists/${id}`), { method: 'PUT', body: JSON.stringify(payload) });
            Toast.success('Checklist updated');
        } else {
            await api.request(AccountsCommon.buildUrl('closing/checklists'), { method: 'POST', body: JSON.stringify(payload) });
            Toast.success('Checklist created');
        }
        AccountsCommon.closeModal('checklistModal');
        await loadChecklists();
    } catch (err) {
        console.error('[Admin] saveChecklist error:', err);
        Toast.error(err.message || 'Failed to save checklist');
    }
}

async function viewChecklist(id) {
    const body = document.getElementById('checklistDetailBody');
    if (!body) return;

    body.innerHTML = `<div class="empty-message"><p>Loading checklist...</p></div>`;
    AccountsCommon.openModal('checklistDetailModal');

    try {
        const url = AccountsCommon.buildUrl(`closing/checklists/${id}`);
        const res = await api.request(url, { _skipSpinner: true });
        const checklist = res?.data || res;
        const items = checklist?.items || [];

        // Update modal title
        const titleEl = document.getElementById('checklistDetailTitle');
        if (titleEl) titleEl.textContent = checklist.name || 'Checklist Detail';

        if (!items.length) {
            body.innerHTML = `<div class="empty-message"><p>No checklist items found.</p></div>`;
            return;
        }

        const allCompleted = items.every(i => i.is_completed || i.completed);

        body.innerHTML = `
            <p style="color: var(--text-secondary); margin-bottom: 1rem;">
                ${AccountsCommon.escapeHtml(checklist.description || '')}
                ${checklist.status ? ' &bull; ' + AccountsCommon.statusBadge(checklist.status) : ''}
                ${checklist.progress != null ? ' &bull; Progress: ' + checklist.progress + '%' : ''}
            </p>
            <div class="data-table-container"><table class="data-table">
                <thead><tr><th style="width: 50px;"></th><th>Item</th><th>Status</th></tr></thead>
                <tbody>${items.map(i => `<tr>
                    <td style="text-align: center;">
                        ${i.is_completed || i.completed
                            ? `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--color-success)" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>`
                            : `<button class="btn-icon" onclick="completeChecklistItem('${id}', '${i.id}')" data-tooltip="Mark Complete" style="color: var(--text-secondary);">
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>
                              </button>`
                        }
                    </td>
                    <td>${AccountsCommon.escapeHtml(i.description || i.name || i.title || '-')}</td>
                    <td>${i.is_completed || i.completed
                        ? `<span class="badge status-active">Completed</span>`
                        : `<span class="badge status-pending">Pending</span>`
                    }</td>
                </tr>`).join('')}</tbody>
            </table></div>
            ${allCompleted && checklist.status !== 'completed' ? `
                <div style="margin-top: 1rem; text-align: right;">
                    <button class="btn btn-primary" onclick="completeChecklist('${id}')">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
                        Mark Complete
                    </button>
                </div>
            ` : ''}
        `;
    } catch (err) {
        console.error('[Admin] viewChecklist error:', err);
        body.innerHTML = `<div class="empty-message"><p>Failed to load checklist details.</p></div>`;
        Toast.error(err.message || 'Failed to load checklist details');
    }
}

async function completeChecklistItem(checklistId, itemId) {
    try {
        const url = AccountsCommon.buildUrl(`closing/checklists/${checklistId}/items/${itemId}/complete`);
        await api.request(url, { method: 'POST' });
        Toast.success('Item marked as complete');
        await viewChecklist(checklistId);
    } catch (err) {
        console.error('[Admin] completeChecklistItem error:', err);
        Toast.error(err.message || 'Failed to complete checklist item');
    }
}

async function completeChecklist(checklistId) {
    const ok = await Confirm.show({
        title: 'Complete Checklist',
        message: 'Mark this entire checklist as complete? This indicates all closing tasks are done.',
        confirmText: 'Mark Complete',
        type: 'info'
    });
    if (!ok) return;

    try {
        const url = AccountsCommon.buildUrl(`closing/checklists/${checklistId}/complete`);
        await api.request(url, { method: 'POST' });
        Toast.success('Checklist marked as complete');
        AccountsCommon.closeModal('checklistDetailModal');
        await loadChecklists();
    } catch (err) {
        console.error('[Admin] completeChecklist error:', err);
        Toast.error(err.message || 'Failed to complete checklist');
    }
}

async function deleteChecklist(id) {
    const ok = await Confirm.danger('Are you sure you want to delete this closing checklist?', 'Delete Checklist');
    if (!ok) return;
    try {
        await api.request(AccountsCommon.buildUrl(`closing/checklists/${id}`), { method: 'DELETE' });
        Toast.success('Checklist deleted');
        await loadChecklists();
    } catch (err) {
        console.error('[Admin] deleteChecklist error:', err);
        Toast.error(err.message || 'Failed to delete checklist');
    }
}

// ============================================================================
// 6. YEAR-END CLOSING
// ============================================================================

async function loadYearEndPreflight(fiscalYearId) {
    const area = document.getElementById('yearEndPreflightArea');
    const actionsDiv = document.getElementById('yearEndActions');
    if (!area) return;

    area.innerHTML = `<div class="glass-card-body"><div class="empty-message"><p>Running pre-flight checks...</p></div></div>`;
    if (actionsDiv) actionsDiv.style.display = 'none';

    try {
        // Phase 4 Tier 1 fix — was previously calling closing/checklists/{fiscalYearId}
        // which is GetChecklistById(checklistId) on the backend. Passing a fiscal year UUID
        // returned 404, the catch fell back to "All passed", and the destructive Run Closing
        // button always became enabled with NO real preflight gating. Now calls the actual
        // integrity-check endpoint that runs the same 3 checks the Integrity Check tab uses.
        const res = await api.request(AccountsCommon.buildUrl('system/integrity-check'), { method: 'POST' });
        const checks = Array.isArray(res) ? res : (res?.data || res?.checks || []);

        if (!checks.length) {
            // No checks at all is a misconfigured/empty tenant — be conservative and
            // disable closing rather than the old "all passed" optimism.
            area.innerHTML = `<div class="glass-card-body">
                <h4 style="margin-bottom:1rem;">Pre-Flight Checks</h4>
                <p style="color: var(--color-warning);">No integrity checks returned. Run the Integrity Check tab manually before closing.</p>
            </div>`;
            if (actionsDiv) actionsDiv.style.display = 'none';
            return;
        }

        // Reuse the same shape-tolerant helpers that the Integrity Check view uses.
        // BL.RunIntegrityChecks returns rows of shape { check_type, status, details, ... }.
        const allPassed = checks.every(integrityCheckPassed);

        area.innerHTML = `<div class="glass-card-body">
            <h4 style="margin-bottom:1rem;">Pre-Flight Checks</h4>
            <div class="data-table-container"><table class="data-table">
                <thead><tr><th>Check</th><th>Status</th><th>Details</th></tr></thead>
                <tbody>${checks.map(c => {
                    const passed = integrityCheckPassed(c);
                    const label = integrityCheckLabel(c);
                    const details = formatIntegrityDetails(c);
                    return `<tr>
                        <td>${AccountsCommon.escapeHtml(label)}</td>
                        <td><span class="badge ${passed ? 'status-active' : 'status-rejected'}">${passed ? 'PASS' : 'FAIL'}</span></td>
                        <td>${AccountsCommon.escapeHtml(details)}</td>
                    </tr>`;
                }).join('')}</tbody>
            </table></div>
        </div>`;

        if (actionsDiv) actionsDiv.style.display = allPassed ? 'block' : 'none';
    } catch (err) {
        console.error('[Admin] loadYearEndPreflight error:', err);
        area.innerHTML = `<div class="glass-card-body"><div class="empty-message"><p>Failed to run pre-flight checks</p></div></div>`;
        if (actionsDiv) actionsDiv.style.display = 'none';
    }
}

async function closeFinancialYear() {
    const fyId = yearEndFYDropdown?.getValue?.();
    if (!fyId) {
        Toast.error('Please select a fiscal year');
        return;
    }

    const fyName = fiscalYears.find(fy => fy.id === fyId)?.name || fyId;

    const ok1 = await Confirm.danger(`WARNING: You are about to close fiscal year "${fyName}". This action CANNOT be undone. All periods will be locked and balances will be carried forward.\n\nAre you absolutely sure?`, 'Close Fiscal Year');
    if (!ok1) return;
    const ok2 = await Confirm.danger(`FINAL CONFIRMATION: Close fiscal year "${fyName}" permanently?`, 'Final Confirmation');
    if (!ok2) return;

    try {
        const url = AccountsCommon.buildUrl(`closing/year-end/${fyId}`);
        await api.request(url, { method: 'POST' });
        Toast.success(`Fiscal year "${fyName}" closed successfully`);

        // Refresh data
        await loadFiscalYears();
        if (typeof initDropdowns === 'function') initDropdowns();

        document.getElementById('yearEndPreflightArea').innerHTML = `<div class="glass-card-body"><div class="empty-message">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
                <polyline points="22 4 12 14.01 9 11.01"></polyline>
            </svg><p>Fiscal year closed successfully</p></div></div>`;
        document.getElementById('yearEndActions').style.display = 'none';
    } catch (err) {
        console.error('[Admin] closeFinancialYear error:', err);
        Toast.error(err.message || 'Failed to close fiscal year');
    }
}
