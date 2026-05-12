// ── PMS Admin page ──────────────────────────────────────────────────
// Hosts the Danger Zone (Wipe All PMS Data). Gated to SUPERADMIN on the
// client AND enforced server-side on /api/pms-admin/wipe-all.

(function () {
    // Page scripts are injected via document.write — by the time admin.js runs,
    // DOMContentLoaded may have already fired, so guard against both states.
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    function init() {
        if (!api.isAuthenticated()) {
            window.location.href = '../login.html';
            return;
        }

        if (typeof Navigation !== 'undefined') {
            Navigation.init('pms', '../');
        }

        const roles = readRolesFromJwt();
        const isSuperadmin = roles.includes('SUPERADMIN');

        if (!isSuperadmin) {
            document.getElementById('notSuperadminMessage').style.display = 'block';
            return;
        }

        document.getElementById('adminContent').style.display = 'block';
        wireWipeFlow();
    }

    function readRolesFromJwt() {
        try {
            const tok = localStorage.getItem('ragenaizer_authToken') || '';
            const payload = JSON.parse(atob(tok.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
            const role = payload['http://schemas.microsoft.com/ws/2008/06/identity/claims/role']
                || payload['role']
                || payload['roles']
                || [];
            return Array.isArray(role) ? role : [role];
        } catch { return []; }
    }

    function readTenantIdFromJwt() {
        try {
            const tok = localStorage.getItem('ragenaizer_authToken') || '';
            const payload = JSON.parse(atob(tok.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
            return payload.tenant_id || '(unknown)';
        } catch { return '(unknown)'; }
    }

    function wireWipeFlow() {
        const wipeBtn       = document.getElementById('wipeAllBtn');
        const modal         = document.getElementById('wipeModal');
        const tenantSpan    = document.getElementById('wipeTenantId');
        const input         = document.getElementById('wipeConfirmInput');
        const confirmBtn    = document.getElementById('wipeConfirmBtn');
        const closeBtn      = document.getElementById('wipeModalCloseBtn');
        const cancelBtn     = document.getElementById('wipeCancelBtn');
        const resultModal   = document.getElementById('wipeResultModal');
        const resultClose   = document.getElementById('wipeResultCloseBtn');
        const resultDone    = document.getElementById('wipeResultDoneBtn');
        const resultSummary = document.getElementById('wipeResultSummary');

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
                const res = await api.request('/pms/pms-admin/wipe-all', {
                    method: 'POST',
                    body: JSON.stringify({ Confirm: 'WIPE' })
                });
                closeModal();
                showResult(res);
            } catch (err) {
                console.error('[PMS admin] wipe failed', err);
                Toast?.error?.(err?.message || 'Wipe failed');
                confirmBtn.disabled = false;
                confirmBtn.textContent = 'Wipe Now';
            }
        });

        function showResult(res) {
            const pmsRows   = res?.pms?.totalRowsDeleted ?? 0;
            const pmsTables = res?.pms?.tableCount ?? 0;
            const drvS3     = res?.drive?.s3ObjectsDeleted ?? 0;
            const errors    = res?.errors || [];

            const ok = res?.success === true && errors.length === 0;
            document.getElementById('wipeResultTitle').textContent =
                ok ? 'Wipe Complete' : 'Wipe finished with issues';
            document.getElementById('wipeResultTitle').style.color =
                ok ? 'var(--color-success, #10b981)' : 'var(--color-warning, #f59e0b)';

            resultSummary.innerHTML = `
                <div style="margin-bottom:10px;"><strong>PMS</strong> — ${pmsRows.toLocaleString()} rows across ${pmsTables} tables deleted.</div>
                <div style="margin-bottom:10px;"><strong>Drive</strong> — ${drvS3.toLocaleString()} S3 objects deleted under <code>pms/{tenant}/</code>.</div>
                ${errors.length ? `<div style="margin-top:12px; padding:10px; border-radius:6px; background:rgba(245,158,11,0.08); border:1px solid var(--color-warning, #f59e0b); color:var(--text-primary); font-size:0.88rem;"><strong>Non-fatal warnings:</strong><ul style="margin:6px 0 0 18px;">${errors.map(e => `<li>${escapeHtml(e)}</li>`).join('')}</ul></div>` : ''}
            `;
            openResult();
        }

        function closeResult() {
            hideResult();
            window.location.href = 'dashboard.html';
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
})();
