/**
 * Projects — analytical tags (per customer) on customer-invoice lines. Reporting dimension, no GL impact.
 * Backend: /api/accounts/projects (CRUD + archive) and /projects/customers/{id}/statement. Manage = ADMIN.
 */

let projectsList = [];
let customersList = [];

let prCustomerDropdown = null;
let prStatusDropdown = null;
let stmtCustomerDropdown = null;

const PROJECT_STATUSES = [
    { value: 'active', label: 'Active' },
    { value: 'on_hold', label: 'On Hold' },
    { value: 'completed', label: 'Completed' },
    { value: 'cancelled', label: 'Cancelled' }
];

document.addEventListener('DOMContentLoaded', async () => {
    if (!await AccountsCommon.initPage('projects', '../')) return;
    accountsRoles.applyRBAC();
    await Promise.all([loadProjects(), loadCustomers()]);
    AccountsCommon.initSearchableDropdownsWithRetry(initDropdowns);
});

function initDropdowns() {
    if (typeof SearchableDropdown === 'undefined') { setTimeout(initDropdowns, 100); return; }
    const custOptions = customersList.map(c => ({ value: c.id, label: `${c.name}${c.customer_code ? ' (' + c.customer_code + ')' : ''}` }));

    prCustomerDropdown = new SearchableDropdown(document.getElementById('prCustomerContainer'), {
        options: custOptions, placeholder: 'Select customer...'
    });
    prStatusDropdown = new SearchableDropdown(document.getElementById('prStatusContainer'), {
        options: PROJECT_STATUSES, placeholder: 'Select status...'
    });
    stmtCustomerDropdown = new SearchableDropdown(document.getElementById('stmtCustomerContainer'), {
        options: custOptions, placeholder: 'Select customer...'
    });
}

function showTab(tab) {
    const isList = tab === 'list';
    document.getElementById('listView').style.display = isList ? '' : 'none';
    document.getElementById('stmtView').style.display = isList ? 'none' : '';
    document.getElementById('tabListBtn').className = 'btn btn-sm' + (isList ? '' : ' btn-outline');
    document.getElementById('tabStmtBtn').className = 'btn btn-sm' + (isList ? ' btn-outline' : '');
}

async function loadCustomers() {
    try {
        const res = await api.request(AccountsCommon.buildUrl('customers'), { _skipSpinner: true });
        customersList = Array.isArray(res) ? res : (res?.data || res?.items || []);
    } catch (err) { console.error('[Projects] loadCustomers error:', err); }
}

async function loadProjects() {
    try {
        const res = await api.request(AccountsCommon.buildUrl('projects'), { _skipSpinner: true });
        projectsList = Array.isArray(res) ? res : (res?.data || res?.items || []);
        renderProjects();
    } catch (err) {
        console.error('[Projects] loadProjects error:', err);
        const tb = document.getElementById('projectsTable');
        if (tb) tb.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:2rem;color:var(--color-error);">Failed to load projects</td></tr>';
    }
}

function renderProjects() {
    const tb = document.getElementById('projectsTable');
    if (!tb) return;
    const showArchived = document.getElementById('prShowArchived')?.checked;
    const rows = projectsList.filter(p => showArchived || (p.status !== 'cancelled' && p.status !== 'completed'));
    if (!rows.length) {
        tb.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:2rem;color:var(--text-secondary);">No projects yet. Click "New Project" to create one.</td></tr>';
        return;
    }
    const isAdmin = accountsRoles.isAdmin();
    const statusClass = (s) => s === 'active' ? 'status-active' : (s === 'cancelled' ? 'status-rejected' : 'status-pending');
    tb.innerHTML = rows.map(p => {
        const label = (p.status || '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
        const actions = isAdmin ? `
            <button class="btn-icon" onclick="editProject('${AccountsCommon.escJs(p.id)}')" data-tooltip="Edit"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
            ${(p.status !== 'cancelled') ? `<button class="btn-icon danger" onclick="archiveProject('${AccountsCommon.escJs(p.id)}')" data-tooltip="Cancel project"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg></button>` : ''}` : '';
        return `<tr>
            <td>${AccountsCommon.escapeHtml(p.code || '-')}</td>
            <td>${AccountsCommon.escapeHtml(p.name || '')}</td>
            <td>${AccountsCommon.escapeHtml(p.customer_name || '-')}</td>
            <td style="text-align:right;">${p.budget != null ? AccountsCommon.formatCurrency(p.budget) : '-'}</td>
            <td><span class="badge ${statusClass(p.status)}">${AccountsCommon.escapeHtml(label)}</span></td>
            <td class="actions-cell">${actions}</td>
        </tr>`;
    }).join('');
}

function openCreate() {
    if (!accountsRoles.isAdmin()) { Toast.error('Only an admin can manage projects'); return; }
    document.getElementById('prModalTitle').textContent = 'New Project';
    document.getElementById('prId').value = '';
    ['prName', 'prCode', 'prBudget', 'prStartDate', 'prDescription'].forEach(id => { document.getElementById(id).value = ''; });
    prCustomerDropdown?.setValue?.('');
    prCustomerDropdown?.enable?.();
    document.getElementById('prCustomerLockHint').style.display = 'none';
    document.getElementById('prStatusGroup').style.display = 'none';
    AccountsCommon.openModal('prModal');
}

function editProject(id) {
    const p = projectsList.find(x => x.id === id);
    if (!p) return;
    document.getElementById('prModalTitle').textContent = 'Edit Project';
    document.getElementById('prId').value = p.id;
    document.getElementById('prName').value = p.name || '';
    document.getElementById('prCode').value = p.code || '';
    document.getElementById('prBudget').value = p.budget != null ? p.budget : '';
    document.getElementById('prStartDate').value = p.start_date ? String(p.start_date).slice(0, 10) : '';
    document.getElementById('prDescription').value = p.description || '';
    prCustomerDropdown?.setValue?.(p.customer_id || '');
    // customer_id is immutable on update (backend UpdateProjectRequest has no customer_id)
    document.getElementById('prCustomerLockHint').style.display = '';
    document.getElementById('prStatusGroup').style.display = '';
    prStatusDropdown?.setValue?.(p.status || 'active');
    AccountsCommon.openModal('prModal');
}

async function saveProject() {
    if (!accountsRoles.isAdmin()) { Toast.error('Only an admin can manage projects'); return; }
    const id = document.getElementById('prId').value;
    const name = document.getElementById('prName').value.trim();
    const customerId = prCustomerDropdown?.getValue?.();
    const budgetRaw = document.getElementById('prBudget').value.trim();
    const startDate = document.getElementById('prStartDate').value;

    if (!name) { Toast.error('Project name is required'); return; }
    if (!id && !customerId) { Toast.error('Select the customer for this project'); return; }

    const payload = {
        name,
        code: document.getElementById('prCode').value.trim() || null,
        budget: budgetRaw ? parseFloat(budgetRaw) : null,
        description: document.getElementById('prDescription').value.trim() || null,
        start_date: startDate || null
    };
    if (!id) payload.customer_id = customerId;
    else payload.status = prStatusDropdown?.getValue?.() || 'active';

    if (!AccountsCommon.beginSubmit('saveProject')) return;
    try {
        if (id) {
            await api.request(AccountsCommon.buildUrl(`projects/${encodeURIComponent(id)}`), { method: 'PUT', body: JSON.stringify(payload) });
            Toast.success('Project updated');
        } else {
            await api.request(AccountsCommon.buildUrl('projects'), { method: 'POST', body: JSON.stringify(payload) });
            Toast.success('Project created');
        }
        AccountsCommon.closeModal('prModal');
        await loadProjects();
    } catch (err) {
        console.error('[Projects] saveProject error:', err);
        Toast.error(err.message || 'Failed to save project');
    } finally {
        AccountsCommon.endSubmit('saveProject');
    }
}

async function archiveProject(id) {
    if (!accountsRoles.isAdmin()) { Toast.error('Only an admin can cancel projects'); return; }
    const p = projectsList.find(x => x.id === id);
    const ok = await Confirm.show({
        title: 'Cancel Project',
        message: `Cancel "${p?.name || 'this project'}"? Past invoice lines keep their tag and still report.`,
        confirmText: 'Cancel Project', type: 'warning'
    });
    if (!ok) return;
    try {
        await api.request(AccountsCommon.buildUrl(`projects/${encodeURIComponent(id)}`), { method: 'DELETE' });
        Toast.success('Project cancelled');
        await loadProjects();
    } catch (err) {
        console.error('[Projects] archiveProject error:', err);
        Toast.error(err.message || 'Failed to cancel project');
    }
}

async function loadStatement() {
    const customerId = stmtCustomerDropdown?.getValue?.();
    const tb = document.getElementById('stmtTable');
    if (!customerId) { Toast.error('Select a customer'); return; }
    try {
        const res = await api.request(AccountsCommon.buildUrl(`projects/customers/${encodeURIComponent(customerId)}/statement`), { _skipSpinner: true });
        const data = res?.data || res || {};
        const rows = data.projects || [];
        if (!rows.length) {
            tb.innerHTML = '<tr><td colspan="4" style="text-align:center;padding:2rem;color:var(--text-secondary);">No billing for this customer yet.</td></tr>';
            return;
        }
        tb.innerHTML = rows.map(r => `<tr>
            <td>${AccountsCommon.escapeHtml(r.project_name || 'Unassigned')}${r.project_code ? ' <span style="color:var(--text-secondary);font-size:0.8rem;">(' + AccountsCommon.escapeHtml(r.project_code) + ')</span>' : ''}</td>
            <td style="text-align:right;">${AccountsCommon.formatCurrency(r.billed)}</td>
            <td style="text-align:right;">${AccountsCommon.formatCurrency(r.collected)}</td>
            <td style="text-align:right;font-weight:600;">${AccountsCommon.formatCurrency(r.due)}</td>
        </tr>`).join('') + `<tr style="border-top:2px solid var(--border-color);">
            <td style="font-weight:700;">Total</td>
            <td style="text-align:right;font-weight:700;">${AccountsCommon.formatCurrency(data.total_billed)}</td>
            <td style="text-align:right;font-weight:700;">${AccountsCommon.formatCurrency(data.total_collected)}</td>
            <td style="text-align:right;font-weight:700;">${AccountsCommon.formatCurrency(data.total_due)}</td>
        </tr>`;
    } catch (err) {
        console.error('[Projects] loadStatement error:', err);
        tb.innerHTML = '<tr><td colspan="4" style="text-align:center;padding:2rem;color:var(--color-error);">Failed to load statement.</td></tr>';
    }
}
