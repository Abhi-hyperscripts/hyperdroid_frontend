// CAPI (Meta Conversion API) Settings — multi-tenant.
//
// Per-tenant config lives in Auth's tenant_api_keys (provider=facebook,
// service_type IN capi_pixel_id | capi_access_token | capi_config). We
// never read raw secrets back; the GET returns presence flags + last-4
// hint so the UI can show "is this the right pixel?" without leaking.
//
// All API calls go through the singleton `api` (defined in js/api.js)
// which auto-routes /crm/* to the CRM backend.

(function () {
    'use strict';

    const STATE = {
        configured: false,
        pixelHint: null,
        eventsEnabled: { lead: true, qualified_lead: false, schedule: false, purchase: false },
    };

    async function loadCapiConfig() {
        try {
            const res = await api.request('/crm/capi-settings/config');
            STATE.configured = !!(res && res.pixel_id_present);
            STATE.pixelHint = res && res.pixel_id_hint || null;
            STATE.eventsEnabled = (res && res.events_enabled) || STATE.eventsEnabled;
            paintFromState();
        } catch (e) {
            console.error('CAPI: loadConfig failed', e);
        }
    }

    function paintFromState() {
        const badge = document.getElementById('capiStatusBadge');
        const disconnectBtn = document.getElementById('capiDisconnectBtn');
        const pixelInput = document.getElementById('capiPixelInput');
        const tokenInput = document.getElementById('capiTokenInput');

        if (STATE.configured) {
            if (badge) {
                badge.textContent = STATE.pixelHint ? `Active · ${STATE.pixelHint}` : 'Active';
                badge.style.background = 'rgba(34,197,94,0.15)';
                badge.style.color = '#16a34a';
            }
            if (disconnectBtn) disconnectBtn.style.display = '';
            if (pixelInput && STATE.pixelHint) pixelInput.placeholder = `Saved · ends in ${STATE.pixelHint.replace('…','')}. Leave blank to keep.`;
            if (tokenInput) tokenInput.placeholder = 'Saved. Leave blank to keep, or paste a new one.';
        } else {
            if (badge) {
                badge.textContent = 'Not configured';
                badge.style.background = 'var(--bg-tertiary)';
                badge.style.color = 'var(--text-secondary)';
            }
            if (disconnectBtn) disconnectBtn.style.display = 'none';
            if (pixelInput) pixelInput.placeholder = 'e.g. 123456789012345';
            if (tokenInput) tokenInput.placeholder = 'EAA…';
        }

        const ee = STATE.eventsEnabled || {};
        setCheckbox('capiEvtLead', ee.lead !== false);
        setCheckbox('capiEvtQualified', !!ee.qualified_lead);
        setCheckbox('capiEvtSchedule', !!ee.schedule);
        setCheckbox('capiEvtPurchase', !!ee.purchase);
    }

    function setCheckbox(id, val) {
        const el = document.getElementById(id);
        if (el) el.checked = !!val;
    }

    function showCapiMessage(text, kind /* 'ok' | 'warn' | 'err' */) {
        const msg = document.getElementById('capiStatusMessage');
        if (!msg) return;
        msg.style.display = '';
        msg.textContent = text;
        if (kind === 'ok') {
            msg.style.background = 'rgba(34,197,94,0.12)';
            msg.style.color = '#16a34a';
            msg.style.border = '1px solid rgba(34,197,94,0.3)';
        } else if (kind === 'warn') {
            msg.style.background = 'rgba(234,179,8,0.12)';
            msg.style.color = '#a16207';
            msg.style.border = '1px solid rgba(234,179,8,0.3)';
        } else {
            msg.style.background = 'rgba(239,68,68,0.12)';
            msg.style.color = '#b91c1c';
            msg.style.border = '1px solid rgba(239,68,68,0.3)';
        }
        // Auto-fade success after 6s; keep errors visible.
        if (kind === 'ok') setTimeout(() => { msg.style.display = 'none'; }, 6000);
    }

    function readForm() {
        const pixel = (document.getElementById('capiPixelInput')?.value || '').trim();
        const token = (document.getElementById('capiTokenInput')?.value || '').trim();
        return {
            pixel_id: pixel,
            capi_access_token: token,
            lead_enabled: !!document.getElementById('capiEvtLead')?.checked,
            qualified_lead_enabled: !!document.getElementById('capiEvtQualified')?.checked,
            schedule_enabled: !!document.getElementById('capiEvtSchedule')?.checked,
            purchase_enabled: !!document.getElementById('capiEvtPurchase')?.checked,
        };
    }

    window.saveCapiSettings = async function () {
        const form = readForm();
        // If the user left the fields blank but a config is already stored,
        // they probably want to just toggle events. Block save if NEITHER
        // a stored config NOR a new pixel is present.
        if (!STATE.configured && !form.pixel_id) {
            showCapiMessage('Pixel ID is required to enable CAPI.', 'err');
            return;
        }
        if (form.pixel_id && !/^\d+$/.test(form.pixel_id)) {
            showCapiMessage('Pixel ID must be digits only.', 'err');
            return;
        }
        if (form.pixel_id && !form.capi_access_token && !STATE.configured) {
            showCapiMessage('CAPI Access Token is required on first connect.', 'err');
            return;
        }

        const btn = document.getElementById('capiSaveBtn');
        if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
        try {
            // If a field is blank AND we already have a stored config, omit
            // it from the request so the server doesn't overwrite to "".
            const body = {
                pixel_id: form.pixel_id || undefined,
                capi_access_token: form.capi_access_token || undefined,
                lead_enabled: form.lead_enabled,
                qualified_lead_enabled: form.qualified_lead_enabled,
                schedule_enabled: form.schedule_enabled,
                purchase_enabled: form.purchase_enabled,
            };
            // If we're updating events only, we still must send pixel + token
            // so the server doesn't blank them. Resend the empty body keys
            // only when the server-side overwrite is what we want.
            if (STATE.configured) {
                if (!form.pixel_id) delete body.pixel_id;
                if (!form.capi_access_token) delete body.capi_access_token;
            }

            const res = await api.request('/crm/capi-settings/config', {
                method: 'POST',
                body: JSON.stringify(body),
            });
            STATE.configured = true;
            STATE.pixelHint = res?.pixel_id_hint || STATE.pixelHint;
            STATE.eventsEnabled = res?.events_enabled || STATE.eventsEnabled;
            // Clear sensitive token field after save.
            const tokInput = document.getElementById('capiTokenInput');
            if (tokInput) tokInput.value = '';
            const pxInput = document.getElementById('capiPixelInput');
            if (pxInput) pxInput.value = '';
            paintFromState();
            showCapiMessage('Saved. Events will start flowing on the next lead create.', 'ok');
            if (typeof Toast !== 'undefined') Toast.success('CAPI settings saved');
        } catch (e) {
            console.error('CAPI save failed', e);
            showCapiMessage('Save failed: ' + (e?.message || 'unknown error'), 'err');
        } finally {
            if (btn) { btn.disabled = false; btn.textContent = 'Save & Enable'; }
        }
    };

    window.testCapiConnection = async function () {
        const btn = document.getElementById('capiTestBtn');
        if (btn) { btn.disabled = true; btn.textContent = 'Testing…'; }
        try {
            const form = readForm();
            const body = {
                pixel_id: form.pixel_id || undefined,
                capi_access_token: form.capi_access_token || undefined,
            };
            const res = await api.request('/crm/capi-settings/test', {
                method: 'POST',
                body: JSON.stringify(body),
            });
            if (res && res.success) {
                showCapiMessage(`Test event sent — Meta accepted (HTTP ${res.http_status}).`, 'ok');
            } else if (res && res.is_auth_failure) {
                showCapiMessage(`Auth failure (HTTP ${res.http_status}). Token is invalid or revoked. ${res.error_message || ''}`, 'err');
            } else if (res && res.is_rate_limit) {
                showCapiMessage(`Rate limited (HTTP ${res.http_status}). Try again in a few minutes.`, 'warn');
            } else {
                showCapiMessage(`Meta rejected: HTTP ${res?.http_status || '?'} — ${res?.error_message || 'unknown'}`, 'err');
            }
        } catch (e) {
            console.error('CAPI test failed', e);
            showCapiMessage('Test failed: ' + (e?.message || 'network error'), 'err');
        } finally {
            if (btn) { btn.disabled = false; btn.textContent = 'Test Connection'; }
        }
    };

    window.disconnectCapi = async function () {
        const proceed = typeof Confirm !== 'undefined'
            ? await Confirm.show({
                title: 'Disconnect CAPI?',
                message: 'Stops sending Lead / QualifiedLead events to Meta. Past events stay in Meta\'s logs. You can reconnect anytime by re-pasting Pixel ID + Token.',
                confirmLabel: 'Disconnect',
                danger: true,
              })
            : window.confirm('Disconnect CAPI? Events stop flowing to Meta until you reconnect.');
        if (!proceed) return;

        try {
            await api.request('/crm/capi-settings/config', { method: 'DELETE' });
            STATE.configured = false;
            STATE.pixelHint = null;
            STATE.eventsEnabled = { lead: true, qualified_lead: false, schedule: false, purchase: false };
            paintFromState();
            showCapiMessage('CAPI disconnected.', 'warn');
            if (typeof Toast !== 'undefined') Toast.info('CAPI disconnected');
        } catch (e) {
            console.error('CAPI disconnect failed', e);
            showCapiMessage('Disconnect failed: ' + (e?.message || 'unknown'), 'err');
        }
    };

    window.openCapiRecent = async function () {
        const modal = document.getElementById('capiRecentModal');
        if (!modal) return;
        // Existing CRM modals use `active` class toggling (see
        // openFacebookSyncLogs in settings.js); .gm-overlay has CSS rules
        // that key off this class.
        modal.classList.add('active');
        await refreshCapiRecent();
    };

    window.closeCapiRecent = function () {
        const modal = document.getElementById('capiRecentModal');
        if (modal) modal.classList.remove('active');
    };

    window.refreshCapiRecent = async function () {
        const body = document.getElementById('capiRecentBody');
        if (!body) return;
        body.innerHTML = '<tr><td colspan="7" style="text-align:center; color: var(--text-secondary);">Loading…</td></tr>';
        try {
            const res = await api.request('/crm/capi-settings/recent?limit=50');
            const evs = (res && res.events) || [];
            if (evs.length === 0) {
                body.innerHTML = '<tr><td colspan="7" style="text-align:center; color: var(--text-secondary);">No events yet.</td></tr>';
                return;
            }
            body.innerHTML = evs.map(e => {
                const status = renderStatusBadge(e.status);
                const created = e.created_at ? new Date(e.created_at).toLocaleString() : '—';
                const sent = e.sent_at ? new Date(e.sent_at).toLocaleString() : '—';
                const lastErr = e.last_error ? `<code style="font-size:0.8em;">${escapeHtml(truncate(e.last_error, 80))}</code>` : '—';
                const leadCell = e.lead_id ? `<code style="font-size:0.8em;">${escapeHtml(String(e.lead_id).slice(0, 8))}…</code>` : '—';
                return `<tr>
                    <td style="font-size:0.85em;">${escapeHtml(created)}</td>
                    <td><strong>${escapeHtml(e.event_name || '')}</strong></td>
                    <td>${leadCell}</td>
                    <td>${status}</td>
                    <td>${e.attempts ?? 0}</td>
                    <td>${lastErr}</td>
                    <td style="font-size:0.85em;">${escapeHtml(sent)}</td>
                </tr>`;
            }).join('');
        } catch (e) {
            console.error('CAPI recent failed', e);
            body.innerHTML = '<tr><td colspan="7" style="text-align:center; color: var(--text-error, #b91c1c);">Failed to load recent events.</td></tr>';
        }
    };

    function renderStatusBadge(status) {
        const s = String(status || '').toLowerCase();
        const palette = {
            sent:    { bg: 'rgba(34,197,94,0.15)',  fg: '#16a34a', label: 'sent' },
            pending: { bg: 'rgba(59,130,246,0.15)', fg: '#1d4ed8', label: 'pending' },
            failed:  { bg: 'rgba(239,68,68,0.15)',  fg: '#b91c1c', label: 'failed' },
            skipped: { bg: 'rgba(156,163,175,0.2)', fg: '#4b5563', label: 'skipped' },
        }[s] || { bg: 'var(--bg-tertiary)', fg: 'var(--text-secondary)', label: s || '?' };
        return `<span style="padding:2px 8px; border-radius:999px; font-size:0.75em; background:${palette.bg}; color:${palette.fg};">${escapeHtml(palette.label)}</span>`;
    }

    function escapeHtml(s) {
        return String(s ?? '').replace(/[&<>"']/g, c => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        }[c]));
    }
    function truncate(s, n) { return (s.length > n) ? s.substring(0, n) + '…' : s; }

    // Boot — load on settings page when Integrations tab becomes active.
    document.addEventListener('DOMContentLoaded', function () {
        // Wait a tick so settings.js has populated the FB card.
        setTimeout(loadCapiConfig, 250);
    });
})();
