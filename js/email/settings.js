/**
 * EmailService — settings page (mailbox CRUD).
 */

const S = { mailboxes: [], editingId: null };

// True for SUPERADMIN or EMAILSERVICE_ADMIN. Drives whether the "Shared mailbox"
// toggle is editable. Non-admins see it disabled with an explanation. Backend
// is also gated (defense in depth) so a manually-crafted payload can't bypass.
function isEmailAdmin() {
    const u = (typeof getStoredUser === 'function') ? getStoredUser() : null;
    const roles = u?.roles || [];
    return roles.includes('SUPERADMIN') || roles.includes('EMAILSERVICE_ADMIN');
}

document.addEventListener('DOMContentLoaded', async () => {
    if (!api.isAuthenticated()) { window.location.href = '../login.html'; return; }
    Navigation.init('email', '../');

    document.getElementById('btnAddMailbox').addEventListener('click', () => openMailboxModal(null));
    // Phase 6a — Connect Gmail kicks off the OAuth dance owned by EmailService.
    // Popup → consent → callback closes via postMessage.
    const gmailBtn = document.getElementById('btnConnectGmail');
    if (gmailBtn) gmailBtn.addEventListener('click', connectGmailOAuth);
    document.getElementById('mailboxModalClose').addEventListener('click', closeMailboxModal);
    document.getElementById('mailboxModal').addEventListener('click', e => {
        if (e.target.id === 'mailboxModal') closeMailboxModal();
    });
    document.getElementById('btnTestConnection').addEventListener('click', testConnection);
    document.getElementById('btnSaveMailbox').addEventListener('click', saveMailbox);

    // Auto-detect IMAP/SMTP settings when the user leaves the email field.
    // Saves typing for everyone and makes the flow work for non-technical users
    // who have no idea what their mail server hostnames are.
    document.getElementById('mbxEmail').addEventListener('blur', handleEmailBlurAutoconfig);
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape' && document.getElementById('mailboxModal').classList.contains('active')) closeMailboxModal();
    });

    // Re-parent the modal to <body> so no ancestor (e.g. main.email-settings
    // which styles.css positions relative) can drop the overlay below the
    // visible viewport.
    const overlay = document.getElementById('mailboxModal');
    if (overlay && overlay.parentElement !== document.body) {
        document.body.appendChild(overlay);
    }

    await loadMailboxes();
});

async function loadMailboxes() {
    const list = document.getElementById('mailboxList');
    list.innerHTML = `
        <div class="email-mailbox-card" style="opacity:0.5;"><div class="mbx-left">
            <div class="mbx-icon" style="background:var(--bg-card-hover);"></div>
            <div><div class="mbx-name">Loading…</div><div class="mbx-sub">Fetching your mailboxes</div></div>
        </div></div>`;
    try {
        const data = await api.request('/email/mailboxes');
        S.mailboxes = Array.isArray(data) ? data : [];
        renderMailboxList();
    } catch (err) {
        list.innerHTML = `<div class="email-settings-empty" style="color:var(--color-danger);">Failed to load: ${escapeHtml(err.message)}</div>`;
    }
}

function renderMailboxList() {
    const list = document.getElementById('mailboxList');
    if (S.mailboxes.length === 0) {
        list.innerHTML = `
            <div class="email-settings-empty">
                <svg viewBox="0 0 24 24">
                    <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
                    <polyline points="22,6 12,13 2,6"/>
                </svg>
                <h3>No mailboxes yet</h3>
                <p>Connect your first IMAP/SMTP account to start syncing mail.</p>
            </div>`;
        return;
    }
    list.innerHTML = '';
    const admin = isEmailAdmin();
    S.mailboxes.forEach(m => {
        const card = document.createElement('div');
        card.className = 'email-mailbox-card';
        let statusClass = 'pending', statusLabel = 'Never connected';
        if (m.last_error) { statusClass = 'error'; statusLabel = 'Connection error'; }
        else if (m.last_connected_at) { statusClass = 'ok'; statusLabel = 'Connected'; }

        // SERVICE = is_shared=TRUE. Tooltip reflects the post-2026-06-18
        // semantics: it's a backend-integration mailbox, not a "team inbox"
        // by default. Humans see it only if they have a subscriber row.
        const sharedBadge = m.is_shared
            ? `<span title="Service mailbox — used by backend integrations like CRM. Add subscribers below to grant human access." style="font-size:10.5px; padding:2px 8px; border-radius:10px; background:var(--brand-primary); color:#fff; font-weight:600; letter-spacing:0.3px;">SERVICE</span>`
            : `<span title="Personal mailbox — only you can see this" style="font-size:10.5px; padding:2px 8px; border-radius:10px; background:var(--bg-card-hover); color:var(--text-secondary); font-weight:600; letter-spacing:0.3px; border:1px solid var(--border-color);">PERSONAL</span>`;

        // Manage Subscribers button: admin-only, shared-mailbox-only.
        const subsButton = (admin && m.is_shared)
            ? `<button data-action="subscribers">Subscribers</button>` : '';

        card.innerHTML = `
            <div class="mbx-left">
                <div class="mbx-icon">
                    <svg viewBox="0 0 24 24"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
                </div>
                <div>
                    <div class="mbx-name" style="display:flex; align-items:center; gap:8px;">
                        ${escapeHtml(m.display_name || m.email_address)}
                        ${sharedBadge}
                    </div>
                    <div class="mbx-sub">${escapeHtml(m.email_address)} · ${escapeHtml(m.imap_host || '')}:${m.imap_port}</div>
                    ${m.last_error ? `<div class="mbx-err">${escapeHtml(m.last_error)}</div>` : ''}
                </div>
            </div>
            <div class="mbx-status ${statusClass}">${statusLabel}</div>
            <div class="mbx-actions">
                <button data-action="test">Test</button>
                ${subsButton}
                <button data-action="edit">Edit</button>
                <button data-action="delete" class="danger">Delete</button>
            </div>`;
        card.querySelector('[data-action="test"]').addEventListener('click', () => testExistingMailbox(m.id));
        card.querySelector('[data-action="edit"]').addEventListener('click', () => openMailboxModal(m));
        card.querySelector('[data-action="delete"]').addEventListener('click', () => deleteMailbox(m));
        const subsBtn = card.querySelector('[data-action="subscribers"]');
        if (subsBtn) subsBtn.addEventListener('click', () => openSubscribersModal(m));
        list.appendChild(card);
    });
}

function openMailboxModal(mbx) {
    S.editingId = mbx ? mbx.id : null;
    document.getElementById('mailboxModalTitle').textContent = mbx ? 'Edit mailbox' : 'Add IMAP/SMTP mailbox';
    document.getElementById('mbxEmail').value = mbx?.email_address || '';
    document.getElementById('mbxDisplay').value = mbx?.display_name || '';
    document.getElementById('mbxImapHost').value = mbx?.imap_host || '';
    document.getElementById('mbxImapPort').value = mbx?.imap_port || 993;
    document.getElementById('mbxImapSsl').value = String(mbx?.imap_use_ssl ?? true);
    document.getElementById('mbxImapUser').value = mbx?.imap_username || '';
    document.getElementById('mbxImapPass').value = '';
    document.getElementById('mbxSmtpHost').value = mbx?.smtp_host || '';
    document.getElementById('mbxSmtpPort').value = mbx?.smtp_port || 465;
    document.getElementById('mbxSmtpSsl').value = String(mbx?.smtp_use_ssl ?? true);
    document.getElementById('mbxSmtpUser').value = mbx?.smtp_username || '';
    document.getElementById('mbxSmtpPass').value = '';
    document.getElementById('mbxEmail').disabled = !!mbx;
    document.getElementById('mbxTestResult').style.display = 'none';

    // Shared toggle — admin-only. Non-admins shouldn't even see the row;
    // dead UI is worse than no UI. Existing mailboxes preserve their
    // current is_shared value on the hidden input so an update PUT
    // doesn't accidentally drop the flag.
    const sharedField = document.getElementById('mbxSharedField');
    const sharedCb = document.getElementById('mbxIsShared');
    sharedCb.checked = !!(mbx?.is_shared);
    const admin = isEmailAdmin();
    sharedField.style.display = admin ? '' : 'none';

    document.getElementById('mailboxModal').classList.add('active');
}

function closeMailboxModal() {
    document.getElementById('mailboxModal').classList.remove('active');
    S.editingId = null;
}

/**
 * Blur handler on the email field — asks the backend to guess IMAP/SMTP
 * settings and fills empty host/port fields so the user doesn't have to.
 * Only overwrites empty fields; if the user already typed something custom we
 * leave it alone. Skipped entirely when editing an existing mailbox.
 */
async function handleEmailBlurAutoconfig() {
    if (S.editingId) return;
    const email = document.getElementById('mbxEmail').value.trim();
    if (!email || !email.includes('@')) return;

    const res = document.getElementById('mbxTestResult');
    res.style.display = 'block';
    res.style.background = 'var(--color-info-light)';
    res.style.color = 'var(--color-info-dark)';
    res.textContent = `Looking up server settings for ${email}…`;

    try {
        const cfg = await api.request(`/email/mailboxes/autoconfig?email=${encodeURIComponent(email)}`, { _skipSpinner: true });
        if (!cfg || !cfg.found) {
            res.style.background = 'var(--color-warning-light)';
            res.style.color = 'var(--color-warning-dark)';
            res.textContent = 'Could not auto-detect server settings — please fill them in manually.';
            return;
        }
        const fillIfEmpty = (id, val) => {
            const el = document.getElementById(id);
            if (el && !el.value && val != null && val !== '') el.value = val;
        };
        fillIfEmpty('mbxImapHost', cfg.imap_host);
        fillIfEmpty('mbxImapPort', cfg.imap_port);
        fillIfEmpty('mbxSmtpHost', cfg.smtp_host);
        fillIfEmpty('mbxSmtpPort', cfg.smtp_port);
        // SSL selects need their value set explicitly (empty-check doesn't apply).
        // Only override if they're still at defaults and the guess differs.
        document.getElementById('mbxImapSsl').value = String(cfg.imap_use_ssl);
        document.getElementById('mbxSmtpSsl').value = String(cfg.smtp_use_ssl);

        const helpLink = cfg.app_password_help_url
            ? ` <a href="${cfg.app_password_help_url}" target="_blank" rel="noopener" style="color:inherit; text-decoration:underline;">App-password help ↗</a>`
            : '';
        res.style.background = 'var(--color-success-light)';
        res.style.color = 'var(--color-success-dark)';
        res.innerHTML = `Auto-detected ${escapeHtml(cfg.provider_display_name || 'provider')}.${helpLink}`;
    } catch (err) {
        res.style.background = 'var(--color-warning-light)';
        res.style.color = 'var(--color-warning-dark)';
        res.textContent = `Auto-detect failed (${err.message}) — please fill server details manually.`;
    }
}

function readForm() {
    return {
        email_address: document.getElementById('mbxEmail').value.trim(),
        display_name: document.getElementById('mbxDisplay').value.trim() || null,
        provider_type: 'imap_smtp',
        is_shared: !!document.getElementById('mbxIsShared').checked,
        imap_host: document.getElementById('mbxImapHost').value.trim(),
        imap_port: parseInt(document.getElementById('mbxImapPort').value, 10) || 993,
        imap_use_ssl: document.getElementById('mbxImapSsl').value === 'true',
        imap_username: document.getElementById('mbxImapUser').value.trim()
            || document.getElementById('mbxEmail').value.trim(),
        imap_password: document.getElementById('mbxImapPass').value,
        smtp_host: document.getElementById('mbxSmtpHost').value.trim(),
        smtp_port: parseInt(document.getElementById('mbxSmtpPort').value, 10) || 465,
        smtp_use_ssl: document.getElementById('mbxSmtpSsl').value === 'true',
        smtp_username: document.getElementById('mbxSmtpUser').value.trim()
            || document.getElementById('mbxImapUser').value.trim()
            || document.getElementById('mbxEmail').value.trim(),
        smtp_password: document.getElementById('mbxSmtpPass').value
            || document.getElementById('mbxImapPass').value,
    };
}

async function testConnection() {
    const form = readForm();
    if (!form.email_address || !form.imap_host || !form.smtp_host) return Toast.error('Email, IMAP host, and SMTP host are required.');
    if (!form.imap_password && !S.editingId) return Toast.error('Password required to test a new mailbox.');
    const res = document.getElementById('mbxTestResult');
    res.style.display = 'block';
    res.style.background = 'var(--color-info-light)'; res.style.color = 'var(--color-info-dark)';
    res.textContent = 'Testing connection…';
    try {
        const out = await api.request('/email/mailboxes/test-connect', { method: 'POST', body: JSON.stringify(form), _skipSpinner: true });
        const parts = [];
        parts.push(`IMAP: ${out.imap_ok ? '✓' : '✗ ' + (out.imap_error || '')}`);
        parts.push(`SMTP: ${out.smtp_ok ? '✓' : '✗ ' + (out.smtp_error || '')}`);
        if (out.imap_ok) parts.push(`IDLE: ${out.supports_idle ? '✓' : 'not supported'}`);
        if (out.imap_ok && out.folders?.length) parts.push(`${out.folders.length} folders`);
        if (out.imap_ok && out.smtp_ok) {
            res.style.background = 'var(--color-success-light)'; res.style.color = 'var(--color-success-dark)';
        } else {
            res.style.background = 'var(--color-danger-light)'; res.style.color = 'var(--color-danger-dark)';
        }
        res.textContent = parts.join('   |   ');
    } catch (err) {
        res.style.background = 'var(--color-danger-light)'; res.style.color = 'var(--color-danger-dark)';
        res.textContent = `Test failed: ${err.message}`;
    }
}

async function testExistingMailbox(id) {
    Toast.info('Testing…');
    try {
        const out = await api.request(`/email/mailboxes/${id}/test`, { method: 'POST', _skipSpinner: true });
        if (out.imap_ok && out.smtp_ok) Toast.success('Connection OK.');
        else Toast.error(`IMAP: ${out.imap_ok ? 'OK' : out.imap_error} / SMTP: ${out.smtp_ok ? 'OK' : out.smtp_error}`);
        await loadMailboxes();
    } catch (err) {
        Toast.error(`Test failed: ${err.message}`);
    }
}

async function saveMailbox() {
    const form = readForm();
    if (!form.email_address || !form.imap_host || !form.smtp_host) return Toast.error('Email, IMAP host and SMTP host are required.');
    if (!S.editingId && !form.imap_password) return Toast.error('IMAP password is required for new mailboxes.');

    const btn = document.getElementById('btnSaveMailbox');
    btn.disabled = true;
    btn.innerHTML = 'Saving…';
    try {
        if (S.editingId) {
            const payload = {
                display_name: form.display_name,
                imap_host: form.imap_host, imap_port: form.imap_port, imap_use_ssl: form.imap_use_ssl, imap_username: form.imap_username,
                smtp_host: form.smtp_host, smtp_port: form.smtp_port, smtp_use_ssl: form.smtp_use_ssl, smtp_username: form.smtp_username,
            };
            if (document.getElementById('mbxImapPass').value) payload.imap_password = form.imap_password;
            if (document.getElementById('mbxSmtpPass').value) payload.smtp_password = form.smtp_password;
            // Only admins see an enabled checkbox; only send is_shared if it
            // actually changed, so non-admin edits don't trigger the BL guard.
            const original = S.mailboxes.find(m => m.id === S.editingId);
            if (isEmailAdmin() && original && original.is_shared !== form.is_shared) {
                payload.is_shared = form.is_shared;
            }
            await api.request(`/email/mailboxes/${S.editingId}`, { method: 'PUT', body: JSON.stringify(payload), _skipSpinner: true });
            Toast.success('Mailbox updated.');
        } else {
            await api.request('/email/mailboxes', { method: 'POST', body: JSON.stringify(form), _skipSpinner: true });
            Toast.success('Mailbox connected.');
        }
        closeMailboxModal();
        await loadMailboxes();

        // The supervisor kicks a worker as soon as POST returns, but the first
        // IMAP connect happens asynchronously (0–15s jitter). Poll briefly so
        // the "Never connected" badge flips to "Connected" without a refresh.
        pollMailboxStatus();
    } catch (err) {
        Toast.error(`Save failed: ${err.message}`);
    } finally {
        btn.disabled = false;
        btn.innerHTML = 'Save';
    }
}

async function pollMailboxStatus() {
    const deadline = Date.now() + 25_000; // give jitter + connect time
    while (Date.now() < deadline) {
        await new Promise(r => setTimeout(r, 2000));
        try {
            const data = await api.request('/email/mailboxes', { _skipSpinner: true });
            const list = Array.isArray(data) ? data : [];
            // Stop polling once every mailbox has either connected or errored —
            // no more "pending" rows to resolve.
            const stillPending = list.some(m => !m.last_connected_at && !m.last_error);
            S.mailboxes = list;
            renderMailboxList();
            if (!stillPending) return;
        } catch { /* transient — keep polling */ }
    }
}

async function deleteMailbox(mbx) {
    const ok = await Confirm.danger(
        `Disconnect "${mbx.email_address}"? IMAP IDLE stops and all cached messages are removed.`,
        'Disconnect mailbox');
    if (!ok) return;
    try {
        await api.request(`/email/mailboxes/${mbx.id}`, { method: 'DELETE' });
        Toast.success('Mailbox disconnected.');
        await loadMailboxes();
    } catch (err) {
        Toast.error(`Delete failed: ${err.message}`);
    }
}

function escapeHtml(s) {
    if (s == null) return '';
    return String(s).replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[c]);
}

// ─── Phase 6a: Google OAuth connect flow ─────────────────────────────────
//
// Hits POST /email/google-oauth/authorize-url to mint a Google consent URL
// (binds tenant + user via state row in oauth_state). Opens that URL in a
// popup; the callback page (GoogleOAuthController.Callback) self-closes via
// postMessage on success/failure. We listen, refresh the mailbox list on
// success, and surface result via toast.
async function connectGmailOAuth() {
    const btn = document.getElementById('btnConnectGmail');
    const originalText = btn ? btn.textContent : '';
    if (btn) { btn.disabled = true; btn.textContent = 'Connecting…'; }

    let popup = null;
    let closeWatcher = null;
    const cleanup = () => {
        window.removeEventListener('message', handler);
        if (closeWatcher) clearInterval(closeWatcher);
        if (btn) {
            btn.disabled = false;
            // Re-render is cheap; rebuild from scratch by re-running
            // the parent click would re-init the SVG. Just restore text.
            btn.textContent = originalText;
        }
    };
    const handler = (e) => {
        const d = e.data;
        if (!d || typeof d !== 'object') return;
        if (d.type === 'gmail-oauth-success') {
            if (typeof showToast === 'function') showToast(d.message || 'Gmail connected', 'success');
            else alert(d.message || 'Gmail connected');
            if (typeof loadMailboxes === 'function') loadMailboxes();
            cleanup();
        } else if (d.type === 'gmail-oauth-error') {
            if (typeof showToast === 'function') showToast(d.message || 'Gmail connection failed', 'error');
            else alert(d.message || 'Gmail connection failed');
            cleanup();
        }
    };
    window.addEventListener('message', handler);

    try {
        const resp = await api.request('/email/google-oauth/authorize-url', {
            method: 'POST',
            body: JSON.stringify({ return_url: window.location.href }),
        });
        if (!resp || !resp.url) throw new Error('Server did not return a consent URL');

        const w = 520, h = 640;
        const left = window.screenX + (window.outerWidth - w) / 2;
        const top  = window.screenY + (window.outerHeight - h) / 2;
        popup = window.open(
            resp.url, 'connect-gmail',
            `width=${w},height=${h},left=${left},top=${top},toolbar=0,menubar=0,location=1,status=0`);

        if (!popup) {
            // Popup blocked — fall back to same-tab nav; user comes back here after consent.
            cleanup();
            window.location.href = resp.url;
            return;
        }

        closeWatcher = setInterval(() => {
            if (popup.closed) cleanup();
        }, 500);
    } catch (e) {
        cleanup();
        console.error('Gmail OAuth start failed:', e);
        if (typeof showToast === 'function') showToast('Could not start Gmail connect: ' + (e.message || e), 'error');
        else alert('Could not start Gmail connect: ' + (e.message || e));
    }
}

// ───── Manage Subscribers (admin-only, shared mailboxes) ───────────────
//
// Backend: /api/mailboxes/{id}/subscribers (GET / POST / DELETE),
// admin-gated server-side. User picker calls /api/users which Auth filters
// to current-tenant only.

const Subs = { mailbox: null, subscribers: [], tenantUsers: [] };

async function openSubscribersModal(mbx) {
    if (!isEmailAdmin()) return; // defense-in-depth — UI button already gates
    Subs.mailbox = mbx;
    document.getElementById('subsModalEmail').textContent = mbx.email_address;
    document.getElementById('subsList').innerHTML = '<div style="color:var(--text-secondary); font-size:13px;">Loading subscribers…</div>';
    document.getElementById('subsAddResult').style.display = 'none';
    document.getElementById('subscribersModal').classList.add('active');

    // Re-parent to body so no positioned ancestor traps the overlay.
    const overlay = document.getElementById('subscribersModal');
    if (overlay && overlay.parentElement !== document.body) document.body.appendChild(overlay);

    // Fetch both in parallel — subs render first; user picker just becomes
    // selectable once it loads.
    await Promise.all([loadSubscribers(), loadTenantUsers()]);
}

function closeSubscribersModal() {
    document.getElementById('subscribersModal').classList.remove('active');
    Subs.mailbox = null;
}

async function loadSubscribers() {
    if (!Subs.mailbox) return;
    try {
        const data = await api.request(`/email/mailboxes/${Subs.mailbox.id}/subscribers`);
        Subs.subscribers = Array.isArray(data) ? data : [];
        renderSubscribers();
    } catch (err) {
        document.getElementById('subsList').innerHTML =
            `<div style="color:var(--color-danger); font-size:13px;">Failed to load: ${escapeHtml(err.message)}</div>`;
    }
}

async function loadTenantUsers() {
    try {
        // Auth returns tenant-scoped user list. Required role for the
        // endpoint includes EMAILSERVICE_ADMIN (loosened 2026-06-18).
        const users = await api.request('/users');
        Subs.tenantUsers = Array.isArray(users) ? users : [];
        renderUserPicker();
    } catch (err) {
        const sel = document.getElementById('subsAddUserSelect');
        sel.innerHTML = `<option value="">Failed to load users: ${escapeHtml(err.message)}</option>`;
        sel.disabled = true;
    }
}

function renderSubscribers() {
    const container = document.getElementById('subsList');
    if (Subs.subscribers.length === 0) {
        container.innerHTML = `<div style="color:var(--text-secondary); font-size:13px;">
            No subscribers yet. Add one below to give that user access in the email UI.</div>`;
        renderUserPicker();
        return;
    }
    container.innerHTML = '';
    Subs.subscribers.forEach(s => {
        const row = document.createElement('div');
        row.style.cssText = 'display:flex; align-items:center; justify-content:space-between; gap:10px; padding:8px 10px; background:var(--bg-card-hover); border-radius:6px; border:1px solid var(--border-color);';
        const user = Subs.tenantUsers.find(u => u.userId === s.user_id);
        const displayLabel = s.display_name || user?.email || s.user_id;
        const roleColor = s.role === 'owner' ? 'var(--brand-primary)' : 'var(--text-secondary)';
        row.innerHTML = `
            <div style="display:flex; flex-direction:column; gap:2px;">
                <div style="font-weight:500; font-size:13px;">${escapeHtml(displayLabel)}</div>
                <div style="font-size:11.5px; color:${roleColor};">${escapeHtml(s.role)}</div>
            </div>
            <button data-action="remove" style="background:transparent; border:1px solid var(--color-danger); color:var(--color-danger); padding:4px 10px; border-radius:5px; font-size:12px; cursor:pointer;">Remove</button>`;
        row.querySelector('[data-action="remove"]').addEventListener('click', () => removeSubscriber(s.user_id));
        container.appendChild(row);
    });
    renderUserPicker();
}

function renderUserPicker() {
    const sel = document.getElementById('subsAddUserSelect');
    sel.disabled = false;
    // Exclude already-subscribed users so the admin can't re-add them.
    const subscribedIds = new Set(Subs.subscribers.map(s => s.user_id));
    const eligible = Subs.tenantUsers.filter(u => !subscribedIds.has(u.userId));
    if (eligible.length === 0) {
        sel.innerHTML = '<option value="">Everyone in the tenant is already subscribed</option>';
        sel.disabled = true;
        return;
    }
    sel.innerHTML = '<option value="">Pick a user…</option>' +
        eligible.map(u => `<option value="${escapeHtml(u.userId)}">${escapeHtml(u.email || u.userId)}</option>`).join('');
}

async function addSubscriber() {
    if (!Subs.mailbox) return;
    const userId = document.getElementById('subsAddUserSelect').value;
    const role   = document.getElementById('subsAddRoleSelect').value;
    const res = document.getElementById('subsAddResult');
    if (!userId) {
        res.style.display = 'block';
        res.style.background = 'var(--color-warning-light)';
        res.style.color = 'var(--color-warning-dark)';
        res.textContent = 'Pick a user first.';
        return;
    }
    try {
        await api.request(`/email/mailboxes/${Subs.mailbox.id}/subscribers`, {
            method: 'POST',
            body: JSON.stringify({ user_id: userId, role: role }),
        });
        res.style.display = 'block';
        res.style.background = 'var(--color-success-light)';
        res.style.color = 'var(--color-success-dark)';
        res.textContent = 'Added.';
        await loadSubscribers();
    } catch (err) {
        res.style.display = 'block';
        res.style.background = 'var(--color-danger-light)';
        res.style.color = 'var(--color-danger-dark)';
        res.textContent = 'Failed: ' + err.message;
    }
}

async function removeSubscriber(targetUserId) {
    if (!Subs.mailbox) return;
    // Confirm — match the existing delete-mailbox pattern.
    const ok = typeof Confirm !== 'undefined' && Confirm.show
        ? await Confirm.show({
            title: 'Remove subscriber',
            message: 'They will lose access to this mailbox until re-added.',
            confirmText: 'Remove',
            danger: true,
          })
        : confirm('Remove this subscriber? They will lose access until re-added.');
    if (!ok) return;
    try {
        await api.request(`/email/mailboxes/${Subs.mailbox.id}/subscribers/${encodeURIComponent(targetUserId)}`, {
            method: 'DELETE',
        });
        await loadSubscribers();
    } catch (err) {
        if (typeof showToast === 'function') showToast('Failed to remove: ' + err.message, 'error');
        else alert('Failed to remove: ' + err.message);
    }
}

// Wire modal controls once DOM is ready (after the initial DOMContentLoaded
// handler at the top of this file completes, the modal element exists).
document.addEventListener('DOMContentLoaded', () => {
    const close = document.getElementById('subscribersModalClose');
    const done  = document.getElementById('subscribersModalDone');
    const overlay = document.getElementById('subscribersModal');
    const addBtn = document.getElementById('subsAddBtn');
    if (close)   close.addEventListener('click', closeSubscribersModal);
    if (done)    done.addEventListener('click', closeSubscribersModal);
    if (addBtn)  addBtn.addEventListener('click', addSubscriber);
    if (overlay) overlay.addEventListener('click', e => {
        if (e.target.id === 'subscribersModal') closeSubscribersModal();
    });
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape' && overlay && overlay.classList.contains('active')) closeSubscribersModal();
    });
});
