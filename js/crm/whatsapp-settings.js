/**
 * WhatsApp (Interakt) settings tab — CRM Settings → Integrations.
 *
 * Lists the tenant's WhatsApp business numbers and lets a tenant admin
 * add / rotate / deactivate / remove credentials. Talks to Auth's
 * tenant_api_keys REST API directly using the user's JWT — same surface
 * the platform admin uses, just scoped to the tenant via the JWT claim.
 *
 * Each credential row in tenant_api_keys for provider='interakt',
 * service_type='whatsapp' is keyed by instance_key = the digits-only
 * business phone number. The JSON blob in encrypted_key holds:
 *   { "api_key": "...", "webhook_secret": "..." }
 *
 * The webhook URL we generate uses NotificationService at:
 *   {NS_BASE}/api/webhooks/interakt/{tenantId}/{phoneDigits}
 * That path is what Phase 3 wired in NotificationService.
 */

(function () {
    'use strict';

    // ─── State ──────────────────────────────────────────────────────────────
    let waEditMode = false;
    let waEditInstanceKey = '';   // Locked phone when rotating an existing row
    let waPendingDeleteKey = '';  // Phone in the delete-confirm modal

    // ─── Public entry point ─────────────────────────────────────────────────

    // In-memory snapshot of per-number push-notification toggle state.
    // Populated alongside the numbers list so the row renderer doesn't have
    // to make a per-row settings call. Key = digits-only phone, value = bool.
    const waNotifyState = new Map();

    async function loadWhatsAppNumbers() {
        const wrap = document.getElementById('waNumbersWrap');
        const empty = document.getElementById('waEmptyState');
        const tbody = document.getElementById('waNumbersTableBody');
        const statusDot = document.getElementById('waStatusDot');
        const statusText = document.getElementById('waStatusText');
        const inboxBtn = document.getElementById('waOpenInboxBtn');
        if (!tbody) return;

        try {
            const resp = await api.getApiKeys();
            const all = (resp && resp.keys) ? resp.keys : [];
            const numbers = all.filter(k => (k.provider || '').toLowerCase() === 'interakt'
                                         && (k.serviceType || k.service_type || '').toLowerCase() === 'whatsapp');

            if (numbers.length === 0) {
                tbody.innerHTML = '';
                wrap.style.display = 'none';
                empty.style.display = '';
                if (statusDot) statusDot.className = 'dot disconnected';
                if (statusText) statusText.textContent = 'No numbers configured';
                if (inboxBtn) inboxBtn.style.display = 'none';
                return;
            }

            // Pull per-number push toggle state in parallel — missing key means
            // ON (default), which matches the backend ingest-path behaviour.
            waNotifyState.clear();
            await Promise.all(numbers.map(async n => {
                const phone = n.instanceKey || n.instance_key || '';
                if (!phone) return;
                try {
                    const r = await api.request(`/crm/crm-settings/notify_whatsapp_inbound_${phone}`);
                    waNotifyState.set(phone, r?.value !== 'false');
                } catch {
                    waNotifyState.set(phone, true);
                }
            }));

            wrap.style.display = '';
            empty.style.display = 'none';
            const activeCount = numbers.filter(n => n.isActive ?? n.is_active).length;
            if (statusDot) statusDot.className = activeCount > 0 ? 'dot connected' : 'dot disconnected';
            if (statusText) statusText.textContent = `${numbers.length} number${numbers.length === 1 ? '' : 's'} configured · ${activeCount} active`;
            if (inboxBtn) inboxBtn.style.display = activeCount > 0 ? '' : 'none';

            tbody.innerHTML = numbers.map(renderRow).join('');
        } catch (err) {
            console.error('[whatsapp-settings] load failed:', err);
            if (typeof Toast !== 'undefined') Toast.error('Failed to load WhatsApp numbers');
        }
    }

    function renderRow(num) {
        const phone = num.instanceKey || num.instance_key || '';
        const escPhone = phone.replace(/'/g, "\\'");
        const isActive = num.isActive !== undefined ? num.isActive : (num.is_active !== undefined ? num.is_active : true);
        const hint = num.displayHint || num.display_hint || '****';
        const created = num.createdAt || num.created_at;
        const createdLabel = created ? new Date(created).toLocaleDateString() : '—';
        const formattedPhone = formatPhoneForDisplay(phone);
        const notifyOn = waNotifyState.get(phone) !== false;

        return `
            <tr>
                <td>
                    <div style="font-weight:600;">${formattedPhone}</div>
                    <div style="font-size:0.78rem; color:var(--text-secondary); font-family:monospace;">${phone}</div>
                </td>
                <td>
                    <span class="status-badge ${isActive ? 'active' : 'inactive'}">
                        <span class="status-dot"></span>
                        ${isActive ? 'Active' : 'Inactive'}
                    </span>
                </td>
                <td><code class="apikey-hint">${hint}</code></td>
                <td>${createdLabel}</td>
                <td>
                    <label class="wa-notify-switch" data-tooltip="${notifyOn ? 'Push enabled — SUPERADMINs + assigned rep notified on new messages' : 'Push disabled for this number'}" style="display:inline-flex; align-items:center; gap:8px; cursor:pointer; user-select:none;">
                        <input type="checkbox" class="wa-notify-toggle-input" data-phone="${escPhone}" ${notifyOn ? 'checked' : ''} onchange="toggleWhatsAppNotify('${escPhone}', this.checked)" style="position:absolute; opacity:0; pointer-events:none;">
                        <span class="wa-notify-track" style="position:relative; width:34px; height:18px; background:${notifyOn ? 'var(--brand-primary)' : 'var(--border-color)'}; border-radius:999px; transition:background 0.18s ease; flex:0 0 34px;">
                            <span style="position:absolute; top:2px; left:${notifyOn ? '18px' : '2px'}; width:14px; height:14px; background:#fff; border-radius:50%; transition:left 0.18s ease; box-shadow:0 1px 2px rgba(0,0,0,0.25);"></span>
                        </span>
                        <span class="wa-notify-label" style="font-size:0.78rem; color:var(--text-secondary);">${notifyOn ? 'On' : 'Off'}</span>
                    </label>
                </td>
                <td style="text-align:right;">
                    <div class="action-buttons" style="justify-content:flex-end;">
                        <button class="action-btn" data-tooltip="Show webhook URL" onclick="showWhatsAppWebhook('${escPhone}')">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
                                <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
                            </svg>
                        </button>
                        <button class="action-btn" data-tooltip="${isActive ? 'Deactivate' : 'Activate'}" onclick="toggleWhatsAppActive('${escPhone}', ${!isActive})">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                ${isActive
                                    ? '<path d="M18.36 6.64a9 9 0 1 1-12.73 0"/><line x1="12" y1="2" x2="12" y2="12"/>'
                                    : '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>'}
                            </svg>
                        </button>
                        <button class="action-btn" data-tooltip="Rotate keys" onclick="openRotateWhatsAppModal('${escPhone}')">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <polyline points="23 4 23 10 17 10"/>
                                <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
                            </svg>
                        </button>
                        <button class="action-btn danger" data-tooltip="Remove" onclick="openDeleteWhatsAppModal('${escPhone}')">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <polyline points="3 6 5 6 21 6"/>
                                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                            </svg>
                        </button>
                    </div>
                </td>
            </tr>
        `;
    }

    // Pretty-print 919220474451 → +91 92204 74451 (best-effort, India-biased).
    // Falls back to the raw digits if it's outside the 12-digit Indian shape.
    function formatPhoneForDisplay(digits) {
        if (!digits) return '—';
        if (/^91\d{10}$/.test(digits)) {
            return `+${digits.slice(0, 2)} ${digits.slice(2, 7)} ${digits.slice(7)}`;
        }
        return `+${digits}`;
    }

    // ─── Modal controls ─────────────────────────────────────────────────────

    function openAddWhatsAppModal() {
        waEditMode = false;
        waEditInstanceKey = '';
        document.getElementById('waModalTitle').textContent = 'Add WhatsApp number';
        document.getElementById('waPhoneInput').value = '';
        document.getElementById('waPhoneInput').disabled = false;
        document.getElementById('waApiKeyInput').value = '';
        document.getElementById('waApiKeyInput').type = 'password';
        document.getElementById('waWebhookSecretInput').value = '';
        document.getElementById('waWebhookSecretInput').type = 'password';
        document.getElementById('waSaveBtn').textContent = 'Save';
        openOverlay('waModal');
    }

    function openRotateWhatsAppModal(phone) {
        waEditMode = true;
        waEditInstanceKey = phone;
        document.getElementById('waModalTitle').textContent = `Rotate keys for ${formatPhoneForDisplay(phone)}`;
        document.getElementById('waPhoneInput').value = phone;
        document.getElementById('waPhoneInput').disabled = true;
        document.getElementById('waApiKeyInput').value = '';
        document.getElementById('waApiKeyInput').type = 'password';
        document.getElementById('waWebhookSecretInput').value = '';
        document.getElementById('waWebhookSecretInput').type = 'password';
        document.getElementById('waSaveBtn').textContent = 'Update';
        openOverlay('waModal');
    }

    function closeWhatsAppModal() {
        closeOverlay('waModal');
    }

    async function saveWhatsAppNumber() {
        const phoneRaw = document.getElementById('waPhoneInput').value.trim();
        const phoneDigits = phoneRaw.replace(/\D/g, '');
        const apiKey = document.getElementById('waApiKeyInput').value.trim();
        const webhookSecret = document.getElementById('waWebhookSecretInput').value.trim();

        if (!apiKey || !webhookSecret) {
            if (typeof Toast !== 'undefined') Toast.error('API Key and Webhook Secret are both required');
            return;
        }
        if (!waEditMode && !phoneDigits) {
            if (typeof Toast !== 'undefined') Toast.error('Business phone number is required');
            return;
        }

        const blob = JSON.stringify({ api_key: apiKey, webhook_secret: webhookSecret });
        const btn = document.getElementById('waSaveBtn');
        btn.disabled = true;
        const origText = btn.textContent;
        btn.textContent = waEditMode ? 'Updating…' : 'Saving…';

        try {
            if (waEditMode) {
                await api.updateApiKey('Interakt', 'whatsapp', { apiKey: blob }, waEditInstanceKey);
                if (typeof Toast !== 'undefined') Toast.success('Keys rotated');
            } else {
                await api.saveApiKey('Interakt', 'whatsapp', blob, phoneDigits);
                if (typeof Toast !== 'undefined') Toast.success('WhatsApp number connected');
            }
            closeWhatsAppModal();
            await loadWhatsAppNumbers();
            if (!waEditMode) {
                // Right after first-time add, surface the webhook URL panel so the
                // tenant knows the next step is pasting it into Interakt.
                showWhatsAppWebhook(phoneDigits);
            }
        } catch (err) {
            console.error('[whatsapp-settings] save failed:', err);
            if (typeof Toast !== 'undefined') Toast.error(err.message || 'Failed to save');
        } finally {
            btn.disabled = false;
            btn.textContent = origText;
        }
    }

    async function toggleWhatsAppNotify(phone, enabled) {
        // Optimistic update — flip local state and re-render so the switch
        // animates instantly. Revert on server error.
        const previous = waNotifyState.get(phone);
        waNotifyState.set(phone, !!enabled);
        try {
            await api.request(`/crm/crm-settings/notify_whatsapp_inbound_${phone}`, {
                method: 'PUT',
                body: JSON.stringify({ value: enabled ? 'true' : 'false' })
            });
            // Re-render so the track-color, knob-position and tooltip refresh.
            await loadWhatsAppNumbers();
            if (typeof Toast !== 'undefined') {
                Toast.success(enabled ? 'Push notifications enabled' : 'Push notifications disabled');
            }
        } catch (err) {
            console.error('[whatsapp-settings] notify toggle failed:', err);
            waNotifyState.set(phone, previous);
            await loadWhatsAppNumbers();
            if (typeof Toast !== 'undefined') Toast.error(err.message || 'Failed to update notification setting');
        }
    }

    async function toggleWhatsAppActive(phone, makeActive) {
        try {
            await api.updateApiKey('Interakt', 'whatsapp', { isActive: makeActive }, phone);
            if (typeof Toast !== 'undefined') Toast.success(makeActive ? 'Number activated' : 'Number deactivated');
            await loadWhatsAppNumbers();
        } catch (err) {
            console.error('[whatsapp-settings] toggle failed:', err);
            if (typeof Toast !== 'undefined') Toast.error(err.message || 'Failed to update status');
        }
    }

    function openDeleteWhatsAppModal(phone) {
        waPendingDeleteKey = phone;
        const label = document.getElementById('waDeletePhoneLabel');
        if (label) label.textContent = formatPhoneForDisplay(phone);
        openOverlay('waDeleteModal');
    }

    function closeDeleteWhatsAppModal() {
        waPendingDeleteKey = '';
        closeOverlay('waDeleteModal');
    }

    async function confirmDeleteWhatsAppNumber() {
        if (!waPendingDeleteKey) return;
        try {
            await api.deleteApiKey('Interakt', 'whatsapp', waPendingDeleteKey);
            if (typeof Toast !== 'undefined') Toast.success('Number removed');
            closeDeleteWhatsAppModal();
            await loadWhatsAppNumbers();
        } catch (err) {
            console.error('[whatsapp-settings] delete failed:', err);
            if (typeof Toast !== 'undefined') Toast.error(err.message || 'Failed to remove number');
        }
    }

    function showWhatsAppWebhook(phone) {
        const tenantId = readTenantIdFromJwt();
        const baseUrl = getNotificationBaseUrl();
        const url = tenantId
            ? `${baseUrl}/api/webhooks/interakt/${tenantId}/${encodeURIComponent(phone)}`
            : '(could not resolve tenant id — please re-login)';
        document.getElementById('waWebhookUrlText').textContent = url;
        openOverlay('waWebhookModal');
    }

    function closeWebhookModal() {
        closeOverlay('waWebhookModal');
    }

    // ─── Helpers ────────────────────────────────────────────────────────────

    // Existing CRM modals (gm-overlay style) toggle visibility via .active.
    // Reuse the global openModal/closeModal from settings.js when available
    // so we inherit the focus-trap / scroll-lock behaviour for free.
    function openOverlay(id) {
        if (typeof window.openModal === 'function') return window.openModal(id);
        const el = document.getElementById(id);
        if (el) el.classList.add('active');
    }
    function closeOverlay(id) {
        if (typeof window.closeModal === 'function') return window.closeModal(id);
        const el = document.getElementById(id);
        if (el) el.classList.remove('active');
    }

    function waToggleField(inputId) {
        const input = document.getElementById(inputId);
        if (!input) return;
        input.type = input.type === 'password' ? 'text' : 'password';
    }

    async function waCopyText(text, btn) {
        try {
            await navigator.clipboard.writeText(text);
            if (btn) {
                const orig = btn.innerHTML;
                btn.innerHTML = 'Copied!';
                btn.disabled = true;
                setTimeout(() => { btn.innerHTML = orig; btn.disabled = false; }, 2000);
            }
            if (typeof Toast !== 'undefined') Toast.success('Copied to clipboard');
        } catch {
            if (typeof Toast !== 'undefined') Toast.error('Could not copy — please select manually');
        }
    }

    function readTenantIdFromJwt() {
        try {
            const tok = localStorage.getItem('ragenaizer_authToken') || localStorage.getItem('authToken');
            if (!tok) return null;
            const payload = JSON.parse(atob(tok.split('.')[1]));
            return payload.tenant_id || null;
        } catch {
            return null;
        }
    }

    function getNotificationBaseUrl() {
        if (typeof CONFIG !== 'undefined' && CONFIG.endpoints && CONFIG.endpoints.notification) {
            return CONFIG.endpoints.notification;
        }
        // Local dev default — production gets the value from CONFIG.endpoints.notification.
        return 'http://localhost:5110';
    }

    // ─── Expose to global so onclick= handlers in settings.html can find them ─
    window.loadWhatsAppNumbers = loadWhatsAppNumbers;
    window.openAddWhatsAppModal = openAddWhatsAppModal;
    window.openRotateWhatsAppModal = openRotateWhatsAppModal;
    window.closeWhatsAppModal = closeWhatsAppModal;
    window.saveWhatsAppNumber = saveWhatsAppNumber;
    window.toggleWhatsAppActive = toggleWhatsAppActive;
    window.toggleWhatsAppNotify = toggleWhatsAppNotify;
    window.openDeleteWhatsAppModal = openDeleteWhatsAppModal;
    window.closeDeleteWhatsAppModal = closeDeleteWhatsAppModal;
    window.confirmDeleteWhatsAppNumber = confirmDeleteWhatsAppNumber;
    window.showWhatsAppWebhook = showWhatsAppWebhook;
    window.closeWebhookModal = closeWebhookModal;
    window.waToggleField = waToggleField;
    window.waCopyText = waCopyText;
})();
