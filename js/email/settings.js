/**
 * EmailService — settings page (mailbox CRUD).
 */

const S = { mailboxes: [], editingId: null };

document.addEventListener('DOMContentLoaded', async () => {
    if (!api.isAuthenticated()) { window.location.href = '../login.html'; return; }
    Navigation.init('email', '../');

    document.getElementById('btnAddMailbox').addEventListener('click', () => openMailboxModal(null));
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
    S.mailboxes.forEach(m => {
        const card = document.createElement('div');
        card.className = 'email-mailbox-card';
        let statusClass = 'pending', statusLabel = 'Never connected';
        if (m.last_error) { statusClass = 'error'; statusLabel = 'Connection error'; }
        else if (m.last_connected_at) { statusClass = 'ok'; statusLabel = 'Connected'; }

        card.innerHTML = `
            <div class="mbx-left">
                <div class="mbx-icon">
                    <svg viewBox="0 0 24 24"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
                </div>
                <div>
                    <div class="mbx-name">${escapeHtml(m.display_name || m.email_address)}</div>
                    <div class="mbx-sub">${escapeHtml(m.email_address)} · ${escapeHtml(m.imap_host || '')}:${m.imap_port}</div>
                    ${m.last_error ? `<div class="mbx-err">${escapeHtml(m.last_error)}</div>` : ''}
                </div>
            </div>
            <div class="mbx-status ${statusClass}">${statusLabel}</div>
            <div class="mbx-actions">
                <button data-action="test">Test</button>
                <button data-action="edit">Edit</button>
                <button data-action="delete" class="danger">Delete</button>
            </div>`;
        card.querySelector('[data-action="test"]').addEventListener('click', () => testExistingMailbox(m.id));
        card.querySelector('[data-action="edit"]').addEventListener('click', () => openMailboxModal(m));
        card.querySelector('[data-action="delete"]').addEventListener('click', () => deleteMailbox(m));
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
        is_shared: false,
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
    if (!confirm(`Disconnect "${mbx.email_address}"? IMAP IDLE stops and all cached messages are removed.`)) return;
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
