// ─────────────────────────────────────────────────────────────────────────
// CRM Settings → Mailboxes tab
//
// Two sections:
//   (A) OAuth Apps (BYOC)  — admin registers their tenant's own Google /
//       Microsoft OAuth app credentials. Stored encrypted in Auth service.
//   (B) Connected Mailboxes — each user connects their own mailbox.
//       Gmail / M365 → OAuth redirect (requires an app from A)
//       Everything else → IMAP / SMTP with password (MailKit verifies)
//
// Autoconfig: Mozilla Thunderbird lookup via /api/mailboxes/autoconfig
// pre-fills IMAP host/port for ~every major mail provider.
// ─────────────────────────────────────────────────────────────────────────

(function () {
    // Module-level state
    let oauthApps = [];
    let mailboxes = [];
    let oauthAppProvider = 'google';
    let autoconfigResult = null;

    // ─── Load / render ─────────────────────────────────────────────────────

    window.loadMailboxesTab = async function () {
        handleCallbackBanner();
        await Promise.all([loadOAuthApps(), loadMailboxes()]);
    };

    async function loadOAuthApps() {
        try {
            const resp = await api.request('/tenant-oauth-apps');
            oauthApps = (resp && resp.apps) || [];
        } catch (e) {
            console.error('Failed to load OAuth apps:', e);
            oauthApps = [];
        }
        renderOAuthApps();
    }

    async function loadMailboxes() {
        try {
            const resp = await api.request('/mailboxes');
            mailboxes = (resp && resp.mailboxes) || [];
        } catch (e) {
            console.error('Failed to load mailboxes:', e);
            mailboxes = [];
        }
        renderMailboxes();
    }

    function renderOAuthApps() {
        const wrap = document.getElementById('oauthAppsTableWrapper');
        const empty = document.getElementById('oauthAppsEmpty');
        const tbody = document.getElementById('oauthAppsTableBody');
        if (!tbody) return;

        if (!oauthApps.length) {
            wrap.style.display = 'none';
            empty.style.display = 'block';
            return;
        }
        empty.style.display = 'none';
        wrap.style.display = 'block';

        tbody.innerHTML = oauthApps.map(a => {
            const providerLabel = a.provider === 'google' ? 'Google' : 'Microsoft';
            const statusBadge = a.isActive
                ? '<span class="crm-badge crm-badge-active">Active</span>'
                : '<span class="crm-badge crm-badge-inactive">Inactive</span>';
            return `
                <tr>
                    <td><strong>${escapeHtml(providerLabel)}</strong></td>
                    <td style="font-family: monospace; font-size: 0.85em;">${escapeHtml(truncate(a.clientId, 40))}</td>
                    <td class="hide-mobile" style="font-family: monospace; font-size: 0.8em;">${escapeHtml(truncate(a.redirectUri, 50))}</td>
                    <td>${statusBadge}</td>
                    <td>
                        <button class="btn btn-sm btn-outline" onclick="deleteOAuthApp('${a.id}', '${escapeHtml(providerLabel)}')">
                            Delete
                        </button>
                    </td>
                </tr>
            `;
        }).join('');
    }

    function renderMailboxes() {
        const wrap = document.getElementById('mailboxesTableWrapper');
        const empty = document.getElementById('mailboxesEmpty');
        const tbody = document.getElementById('mailboxesTableBody');
        if (!tbody) return;

        if (!mailboxes.length) {
            wrap.style.display = 'none';
            empty.style.display = 'block';
            return;
        }
        empty.style.display = 'none';
        wrap.style.display = 'block';

        const typeLabels = {
            'gmail_oauth': 'Gmail',
            'microsoft_oauth': 'Microsoft 365',
            'imap_smtp': 'IMAP / SMTP'
        };

        tbody.innerHTML = mailboxes.map(m => {
            const typeLabel = typeLabels[m.connectionType] || m.connectionType;
            const scope = m.userId ? 'Personal' : 'Tenant-shared';
            const status = !m.isActive
                ? `<span class="crm-badge crm-badge-inactive" title="${escapeHtml(m.lastError || '')}">Inactive</span>`
                : m.isVerified
                    ? '<span class="crm-badge crm-badge-active">Verified</span>'
                    : '<span class="crm-badge crm-badge-pending">Not verified</span>';
            const idle = m.connectionType === 'imap_smtp'
                ? (m.supportsIdle === true ? '✓' : m.supportsIdle === false ? '—' : '?')
                : 'push';

            return `
                <tr>
                    <td><strong>${escapeHtml(m.emailAddress)}</strong>${m.displayName ? `<br><small>${escapeHtml(m.displayName)}</small>` : ''}</td>
                    <td>${typeLabel}</td>
                    <td class="hide-mobile">${scope}</td>
                    <td>${status}</td>
                    <td class="hide-mobile" title="${m.connectionType === 'imap_smtp' ? 'IMAP IDLE support' : 'Uses push notifications'}">${idle}</td>
                    <td>
                        <button class="btn btn-sm btn-outline" onclick="openMailboxSyncLogs('${m.id}', '${escapeHtml(m.emailAddress)}')">Logs</button>
                        <button class="btn btn-sm btn-outline" onclick="deleteMailbox('${m.id}', '${escapeHtml(m.emailAddress)}')">
                            Disconnect
                        </button>
                    </td>
                </tr>
            `;
        }).join('');
    }

    // ─── Callback banner (after OAuth redirect) ────────────────────────────

    function handleCallbackBanner() {
        const params = new URLSearchParams(window.location.search);
        const connected = params.get('connected');
        const error = params.get('error');

        if (connected) {
            const ok = document.getElementById('mailboxConnectedAlert');
            const txt = document.getElementById('mailboxConnectedAlertText');
            if (ok && txt) {
                txt.textContent = `Mailbox ${connected} connected.`;
                ok.style.display = 'flex';
                setTimeout(() => ok.style.display = 'none', 8000);
            }
        }
        if (error) {
            const err = document.getElementById('mailboxErrorAlert');
            const txt = document.getElementById('mailboxErrorAlertText');
            if (err && txt) {
                txt.textContent = prettifyError(error);
                err.style.display = 'flex';
                setTimeout(() => err.style.display = 'none', 10000);
            }
        }

        if (connected || error) {
            // Clean up the URL so a refresh doesn't re-show the banner
            const url = new URL(window.location);
            url.searchParams.delete('connected');
            url.searchParams.delete('error');
            window.history.replaceState({}, '', url);
        }
    }

    // ─── OAuth App modal (BYOC) ────────────────────────────────────────────

    window.openOAuthAppModal = function () {
        oauthAppProvider = 'google';
        setOAuthAppProvider('google');
        document.getElementById('oauthAppClientId').value = '';
        document.getElementById('oauthAppClientSecret').value = '';
        document.getElementById('oauthAppRedirectUri').value = buildRedirectUri('google');
        document.getElementById('oauthAppModal').classList.add('active');
    };

    window.closeOAuthAppModal = function () {
        document.getElementById('oauthAppModal').classList.remove('active');
    };

    window.setOAuthAppProvider = function (provider) {
        oauthAppProvider = provider;
        document.querySelectorAll('#oauthAppProviderPicker .provider-btn').forEach(b => {
            b.classList.toggle('active', b.dataset.provider === provider);
        });
        document.getElementById('oauthAppRedirectUri').value = buildRedirectUri(provider);

        const help = document.getElementById('oauthAppHelp');
        if (provider === 'google') {
            help.innerHTML = `
                <strong>Google setup:</strong> Go to
                <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noopener">Google Cloud Console &rarr; APIs &amp; Services &rarr; Credentials</a>,
                create an OAuth 2.0 Client ID of type <em>Web application</em>, add the redirect URI above,
                then paste the Client ID + Secret here. Enable the <strong>Gmail API</strong> in the same project.
                If your users are on Google Workspace, your admin can mark this app as "Trusted" in the Admin Console
                to skip Google's app-verification review.
            `;
        } else {
            help.innerHTML = `
                <strong>Microsoft setup:</strong> Go to
                <a href="https://portal.azure.com/#blade/Microsoft_AAD_RegisteredApps" target="_blank" rel="noopener">Azure Portal &rarr; App registrations</a>,
                register a new application with the redirect URI above, then under <em>Certificates &amp; secrets</em>
                create a client secret. Paste the Application (client) ID + Secret here. Ensure the app has
                <strong>Mail.Send, Mail.Read, Mail.ReadWrite, offline_access</strong> delegated permissions.
            `;
        }
    };

    function buildRedirectUri(provider) {
        const authBase = (window.CONFIG && window.CONFIG.endpoints && window.CONFIG.endpoints.auth) || window.location.origin;
        return `${authBase}/api/mailboxes/oauth/${provider}/callback`;
    }

    window.saveOAuthApp = async function () {
        const clientId = document.getElementById('oauthAppClientId').value.trim();
        const clientSecret = document.getElementById('oauthAppClientSecret').value;
        const redirectUri = document.getElementById('oauthAppRedirectUri').value;

        if (!clientId || !clientSecret) {
            Toast.error('Client ID and Client Secret are required');
            return;
        }

        const btn = document.getElementById('saveOAuthAppBtn');
        btn.disabled = true;
        try {
            const resp = await api.request('/tenant-oauth-apps', {
                method: 'POST',
                body: JSON.stringify({
                    provider: oauthAppProvider,
                    clientId, clientSecret, redirectUri
                })
            });
            if (resp && resp.success) {
                Toast.success('OAuth app saved');
                closeOAuthAppModal();
                await loadOAuthApps();
            } else {
                Toast.error((resp && resp.message) || 'Save failed');
            }
        } catch (e) {
            Toast.error(e.message || 'Save failed');
        } finally {
            btn.disabled = false;
        }
    };

    window.deleteOAuthApp = async function (id, label) {
        const ok = await showConfirm(
            `Remove ${label} OAuth app? Existing mailboxes using it will stop working.`,
            'Remove OAuth app',
            'warning'
        );
        if (!ok) return;
        try {
            const resp = await api.request(`/tenant-oauth-apps/${id}`, { method: 'DELETE' });
            if (resp && resp.success) {
                Toast.success('OAuth app removed');
                await loadOAuthApps();
            } else {
                Toast.error((resp && resp.message) || 'Delete failed');
            }
        } catch (e) {
            Toast.error(e.message || 'Delete failed');
        }
    };

    // ─── Connect Mailbox wizard ────────────────────────────────────────────

    window.openConnectMailboxModal = function () {
        autoconfigResult = null;
        document.getElementById('connectEmail').value = '';
        document.getElementById('connectPassword').value = '';
        document.getElementById('connectShareWithTenant').checked = false;
        document.getElementById('connectStepEmail').style.display = 'block';
        document.getElementById('connectStepImap').style.display = 'none';
        document.getElementById('connectDetectStatus').style.display = 'none';
        document.getElementById('connectBackBtn').style.display = 'none';
        document.getElementById('connectTestBtn').style.display = 'none';
        document.getElementById('connectNextBtn').textContent = 'Continue';
        document.getElementById('connectNextBtn').style.display = 'inline-flex';
        document.getElementById('connectTestResult').style.display = 'none';
        document.getElementById('connectMailboxHeader').textContent = 'Connect Mailbox';
        document.getElementById('connectMailboxModal').classList.add('active');
        setTimeout(() => document.getElementById('connectEmail').focus(), 100);
    };

    window.closeConnectMailboxModal = function () {
        document.getElementById('connectMailboxModal').classList.remove('active');
    };

    window.connectMailboxNext = async function () {
        const emailStep = document.getElementById('connectStepEmail');
        const imapStep = document.getElementById('connectStepImap');

        if (emailStep.style.display !== 'none') {
            // Step 1 → detect, branch
            await handleDetectAndBranch();
        } else if (imapStep.style.display !== 'none') {
            // Step 2 → submit IMAP
            await submitImapConnection();
        }
    };

    window.connectMailboxBack = function () {
        document.getElementById('connectStepEmail').style.display = 'block';
        document.getElementById('connectStepImap').style.display = 'none';
        document.getElementById('connectBackBtn').style.display = 'none';
        document.getElementById('connectTestBtn').style.display = 'none';
        document.getElementById('connectNextBtn').textContent = 'Continue';
    };

    async function handleDetectAndBranch() {
        const email = document.getElementById('connectEmail').value.trim().toLowerCase();
        if (!email || !email.includes('@')) {
            Toast.error('Enter a valid email address');
            return;
        }

        const share = document.getElementById('connectShareWithTenant').checked;
        const domain = email.split('@')[1];

        const statusEl = document.getElementById('connectDetectStatus');
        statusEl.style.display = 'block';
        statusEl.textContent = 'Detecting provider…';

        // Gmail → OAuth redirect (if app exists)
        if (domain === 'gmail.com' || domain === 'googlemail.com') {
            return launchOAuth('google', share);
        }

        // M365 via autoconfig domains we know
        // We could MX-lookup here too but keep it simple — autoconfig handles most cases.
        if (/outlook\.com$|hotmail\.com$|live\.com$|onmicrosoft\.com$/.test(domain)) {
            return launchOAuth('microsoft', share);
        }

        // Custom domain: run autoconfig. If Mozilla tells us it's a Google / M365
        // hosted domain, switch to OAuth; otherwise fall through to IMAP.
        try {
            const resp = await api.request(`/mailboxes/autoconfig?email=${encodeURIComponent(email)}`);
            const cfg = resp && resp.autoconfig;
            autoconfigResult = cfg || null;

            if (cfg && cfg.found) {
                const imapHost = (cfg.imapHost || '').toLowerCase();
                if (imapHost.includes('imap.gmail.com')) {
                    return launchOAuth('google', share);
                }
                if (imapHost.includes('outlook.office365.com') || imapHost.includes('office365.com')) {
                    return launchOAuth('microsoft', share);
                }
                // Prefill IMAP form
                showImapStep(cfg);
                return;
            }

            // Not found → show manual IMAP form
            statusEl.textContent = 'Auto-detection failed. Please enter IMAP / SMTP settings manually.';
            showImapStep(null);
        } catch (e) {
            console.error('Autoconfig error:', e);
            statusEl.textContent = 'Auto-detection failed. Please enter IMAP / SMTP settings manually.';
            showImapStep(null);
        }
    }

    async function launchOAuth(provider, shareWithTenant) {
        // First, ensure a tenant OAuth app is configured for this provider
        const app = oauthApps.find(a => a.provider === provider && a.isActive);
        if (!app) {
            const label = provider === 'google' ? 'Google' : 'Microsoft';
            Toast.error(`No ${label} OAuth app configured. Ask your admin to set one up in the OAuth Apps section above.`);
            return;
        }

        try {
            const resp = await api.request('/mailboxes/oauth/start', {
                method: 'POST',
                body: JSON.stringify({ provider, shareWithTenant })
            });
            if (resp && resp.authorizeUrl) {
                window.location.href = resp.authorizeUrl;
            } else {
                Toast.error((resp && resp.message) || 'Failed to start OAuth flow');
            }
        } catch (e) {
            Toast.error(e.message || 'Failed to start OAuth flow');
        }
    }

    function showImapStep(cfg) {
        const banner = document.getElementById('connectProviderBanner');
        const helpEl = document.getElementById('connectAppPasswordHelp');

        if (cfg && cfg.providerDisplayName) {
            banner.innerHTML = `<strong>Detected:</strong> ${escapeHtml(cfg.providerDisplayName)}. Settings pre-filled below — just enter your password.`;
        } else {
            banner.innerHTML = `<strong>Manual IMAP setup:</strong> enter your provider's server details below.`;
        }

        if (cfg && cfg.appPasswordHelpUrl) {
            helpEl.innerHTML = `This provider requires an <a href="${cfg.appPasswordHelpUrl}" target="_blank" rel="noopener">app-specific password</a>, not your regular login password.`;
        } else {
            helpEl.innerHTML = `If your provider requires an app-specific password (common with 2FA enabled), use that — not your login password.`;
        }

        document.getElementById('connectImapHost').value = (cfg && cfg.imapHost) || '';
        document.getElementById('connectImapPort').value = (cfg && cfg.imapPort) || 993;
        document.getElementById('connectImapSsl').checked = cfg ? (cfg.imapUseSsl !== false) : true;
        document.getElementById('connectSmtpHost').value = (cfg && cfg.smtpHost) || '';
        document.getElementById('connectSmtpPort').value = (cfg && cfg.smtpPort) || 587;
        document.getElementById('connectSmtpSsl').checked = cfg ? (cfg.smtpUseSsl === true) : true;

        document.getElementById('connectStepEmail').style.display = 'none';
        document.getElementById('connectStepImap').style.display = 'block';
        document.getElementById('connectBackBtn').style.display = 'inline-flex';
        document.getElementById('connectTestBtn').style.display = 'inline-flex';
        document.getElementById('connectNextBtn').textContent = 'Connect';
        document.getElementById('connectMailboxHeader').textContent = 'Connect Mailbox — IMAP / SMTP';
        setTimeout(() => document.getElementById('connectPassword').focus(), 100);
    }

    function buildImapPayload() {
        return {
            emailAddress: document.getElementById('connectEmail').value.trim().toLowerCase(),
            password: document.getElementById('connectPassword').value,
            imapHost: document.getElementById('connectImapHost').value.trim(),
            imapPort: parseInt(document.getElementById('connectImapPort').value, 10) || 993,
            imapUseSsl: document.getElementById('connectImapSsl').checked,
            smtpHost: document.getElementById('connectSmtpHost').value.trim(),
            smtpPort: parseInt(document.getElementById('connectSmtpPort').value, 10) || 587,
            smtpUseSsl: document.getElementById('connectSmtpSsl').checked,
            shareWithTenant: document.getElementById('connectShareWithTenant').checked
        };
    }

    window.testImapConnection = async function () {
        const payload = buildImapPayload();
        if (!payload.password) {
            Toast.error('Enter a password first');
            return;
        }

        const resultEl = document.getElementById('connectTestResult');
        resultEl.style.display = 'block';
        resultEl.style.padding = '10px 12px';
        resultEl.style.borderRadius = '8px';
        resultEl.className = 'test-result-busy';
        resultEl.textContent = 'Testing connection…';

        try {
            const resp = await api.request('/mailboxes/imap/test', {
                method: 'POST',
                body: JSON.stringify(payload)
            });
            if (resp && resp.success) {
                resultEl.className = 'test-result-ok';
                resultEl.innerHTML = `✓ Connection successful. ${resp.supportsIdle ? 'IMAP IDLE supported (real-time replies).' : 'Server does not support IDLE — we\'ll poll every 30s.'}`;
            } else {
                resultEl.className = 'test-result-err';
                resultEl.innerHTML = `✗ ${escapeHtml(resp && resp.error ? resp.error : 'Connection failed')}`;
            }
        } catch (e) {
            resultEl.className = 'test-result-err';
            resultEl.textContent = '✗ ' + (e.message || 'Test failed');
        }
    };

    async function submitImapConnection() {
        const payload = buildImapPayload();
        if (!payload.password) {
            Toast.error('Enter a password');
            return;
        }
        if (!payload.imapHost || !payload.smtpHost) {
            Toast.error('IMAP and SMTP hosts are required');
            return;
        }

        const btn = document.getElementById('connectNextBtn');
        btn.disabled = true;
        try {
            const resp = await api.request('/mailboxes/imap', {
                method: 'POST',
                body: JSON.stringify(payload)
            });
            if (resp && resp.success) {
                Toast.success(`${payload.emailAddress} connected`);
                closeConnectMailboxModal();
                await loadMailboxes();
            } else {
                Toast.error((resp && resp.error) || (resp && resp.message) || 'Connection failed');
            }
        } catch (e) {
            Toast.error(e.message || 'Connection failed');
        } finally {
            btn.disabled = false;
        }
    }

    // ─── Delete mailbox ────────────────────────────────────────────────────

    window.deleteMailbox = async function (id, email) {
        const ok = await showConfirm(
            `Disconnect ${email}? Active campaigns using this mailbox will pause.`,
            'Disconnect mailbox',
            'warning'
        );
        if (!ok) return;
        try {
            const resp = await api.request(`/mailboxes/${id}`, { method: 'DELETE' });
            if (resp && resp.success) {
                Toast.success('Mailbox disconnected');
                await loadMailboxes();
            } else {
                Toast.error((resp && resp.message) || 'Disconnect failed');
            }
        } catch (e) {
            Toast.error(e.message || 'Disconnect failed');
        }
    };

    // ─── Sync logs modal ───────────────────────────────────────────────────
    //
    // Drives the "Logs" button on each connected mailbox row. Hits
    // /api/mailbox-send/{id}/sync-logs which only returns meaningful events
    // — empty IDLE/poll heartbeats are deliberately not recorded so the
    // table stays light at scale. Use the mailbox's lastConnectedAt for
    // "is it alive?" instead.
    let _mbSyncLogsCurrentMailboxId = null;
    let _mbSyncLogsCurrentEmail = null;

    window.openMailboxSyncLogs = function (mailboxId, email) {
        _mbSyncLogsCurrentMailboxId = mailboxId;
        _mbSyncLogsCurrentEmail = email;
        const subtitle = document.getElementById('mailboxSyncLogsSubtitle');
        if (subtitle) subtitle.textContent = email;
        const overlay = document.getElementById('mailboxSyncLogsModal');
        if (overlay) overlay.classList.add('active');
        refreshMailboxSyncLogs();
    };

    window.closeMailboxSyncLogs = function () {
        const overlay = document.getElementById('mailboxSyncLogsModal');
        if (overlay) overlay.classList.remove('active');
        _mbSyncLogsCurrentMailboxId = null;
        _mbSyncLogsCurrentEmail = null;
    };

    window.refreshMailboxSyncLogs = async function () {
        if (!_mbSyncLogsCurrentMailboxId) return;
        const loading = document.getElementById('mailboxSyncLogsLoading');
        const empty = document.getElementById('mailboxSyncLogsEmpty');
        const wrap = document.getElementById('mailboxSyncLogsTableWrap');
        const tbody = document.getElementById('mailboxSyncLogsTableBody');

        loading.style.display = 'block';
        empty.style.display = 'none';
        wrap.style.display = 'none';

        try {
            const resp = await api.request(`/crm/mailbox-send/${_mbSyncLogsCurrentMailboxId}/sync-logs?limit=100`);
            const items = (resp && resp.items) || [];
            loading.style.display = 'none';
            if (items.length === 0) {
                empty.style.display = 'block';
                tbody.innerHTML = '';
                return;
            }
            wrap.style.display = 'block';
            tbody.innerHTML = items.map(r => {
                const started = r.startedAt ? new Date(r.startedAt).toLocaleString() : '—';
                const outcome = r.outcome || '—';
                const outcomeClass = outcomeBadgeClass(outcome);
                const dur = (r.durationMs ?? 0) > 0 ? `${r.durationMs} ms` : '—';
                return `
                    <tr>
                        <td>${escapeHtml(started)}</td>
                        <td>${escapeHtml(r.source || '—')}</td>
                        <td><span class="crm-badge ${outcomeClass}">${escapeHtml(outcome)}</span></td>
                        <td style="text-align:right;">${r.repliesFound ?? 0}</td>
                        <td style="text-align:right;">${r.bouncesFound ?? 0}</td>
                        <td style="text-align:right;">${escapeHtml(dur)}</td>
                        <td><small style="color:var(--text-secondary);">${escapeHtml(truncate(r.errorMessage || '', 200))}</small></td>
                    </tr>
                `;
            }).join('');
        } catch (e) {
            loading.style.display = 'none';
            Toast.error(e.message || 'Failed to load mailbox sync logs');
        }
    };

    function outcomeBadgeClass(outcome) {
        switch ((outcome || '').toLowerCase()) {
            case 'replies_found':
            case 'bounces_found':
                return 'crm-badge-active';
            case 'auth_failed':
            case 'error':
            case 'connect_failed':
                return 'crm-badge-inactive';
            case 'timeout':
                return 'crm-badge-pending';
            default:
                return '';
        }
    }

    // ─── Utilities ─────────────────────────────────────────────────────────

    function escapeHtml(str) {
        if (str == null) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function truncate(str, n) {
        if (!str) return '';
        return str.length > n ? str.slice(0, n - 1) + '…' : str;
    }

    function prettifyError(code) {
        switch (code) {
            case 'token_exchange_failed': return 'Token exchange failed. Check the OAuth app credentials.';
            case 'could_not_fetch_email': return 'Connected but could not read the account email.';
            case 'save_failed': return 'Failed to save the mailbox.';
            case 'access_denied': return 'You canceled the authorization.';
            default: return `OAuth error: ${code}`;
        }
    }

    // settings.js's DOMContentLoaded fires switchSettingsTab('mailboxes') BEFORE
    // this file loads (document.write script order), so its dispatch to
    // loadMailboxesTab() misses. Run the init ourselves once this script is
    // parsed — covers both fresh nav and OAuth callback redirect.
    function initIfActive() {
        const tab = document.getElementById('tab-mailboxes');
        if (tab && tab.classList.contains('active')) {
            window.loadMailboxesTab();
            return;
        }
        const params = new URLSearchParams(window.location.search);
        if (params.get('tab') === 'mailboxes' && typeof window.switchSettingsTab === 'function') {
            window.switchSettingsTab('mailboxes');
        }
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initIfActive);
    } else {
        initIfActive();
    }
})();
