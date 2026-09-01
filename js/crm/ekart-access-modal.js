/**
 * E-kart access — the REP side. One modal, self-injected, opened from the lead or contact
 * detail panel: shows whether the person has e-kart access, issues (or rotates) the
 * credential, and revokes it. The generated password appears ONCE, here, and nowhere else —
 * the rep copies it and shares it with the client over WhatsApp or the phone.
 *
 * Mirrors js/crm/lead-qr-modal.js: an IIFE with its own escapeHtml, the leads.html modal
 * class dance (display '' → .gm-animating → .active), Toast for feedback, Confirm for revoke.
 */
(function () {
    'use strict';

    let kind = 'lead';      // 'lead' | 'contact'
    let entityId = null;
    let closeTimer = null;

    const esc = (s) => String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

    function ensureModal() {
        if (document.getElementById('ekartAccessModal')) return;
        const el = document.createElement('div');
        el.id = 'ekartAccessModal';
        el.className = 'modal';
        el.style.display = 'none';
        el.innerHTML = `
            <div class="modal-content" style="max-width:520px">
                <div class="modal-header">
                    <h3 style="margin:0">E-kart access</h3>
                    <button type="button" class="close-btn" onclick="closeEkartAccessModal()" aria-label="Close">&times;</button>
                </div>
                <div class="modal-body" id="ekartAccessBody" style="min-height:120px"></div>
            </div>`;
        el.addEventListener('click', (e) => { if (e.target === el) closeEkartAccessModal(); });
        document.body.appendChild(el);
    }

    async function openEkartAccessModal(entityKind, id) {
        if (!id) { Toast.error('Open a record first.'); return; }
        kind = entityKind; entityId = id;
        ensureModal();
        const modal = document.getElementById('ekartAccessModal');
        // A close scheduled 200ms ago would hide the modal we are re-opening, 200ms after it appears.
        //
        // It does NOT rescue the password: renderStatus() below repaints the body on every open, and
        // shown-exactly-once is the design. Saying otherwise here would have told the next reader that
        // re-opening recovers a password the rep did not copy, which it does not — they must issue a
        // new one.
        if (closeTimer) { clearTimeout(closeTimer); closeTimer = null; }
        modal.style.display = '';
        modal.classList.add('gm-animating');
        requestAnimationFrame(() => modal.classList.add('active'));
        await renderStatus();
    }

    function closeEkartAccessModal() {
        const modal = document.getElementById('ekartAccessModal');
        if (!modal) return;
        modal.classList.remove('active');
        closeTimer = setTimeout(() => {
            closeTimer = null;
            modal.classList.remove('gm-animating');
            modal.style.display = 'none';
            // The password is shown once and this modal says it is not stored — so do not keep it in the DOM
            // for the life of the page, where devtools, an extension or any other script can read it back.
            const b = body(); if (b) b.innerHTML = '';
        }, 200);
    }

    const body = () => document.getElementById('ekartAccessBody');
    const q = () => `${kind === 'lead' ? 'lead_id' : 'contact_id'}=${encodeURIComponent(entityId)}`;

    async function renderStatus() {
        body().innerHTML = '<p style="color:var(--text-secondary)">Loading…</p>';
        let status = null;
        try {
            status = await api.request(`/crm/ekart-access/status?${q()}`);
        } catch (err) {
            // ONLY the absent case falls through to the "issue" pitch. A scope refusal is also a 404 (it
            // says "Lead not found." deliberately), and matching /not found/ swallowed it — the modal then
            // offered a button that refuses again on click.
            if (!/No e-kart access issued/i.test(String(err && err.message))) {
                body().innerHTML = `<p style="color:var(--color-error,#ef4444)">${esc(err.message || 'Could not load e-kart status.')}</p>`;
                return;
            }
        }
        if (!status || !status.access_id) {
            body().innerHTML = `
                <p style="color:var(--text-secondary);font-size:.9rem;line-height:1.5">
                    Give this ${kind} a login to your product catalogue. They browse items with photos and
                    descriptions, add quantities to a cart, and submit it — it lands here as an
                    <b>inquiry deal</b> for you to price. Nothing is ordered or reserved.
                </p>
                <button class="btn btn-primary" id="ekartIssueBtn" style="margin-top:10px">Issue e-kart access</button>`;
            document.getElementById('ekartIssueBtn').addEventListener('click', () => issue(false));
            return;
        }
        const state = status.revoked ? 'Revoked' : (status.locked ? 'Locked (failed logins)' : 'Active');
        body().innerHTML = `
            <div style="display:grid;grid-template-columns:auto 1fr;gap:6px 14px;font-size:.9rem">
                <span style="color:var(--text-secondary)">Login id</span><b style="font-family:monospace">${esc(status.login_id)}</b>
                <span style="color:var(--text-secondary)">Status</span><b>${esc(state)}</b>
                <span style="color:var(--text-secondary)">Issued</span><span>${esc(new Date(status.created_at).toLocaleString())}</span>
            </div>
            ${status.portal_url ? `<div style="display:flex;gap:8px;align-items:center;margin-top:10px">
                <input class="form-input" readonly value="${esc(status.portal_url)}" id="ekartStatusUrl" style="font-size:.8rem">
                <button class="btn btn-sm btn-outline-secondary" data-copy="ekartStatusUrl">Copy link</button>
            </div>` : ''}
            <p style="color:var(--text-secondary);font-size:.8rem;margin:12px 0 10px">
                The password is never stored or shown again. Copy the link above to re-send it. Issuing a
                new password keeps the same login id, replaces the old password and signs out every open
                session${status.revoked ? ' (and re-enables the revoked access)' : ''}.
            </p>
            <div style="display:flex;gap:8px">
                <button class="btn btn-primary" id="ekartRotateBtn">Issue new password</button>
                ${status.revoked ? '' : '<button class="btn btn-outline-danger" id="ekartRevokeBtn">Revoke access</button>'}
            </div>`;
        body().querySelectorAll('[data-copy]').forEach((btn) => btn.addEventListener('click', () => copyValue(btn)));
        document.getElementById('ekartRotateBtn').addEventListener('click', () => rotate(status.revoked));
        const revokeBtn = document.getElementById('ekartRevokeBtn');
        if (revokeBtn) revokeBtn.addEventListener('click', () => revoke(status.access_id));
    }

    async function issue(isRotate) {
        try {
            const payload = kind === 'lead' ? { lead_id: entityId } : { contact_id: entityId };
            const issued = await api.request('/crm/ekart-access/issue', {
                method: 'POST', body: JSON.stringify(payload),
            });
            renderIssued(issued, isRotate);
        } catch (err) {
            Toast.error((err && err.message) || 'Could not issue e-kart access.');
        }
    }

    function renderIssued(issued, isRotate) {
        body().innerHTML = `
            <p style="font-size:.85rem;color:var(--color-warning,#f59e0b);margin:0 0 10px">
                ⚠ This password is shown <b>once</b>. Copy it now and share it with the client —
                it is not stored and cannot be recovered, only re-issued.
            </p>
            <div style="display:grid;grid-template-columns:auto 1fr auto;gap:8px 12px;align-items:center;font-size:.9rem">
                <span style="color:var(--text-secondary)">Portal</span>
                <input class="form-input" readonly value="${esc(issued.portal_url)}" id="ekartFldUrl" style="font-size:.8rem">
                <button class="btn btn-sm btn-outline-secondary" data-copy="ekartFldUrl">Copy</button>
                <span style="color:var(--text-secondary)">Login id</span>
                <input class="form-input" readonly value="${esc(issued.login_id)}" id="ekartFldLogin" style="font-family:monospace">
                <button class="btn btn-sm btn-outline-secondary" data-copy="ekartFldLogin">Copy</button>
                <span style="color:var(--text-secondary)">Password</span>
                <input class="form-input" readonly value="${esc(issued.password)}" id="ekartFldPw" style="font-family:monospace">
                <button class="btn btn-sm btn-outline-secondary" data-copy="ekartFldPw">Copy</button>
            </div>
            <button class="btn btn-sm btn-outline-secondary" id="ekartCopyAllBtn" style="margin-top:12px">Copy all as a message</button>
            <p style="color:var(--text-secondary);font-size:.78rem;margin:10px 0 0">

                ${isRotate ? 'The old password stopped working the moment this one was issued, and every open session was signed out.' : 'Their submissions will appear as deals tagged <b>ekart-inquiry</b>.'}
            </p>`;
        body().querySelectorAll('[data-copy]').forEach((btn) => btn.addEventListener('click', () => copyValue(btn)));
        document.getElementById('ekartCopyAllBtn').addEventListener('click', () => copyText(
            `Browse our catalogue and send us your requirement here:\n${issued.portal_url}\nLogin id: ${issued.login_id}\nPassword: ${issued.password}`,
            document.getElementById('ekartCopyAllBtn')));
    }

    function copyValue(btn) {
        const field = document.getElementById(btn.getAttribute('data-copy'));
        copyText(field.value, btn);
    }

    function copyText(text, btn) {
        const done = () => {
            if (!btn) return;
            const old = btn.textContent;
            btn.textContent = 'Copied';
            setTimeout(() => { btn.textContent = old; }, 1600);
        };
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(done).catch(() => fallbackCopy(text, done));
        } else {
            fallbackCopy(text, done);
        }
    }

    function fallbackCopy(text, done) {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed'; ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand('copy'); done(); } catch { Toast.error('Could not copy'); }
        document.body.removeChild(ta);
    }

    // Revoke asked before acting and rotate did not, which is the wrong way round. Revoke is the
    // recoverable one — issue a fresh password and the client is back. A stray rotate silently kills a
    // credential the rep has already sent the client over WhatsApp, and the client discovers it, not
    // the rep. Re-enabling a revoked access is the one case worth doing without a prompt in the way,
    // since that is the button's whole purpose there.
    async function rotate(reEnabling) {
        if (!reEnabling) {
            const ok = await Confirm.show({
                title: 'Issue a new password?',
                message: 'The password you sent them stops working immediately and every open session ends. '
                       + 'They cannot use the catalogue again until you send them the new one.',
                type: 'danger',
                confirmText: 'Issue new password',
            });
            if (!ok) return;
        }
        await issue(true);
    }

    async function revoke(accessId) {
        const ok = await Confirm.show({
            title: 'Revoke e-kart access?',
            message: 'Their login stops working immediately and every open session ends. You can issue a fresh password later to re-enable it.',
            type: 'danger',
            confirmText: 'Revoke',
        });
        if (!ok) return;
        try {
            await api.request(`/crm/ekart-access/${accessId}/revoke`, { method: 'POST' });
            Toast.success('E-kart access revoked');
            await renderStatus();
        } catch (err) {
            Toast.error((err && err.message) || 'Could not revoke.');
        }
    }

    window.openEkartAccessModal = openEkartAccessModal;
    window.closeEkartAccessModal = closeEkartAccessModal;
})();
