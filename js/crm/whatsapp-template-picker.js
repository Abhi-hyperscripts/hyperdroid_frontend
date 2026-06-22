/**
 * WhatsApp Template Picker — Meta-approved template chooser for the
 * CRM inbox composer.
 *
 * Why this exists:
 *   Meta blocks free-form WhatsApp messages outside a 24-hour window
 *   from the customer's last inbound. The only legal way to message a
 *   cold lead (or one who hasn't replied in >24h) is via a template
 *   pre-approved by Meta. Templates carry positional placeholders
 *   ({{1}}, {{2}}, …) that get filled at send time.
 *
 * Data flow:
 *   GET /api/whatsapp/templates?business_phone=... → CRM controller
 *     → NotificationService gRPC ListWhatsAppTemplates
 *     → Interakt /v1/public/message-templates/
 *     → cached 5min in NS so a 20-rep tenant flipping the inbox open
 *       doesn't burn Interakt rate-limit budget.
 *
 *   On Send → POST /api/whatsapp/send with messageType=template +
 *     templateName + templateLanguage + templateParams[]. Inbox JS
 *     re-opens the conversation so the optimistic outbound row appears.
 *
 * UI contract:
 *   WhatsAppTemplatePicker.open({ businessPhone, recipientPhone, onSent })
 *     - businessPhone: digits-only (no +). Used to scope template fetch
 *       to the correct WABA on multi-number tenants.
 *     - recipientPhone: digits-only with country code (e.g. "919876543210").
 *       Split client-side into +CC and 10-digit local because that's the
 *       shape /whatsapp/send takes.
 *     - onSent: () => void — fired after Send succeeds so the inbox can
 *       refresh the open thread.
 *
 * The picker is a single global instance (one modal in the DOM) because
 * only one composer is ever active at a time on this page.
 */
(function () {
    'use strict';

    // ─── Module-private state ───────────────────────────────────────────────
    let allTemplates = [];           // raw list from /api/whatsapp/templates
    let dropdown = null;             // SearchableDropdown instance
    let selectedTemplate = null;     // currently chosen template object
    let currentBusinessPhone = '';   // scoped fetch — empty for single-number tenants
    let currentRecipientPhone = '';  // who we're sending to
    let onSentCallback = null;       // host callback fired after Send succeeds
    let sending = false;             // reentrancy guard for the Send button

    // ─── DOM refs (resolved on open) ────────────────────────────────────────
    let elModal, elClose, elCancel, elSend, elRefresh,
        elPickerHost, elParams, elPreview, elPreviewWrap,
        elMeta, elEmpty;

    // ─── Public surface ─────────────────────────────────────────────────────
    window.WhatsAppTemplatePicker = {
        open: function (opts) {
            opts = opts || {};
            currentBusinessPhone = String(opts.businessPhone || '').replace(/\D/g, '');
            currentRecipientPhone = String(opts.recipientPhone || '').replace(/\D/g, '');
            onSentCallback = typeof opts.onSent === 'function' ? opts.onSent : null;
            if (!currentRecipientPhone) {
                if (typeof Toast !== 'undefined') Toast.warning('No recipient selected.');
                return;
            }
            resolveDom();
            wireOnce();
            showModal();
            // Fetch fresh (or cached) on every open so the rep sees newly
            // approved templates without page reload. The 5-min NS cache
            // makes this cheap.
            loadTemplates(false);
        },
    };

    // ─── DOM lookup ─────────────────────────────────────────────────────────
    function resolveDom() {
        elModal       = document.getElementById('waTplModal');
        elClose       = document.getElementById('waTplClose');
        elCancel      = document.getElementById('waTplCancel');
        elSend        = document.getElementById('waTplSend');
        elRefresh     = document.getElementById('waTplRefresh');
        elPickerHost  = document.getElementById('waTplPickerHost');
        elParams      = document.getElementById('waTplParams');
        elPreview     = document.getElementById('waTplPreview');
        elPreviewWrap = document.getElementById('waTplPreviewWrap');
        elMeta        = document.getElementById('waTplMeta');
        elEmpty       = document.getElementById('waTplEmpty');
    }

    // Wire DOM listeners exactly once. The modal lives across multiple
    // opens; rebinding handlers per-open would leak listeners and double-
    // fire the Send button.
    let wired = false;
    function wireOnce() {
        if (wired) return;
        wired = true;
        elClose.addEventListener('click', closeModal);
        elCancel.addEventListener('click', closeModal);
        elModal.addEventListener('click', (e) => {
            if (e.target === elModal) closeModal();
        });
        elRefresh.addEventListener('click', () => loadTemplates(true));
        elSend.addEventListener('click', handleSend);
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && elModal && elModal.style.display !== 'none') {
                closeModal();
            }
        });
    }

    function showModal() {
        elModal.style.display = 'flex';
        // Reset state on every open — stale dropdown/params from a prior
        // session would otherwise leak into the next pick.
        selectedTemplate = null;
        elParams.innerHTML = '';
        elPreview.textContent = '';
        elPreviewWrap.style.display = 'none';
        elMeta.style.display = 'none';
        elEmpty.style.display = 'none';
        elSend.disabled = true;
    }

    function closeModal() {
        elModal.style.display = 'none';
    }

    // ─── Template fetch ─────────────────────────────────────────────────────
    async function loadTemplates(forceRefresh) {
        elPickerHost.innerHTML = '<div class="wa-tpl-loading">Loading templates…</div>';
        elEmpty.style.display = 'none';
        try {
            const qs = new URLSearchParams();
            if (currentBusinessPhone) qs.set('business_phone', currentBusinessPhone);
            if (forceRefresh) qs.set('force_refresh', 'true');
            const path = '/whatsapp/templates' + (qs.toString() ? '?' + qs.toString() : '');
            const resp = await api.request(path, { method: 'GET' });
            if (!resp || resp.success === false) {
                const msg = resp && resp.message ? resp.message : 'Failed to load templates';
                throw new Error(msg);
            }
            allTemplates = Array.isArray(resp.templates) ? resp.templates : [];
            renderPicker();
            // Surface cache status so the rep knows whether to hit Refresh.
            if (resp.fetched_at) {
                const ago = humanizeFetchedAt(resp.fetched_at);
                elRefresh.textContent = resp.from_cache
                    ? `Refresh from Interakt (cached ${ago})`
                    : `Refresh from Interakt (just now)`;
            }
        } catch (err) {
            elPickerHost.innerHTML = '';
            elEmpty.style.display = 'block';
            elEmpty.textContent = err.message || 'Could not load templates from Interakt.';
            if (typeof Toast !== 'undefined') Toast.error(err.message || 'Template load failed');
        }
    }

    function renderPicker() {
        elPickerHost.innerHTML = '';
        if (allTemplates.length === 0) {
            elEmpty.style.display = 'block';
            return;
        }
        // Group by category so MARKETING/UTILITY/AUTHENTICATION buckets
        // are visually adjacent — the rep usually knows which bucket
        // they're after before browsing names.
        const grouped = {};
        allTemplates.forEach(t => {
            const cat = t.category || 'OTHER';
            if (!grouped[cat]) grouped[cat] = [];
            grouped[cat].push(t);
        });
        const options = [];
        Object.keys(grouped).sort().forEach(cat => {
            grouped[cat].forEach(t => {
                // Compose the dropdown label so the rep sees the
                // template name + language tag without expanding.
                options.push({
                    value: keyFor(t),
                    label: `${t.name} · ${t.language}`,
                    description: `${cat} — ${truncate(t.body_text || '', 80)}`,
                });
            });
        });
        // Destroy any prior instance so we don't leak event handlers
        // when the rep re-opens the modal with stale state.
        if (dropdown && typeof dropdown.destroy === 'function') {
            try { dropdown.destroy(); } catch (_) {}
        }
        dropdown = new SearchableDropdown(elPickerHost, {
            options,
            placeholder: 'Pick a template',
            searchPlaceholder: 'Search by name, language, category…',
            virtualScroll: options.length > 50,
            onChange: (value) => {
                const t = allTemplates.find(x => keyFor(x) === value);
                if (t) onTemplatePicked(t);
            },
        });
    }

    function keyFor(t) {
        // name+language is the canonical identity Meta enforces;
        // a tenant can have an EN and HI variant of the same name.
        return `${t.name}__${t.language}`;
    }

    // ─── Picked template → render params + preview ──────────────────────────
    function onTemplatePicked(t) {
        selectedTemplate = t;
        elMeta.style.display = 'block';
        elMeta.innerHTML = `
            <span class="wa-tpl-badge wa-tpl-badge-${(t.category || 'OTHER').toLowerCase()}">
                ${escapeHtml(t.category || 'OTHER')}
            </span>
            <span class="wa-tpl-lang">${escapeHtml(t.language || '')}</span>
        `;
        renderParamInputs(t);
        renderPreview(t);
        updateSendEnabled();
    }

    function renderParamInputs(t) {
        elParams.innerHTML = '';
        const headerCount = Number(t.header_param_count) || 0;
        const bodyCount = Number(t.body_param_count) || 0;
        if (headerCount === 0 && bodyCount === 0) {
            elParams.innerHTML = '<div class="wa-tpl-no-params">This template has no variables — Send when ready.</div>';
            return;
        }
        // Header placeholders are rare but Meta allows them on TEXT
        // headers. Render them first so they show up above body params,
        // matching the visual order of the rendered message.
        for (let i = 1; i <= headerCount; i++) {
            elParams.appendChild(buildParamRow(`header_${i}`, `Header {{${i}}}`));
        }
        for (let i = 1; i <= bodyCount; i++) {
            elParams.appendChild(buildParamRow(`body_${i}`, `Body {{${i}}}`));
        }
        // Live preview swap as the rep types.
        elParams.addEventListener('input', () => {
            renderPreview(selectedTemplate);
            updateSendEnabled();
        });
    }

    function buildParamRow(id, labelText) {
        const wrap = document.createElement('div');
        wrap.className = 'wa-tpl-param-row';
        wrap.innerHTML = `
            <label for="waTplParam_${id}">${escapeHtml(labelText)}</label>
            <input id="waTplParam_${id}" type="text" data-param-id="${id}" autocomplete="off" placeholder="Enter value">
        `;
        return wrap;
    }

    function readParams() {
        // Returns { header: [...], body: [...] } in positional order.
        // Empty strings count as filled — Meta accepts blank substitutions
        // and the rep may genuinely want a no-op slot (rare).
        const out = { header: [], body: [] };
        if (!selectedTemplate) return out;
        const headerCount = Number(selectedTemplate.header_param_count) || 0;
        const bodyCount = Number(selectedTemplate.body_param_count) || 0;
        for (let i = 1; i <= headerCount; i++) {
            const el = document.getElementById(`waTplParam_header_${i}`);
            out.header.push(el ? el.value : '');
        }
        for (let i = 1; i <= bodyCount; i++) {
            const el = document.getElementById(`waTplParam_body_${i}`);
            out.body.push(el ? el.value : '');
        }
        return out;
    }

    function renderPreview(t) {
        if (!t) return;
        const params = readParams();
        const lines = [];
        if (t.header_type === 'TEXT' && t.header_text) {
            lines.push(substitute(t.header_text, params.header));
        } else if (t.header_type && t.header_type !== 'NONE' && t.header_type !== 'TEXT') {
            lines.push(`📎 ${t.header_type} attachment (set on send)`);
        }
        if (t.body_text) lines.push(substitute(t.body_text, params.body));
        if (t.footer_text) lines.push('— ' + t.footer_text);
        if (t.buttons_json) {
            try {
                const btns = JSON.parse(t.buttons_json);
                if (Array.isArray(btns) && btns.length > 0) {
                    lines.push('');
                    btns.forEach(b => {
                        const txt = b.text || b.url || '';
                        const sigil = b.type === 'URL' ? '🔗' : b.type === 'PHONE_NUMBER' ? '📞' : '↩';
                        lines.push(`${sigil} ${txt}`);
                    });
                }
            } catch (_) { /* malformed buttons JSON — silently skip */ }
        }
        elPreview.textContent = lines.join('\n');
        elPreviewWrap.style.display = 'block';
    }

    function substitute(text, params) {
        // Replace {{N}} with params[N-1] for live preview. Empty values
        // render as the literal placeholder so the rep can spot
        // unfilled slots in the preview pane.
        if (!text) return '';
        return text.replace(/\{\{(\d+)\}\}/g, (_match, n) => {
            const idx = parseInt(n, 10) - 1;
            const v = params[idx];
            return v ? v : `{{${n}}}`;
        });
    }

    function updateSendEnabled() {
        // Block Send while any param input is empty — Interakt rejects
        // template sends with missing positional substitutions and
        // Meta charges nothing for the failed call, but the rep gets
        // a confusing error toast. Better to gate at the UI.
        if (!selectedTemplate) { elSend.disabled = true; return; }
        const params = readParams();
        const all = params.header.concat(params.body);
        const anyEmpty = all.some(v => !v || !v.trim());
        elSend.disabled = anyEmpty || sending;
    }

    // ─── Send ───────────────────────────────────────────────────────────────
    async function handleSend() {
        if (sending || !selectedTemplate) return;
        sending = true;
        elSend.disabled = true;
        const originalSendLabel = elSend.textContent;
        elSend.textContent = 'Sending…';
        try {
            const { countryCode, local } = splitPhone(currentRecipientPhone);
            const params = readParams();
            // /whatsapp/send takes a single flat templateParams array in
            // header-then-body order. The NS BSP layer composes them
            // back into Interakt's components shape.
            const flatParams = params.header.concat(params.body);

            // CRM body binding is JsonNamingPolicy.SnakeCaseLower (see
            // feedback_crm_snake_case_json memory). camelCase keys
            // silently bind to null which would send a malformed
            // template. Stick to snake_case here.
            const body = {
                business_phone_number: currentBusinessPhone || '',
                recipient_country_code: countryCode,
                recipient_phone: local,
                message_type: 'template',
                template_name: selectedTemplate.name,
                template_language: selectedTemplate.language,
                template_params: flatParams,
            };
            const resp = await api.request('/whatsapp/send', {
                method: 'POST',
                body: JSON.stringify(body),
                headers: { 'Content-Type': 'application/json' },
            });
            if (!resp || resp.success === false) {
                throw new Error((resp && resp.message) || 'Send failed');
            }
            if (typeof Toast !== 'undefined') Toast.success('Template sent');
            closeModal();
            if (onSentCallback) {
                try { onSentCallback(); } catch (e) { console.error('onSent callback threw', e); }
            }
        } catch (err) {
            const msg = err && err.message ? err.message : 'Send failed';
            if (typeof Toast !== 'undefined') Toast.error(msg);
        } finally {
            sending = false;
            elSend.textContent = originalSendLabel;
            updateSendEnabled();
        }
    }

    // ─── Helpers ────────────────────────────────────────────────────────────
    function splitPhone(digits) {
        // Inbox stores recipientPhone as country-code + 10-digit national
        // number, all digits. India is the common path (+91 + 10), but
        // we don't hard-code 91 — anything that isn't a final-10 chunk
        // becomes the country code.
        const clean = String(digits || '').replace(/\D/g, '');
        if (clean.length <= 10) {
            return { countryCode: '+91', local: clean };
        }
        const local = clean.slice(-10);
        const cc = '+' + clean.slice(0, clean.length - 10);
        return { countryCode: cc, local };
    }

    function humanizeFetchedAt(iso) {
        try {
            const then = new Date(iso).getTime();
            const diffSec = Math.max(0, Math.floor((Date.now() - then) / 1000));
            if (diffSec < 60) return `${diffSec}s ago`;
            if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
            return `${Math.floor(diffSec / 3600)}h ago`;
        } catch (_) { return 'recently'; }
    }

    function truncate(s, n) {
        if (!s) return '';
        return s.length > n ? s.slice(0, n - 1) + '…' : s;
    }

    function escapeHtml(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }
})();
