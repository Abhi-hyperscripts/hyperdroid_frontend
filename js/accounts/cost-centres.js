/**
 * Cost Centres — analytical tags on vendor-bill lines (reporting dimension, no GL impact).
 * Backend: /api/accounts/cost-centres (CRUD + archive) and /cost-centres/spend. Create/edit/archive = ADMIN.
 */

let centresList = [];
let centresPage = 1;   // server-side pagination
let centresTotal = 0;
const PAGE_SIZE = 50;

document.addEventListener('DOMContentLoaded', async () => {
    if (!await AccountsCommon.initPage('cost-centres', '../')) return;

    const tabNames = { 'cc-list': 'Cost Centres', 'cc-spend': 'Spend Report' };
    AccountsCommon.setupSidebar('sidebarToggle', 'accountsSidebar', 'sidebarOverlay', tabNames);
    AccountsCommon.setupTabs(tabNames);

    accountsRoles.applyRBAC();
    AccountsCommon.initDatePickers(['spendFrom', 'spendTo']);
    await loadCentres();
});

async function loadCentres(page = centresPage) {
    try {
        centresPage = page;
        AccountsCommon.setTableLoading('centresTable', 5, 'Loading cost centres…');
        const showInactive = document.getElementById('ccShowInactive')?.checked;
        const params = { limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE };
        if (!showInactive) params.status = 'active';   // hide archived server-side
        const res = await api.request(AccountsCommon.buildUrl('cost-centres', params), { _skipSpinner: true });
        const env = Array.isArray(res) ? { data: res, total: res.length } : (res || {});
        centresList = env.data || [];
        centresTotal = env.total ?? centresList.length;
        renderCentres();
    } catch (err) {
        console.error('[CostCentres] loadCentres error:', err);
        const tb = document.getElementById('centresTable');
        if (tb) tb.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:2rem;color:var(--color-error);">Failed to load cost centres</td></tr>';
    }
}

function renderCentres() {
    const tb = document.getElementById('centresTable');
    if (!tb) return;
    if (!centresList.length) {
        tb.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:2rem;color:var(--text-secondary);">No cost centres yet. Click "New Cost Centre" to create one.</td></tr>';
        AccountsCommon.renderPagination('centresPagination', 1, 1, () => {});
        return;
    }
    const isAdmin = accountsRoles.isAdmin();
    const totalPages = Math.max(1, Math.ceil((centresTotal || centresList.length) / PAGE_SIZE));
    AccountsCommon.renderPagination('centresPagination', centresPage, totalPages, (p) => loadCentres(p));
    tb.innerHTML = centresList.map(c => {
        const active = c.status !== 'inactive';
        const actions = isAdmin ? `
            <button class="btn-icon" onclick="editCentre('${AccountsCommon.escJs(c.id)}')" data-tooltip="Edit"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
            ${active ? `<button class="btn-icon danger" onclick="archiveCentre('${AccountsCommon.escJs(c.id)}')" data-tooltip="Archive"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/><line x1="10" y1="12" x2="14" y2="12"/></svg></button>` : ''}` : '';
        return `<tr>
            <td>${AccountsCommon.escapeHtml(c.code || '-')}</td>
            <td>${AccountsCommon.escapeHtml(c.name || '')}</td>
            <td>${AccountsCommon.escapeHtml(c.description || '-')}</td>
            <td><span class="badge ${active ? 'status-active' : 'status-rejected'}">${active ? 'Active' : 'Archived'}</span></td>
            <td class="actions-cell">${actions}</td>
        </tr>`;
    }).join('');
}

function openCreate() {
    if (!accountsRoles.isAdmin()) { Toast.error('Only an admin can manage cost centres'); return; }
    document.getElementById('ccModalTitle').textContent = 'New Cost Centre';
    document.getElementById('ccId').value = '';
    ['ccName', 'ccCode', 'ccDescription'].forEach(id => { document.getElementById(id).value = ''; });
    AccountsCommon.openModal('ccModal');
}

function editCentre(id) {
    const c = centresList.find(x => x.id === id);
    if (!c) return;
    document.getElementById('ccModalTitle').textContent = 'Edit Cost Centre';
    document.getElementById('ccId').value = c.id;
    document.getElementById('ccName').value = c.name || '';
    document.getElementById('ccCode').value = c.code || '';
    document.getElementById('ccDescription').value = c.description || '';
    AccountsCommon.openModal('ccModal');
}

async function saveCentre() {
    if (!accountsRoles.isAdmin()) { Toast.error('Only an admin can manage cost centres'); return; }
    const id = document.getElementById('ccId').value;
    const name = document.getElementById('ccName').value.trim();
    if (!name) { Toast.error('Name is required'); return; }
    const payload = {
        name,
        code: document.getElementById('ccCode').value.trim() || null,
        description: document.getElementById('ccDescription').value.trim() || null
    };

    if (!AccountsCommon.beginSubmit('saveCentre')) return;
    try {
        if (id) {
            await api.request(AccountsCommon.buildUrl(`cost-centres/${encodeURIComponent(id)}`), { method: 'PUT', body: JSON.stringify(payload) });
            Toast.success('Cost centre updated');
        } else {
            await api.request(AccountsCommon.buildUrl('cost-centres'), { method: 'POST', body: JSON.stringify(payload) });
            Toast.success('Cost centre created');
        }
        AccountsCommon.closeModal('ccModal');
        await loadCentres();
    } catch (err) {
        console.error('[CostCentres] saveCentre error:', err);
        Toast.error(err.message || 'Failed to save cost centre');
    } finally {
        AccountsCommon.endSubmit('saveCentre');
    }
}

async function archiveCentre(id) {
    if (!accountsRoles.isAdmin()) { Toast.error('Only an admin can archive cost centres'); return; }
    const c = centresList.find(x => x.id === id);
    const ok = await Confirm.show({
        title: 'Archive Cost Centre',
        message: `Archive "${c?.name || 'this cost centre'}"? Past bill lines keep their tag and still report; it just can't be used on new bills.`,
        confirmText: 'Archive', type: 'warning'
    });
    if (!ok) return;
    try {
        await api.request(AccountsCommon.buildUrl(`cost-centres/${encodeURIComponent(id)}`), { method: 'DELETE' });
        Toast.success('Cost centre archived');
        await loadCentres();
    } catch (err) {
        console.error('[CostCentres] archiveCentre error:', err);
        Toast.error(err.message || 'Failed to archive');
    }
}

async function loadSpend() {
    const from = document.getElementById('spendFrom').value;
    const to = document.getElementById('spendTo').value;
    const params = {};
    if (from) params.fromDate = from;
    if (to) params.toDate = to;
    const tb = document.getElementById('spendTable');
    try {
        const res = await api.request(AccountsCommon.buildUrl('cost-centres/spend', params), { _skipSpinner: true });
        const data = res?.data || res || {};
        const rows = data.cost_centres || [];
        if (!rows.length) {
            tb.innerHTML = '<tr><td colspan="4" style="text-align:center;padding:2rem;color:var(--text-secondary);">No spend in this period.</td></tr>';
            const ch = document.getElementById('spendCharts');
            if (ch) ch.style.display = 'none';
            _acActiveRender = null;
            return;
        }
        renderSpendCharts(rows);
        _acActiveRender = () => renderSpendCharts(rows);
        tb.innerHTML = rows.map(r => `<tr>
            <td>${AccountsCommon.escapeHtml(r.cost_centre_name || 'Unassigned')}${r.cost_centre_code ? ' <span style="color:var(--text-secondary);font-size:0.8rem;">(' + AccountsCommon.escapeHtml(r.cost_centre_code) + ')</span>' : ''}</td>
            <td style="text-align:right;">${AccountsCommon.formatCurrency(r.spend_ex_tax)}</td>
            <td style="text-align:right;">${AccountsCommon.formatCurrency(r.tax)}</td>
            <td style="text-align:right;font-weight:600;">${AccountsCommon.formatCurrency(r.spend)}</td>
        </tr>`).join('') + `<tr style="border-top:2px solid var(--border-color);">
            <td style="font-weight:700;">Total</td>
            <td style="text-align:right;font-weight:700;">${AccountsCommon.formatCurrency(data.total_spend_ex_tax)}</td>
            <td style="text-align:right;font-weight:700;">${AccountsCommon.formatCurrency(data.total_tax)}</td>
            <td style="text-align:right;font-weight:700;">${AccountsCommon.formatCurrency(data.total_spend)}</td>
        </tr>`;
    } catch (err) {
        console.error('[CostCentres] loadSpend error:', err);
        tb.innerHTML = '<tr><td colspan="4" style="text-align:center;padding:2rem;color:var(--color-error);">Failed to load spend.</td></tr>';
    }
}

// Spend charts — hidden until the first Generate so the tab doesn't open on two empty boxes
function renderSpendCharts(rows) {
    if (typeof acBarH !== 'function') return;
    const host = document.getElementById('spendCharts');
    if (host) host.style.display = '';
    const short = (s) => (s || 'Unassigned').length > 16 ? s.slice(0, 15) + '…' : (s || 'Unassigned');
    const rank = _acRank(rows.map(r => ({ name: short(r.cost_centre_name), amt: parseFloat(r.spend || 0) })), 'name', 'amt', 8);
    rank.labels.length ? acBarH('ccSpendChart', rank.labels, rank.data) : _acEmpty('ccSpendChart');
    const names = rows.map(r => short(r.cost_centre_name));
    acDonut('ccShareChart', names, rows.map(r => Math.round(parseFloat(r.spend || 0) * 100) / 100),
            names.map((n, i) => _acPalette[i % _acPalette.length]));
}
