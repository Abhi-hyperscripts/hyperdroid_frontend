// ── HRMS Employees → Managers List tab ────────────────────────────────
// Read-only roster of every active employee who holds one of the
// manager-or-above roles (HRMS_MANAGER, HRMS_HR_MANAGER, HRMS_ADMIN,
// HRMS_HR_ADMIN, SUPERADMIN). Columns: Employee | Department | Office
// | Country | Roles.

window.ManagersList = (function () {
    let initialized = false;
    let listRows = [];
    let filteredRows = [];
    let pagination = null;

    function ensureInit() {
        if (initialized) return;
        initialized = true;
        wire();
        load();
    }

    function wire() {
        document.getElementById('managersListSearch')?.addEventListener('input', applyFilters);
        document.getElementById('managersListRefreshBtn')?.addEventListener('click', () => load(true));
    }

    async function load(fromRefresh) {
        const body = document.getElementById('managersListBody');
        if (!body) return;
        if (fromRefresh) {
            body.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:24px; color:var(--text-secondary);">Refreshing…</td></tr>';
        }
        try {
            const res = await api.request('/hrms/employee-manager-bulk/managers-list');
            listRows = (res && res.rows) || [];
            applyFilters();
        } catch (err) {
            console.error('[ManagersList] load failed', err);
            body.innerHTML = `<tr><td colspan="5" style="text-align:center; padding:24px; color:var(--color-error, #ef4444);">Failed to load: ${escapeHtml(err?.message || 'unknown error')}</td></tr>`;
        }
    }

    function applyFilters() {
        const q = (document.getElementById('managersListSearch')?.value || '').trim().toLowerCase();
        filteredRows = !q
            ? listRows.slice()
            : listRows.filter((r) =>
                [r.full_name, r.email, r.employee_code, r.department_name, r.office_name, r.country, (r.manager_roles || []).join(' ')]
                    .some((v) => String(v || '').toLowerCase().includes(q))
            );

        const stats = document.getElementById('managersListStats');
        if (stats) {
            const byRole = countByRole(listRows);
            stats.innerHTML = [
                chip('Total', listRows.length, 'stat-total'),
                chip('HR Admins', byRole.HRMS_HR_ADMIN || 0, 'stat-valid'),
                chip('Managers', (byRole.HRMS_MANAGER || 0) + (byRole.HRMS_HR_MANAGER || 0), 'stat-valid'),
                chip('Admins', byRole.HRMS_ADMIN || 0, 'stat-valid'),
                chip('Superadmins', byRole.SUPERADMIN || 0, 'stat-valid'),
            ].join('');
        }

        if (!pagination && typeof createTablePagination !== 'undefined') {
            pagination = createTablePagination('managersListPagination', {
                containerSelector: '#managersListPagination',
                data: filteredRows,
                rowsPerPage: 25,
                rowsPerPageOptions: [10, 25, 50, 100],
                onPageChange: (pageData) => render(pageData),
            });
        } else if (pagination) {
            pagination.setData(filteredRows);
        } else {
            render(filteredRows);
        }
    }

    function countByRole(rows) {
        const counts = {};
        rows.forEach((r) => (r.manager_roles || []).forEach((role) => {
            counts[role] = (counts[role] || 0) + 1;
        }));
        return counts;
    }

    function chip(label, n, cls) {
        return `<div class="stat-item ${cls}"><span class="stat-value">${n}</span><span class="stat-label">${label}</span></div>`;
    }

    function render(pageData) {
        const body = document.getElementById('managersListBody');
        if (!body) return;
        const rows = pageData || filteredRows;
        if (!rows || rows.length === 0) {
            body.innerHTML = `<tr><td colspan="5" style="text-align:center; padding:24px; color:var(--text-secondary);">
                ${listRows.length === 0 ? 'No managers found.' : 'No rows match the current search.'}
            </td></tr>`;
            return;
        }
        body.innerHTML = rows.map((r) => {
            const roleBadges = (r.manager_roles || []).map((role) => roleBadge(role)).join(' ');
            return `
                <tr>
                    <td>
                        <div style="font-weight:600;">${escapeHtml(r.full_name || '—')}</div>
                        <div style="color:var(--text-secondary); font-size:0.78rem;">
                            <span style="font-family:monospace;">${escapeHtml(r.employee_code || '')}</span>
                            &nbsp;·&nbsp;
                            <span style="font-family:monospace;">${escapeHtml(r.email || '')}</span>
                        </div>
                    </td>
                    <td>${escapeHtml(r.department_name || '—')}</td>
                    <td>${escapeHtml(r.office_name || '—')}</td>
                    <td>${escapeHtml(r.country || '—')}</td>
                    <td><div style="display:flex; flex-wrap:wrap; gap:4px;">${roleBadges}</div></td>
                </tr>`;
        }).join('');
    }

    function roleBadge(role) {
        const tone = {
            SUPERADMIN:       { bg: 'rgba(139,92,246,0.18)', fg: '#c4b5fd', border: 'rgba(139,92,246,0.45)' },
            HRMS_ADMIN:       { bg: 'rgba(244,114,182,0.15)', fg: '#f9a8d4', border: 'rgba(244,114,182,0.45)' },
            HRMS_HR_ADMIN:    { bg: 'rgba(251,146,60,0.15)',  fg: '#fdba74', border: 'rgba(251,146,60,0.45)'  },
            HRMS_HR_MANAGER:  { bg: 'rgba(14,165,233,0.15)',  fg: '#7dd3fc', border: 'rgba(14,165,233,0.45)'  },
            HRMS_MANAGER:     { bg: 'rgba(16,185,129,0.15)',  fg: '#6ee7b7', border: 'rgba(16,185,129,0.45)'  },
        }[role] || { bg: 'rgba(255,255,255,0.05)', fg: 'var(--text-secondary)', border: 'rgba(255,255,255,0.15)' };
        return `<span style="display:inline-block; padding:2px 8px; border-radius:999px; background:${tone.bg}; color:${tone.fg}; border:1px solid ${tone.border}; font-size:0.72rem; font-weight:600; letter-spacing:0.02em;">${escapeHtml(role)}</span>`;
    }

    function escapeHtml(s) {
        return String(s ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    return { ensureInit };
})();
