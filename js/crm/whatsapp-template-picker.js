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
            // resolveDom returns false when any required modal element is
            // missing — happens when the browser HTTP-cache served an old
            // inbox.html that predates the picker markup. Bail with a
            // friendly toast pointing the user at hard-reload rather than
            // throwing an opaque "innerHTML of null" deep in loadTemplates.
            if (!resolveDom()) {
                console.warn('[TemplatePicker] modal markup not in DOM — page is from stale HTTP cache');
                if (typeof Toast !== 'undefined') {
                    Toast.error('Template picker not yet loaded on this page. Hard-reload (Cmd+Shift+R / Ctrl+F5) to fetch the latest version.');
                } else {
                    alert('Template picker not loaded — please hard-reload the page (Cmd+Shift+R or Ctrl+F5).');
                }
                return;
            }
            wireOnce();
            showModal();
            // Fetch fresh (or cached) on every open so the rep sees newly
            // approved templates without page reload. The 5-min NS cache
            // makes this cheap.
            loadTemplates(false);
        },
    };

    // ─── DOM lookup ─────────────────────────────────────────────────────────
    // Returns true when every required element was found, false otherwise.
    // The picker JS ships before its HTML markup on first deploy — a user
    // whose browser HTTP-cached the old inbox.html will load the new picker
    // JS but be missing the modal scaffold. Bail cleanly in that case so
    // the only damage is a Toast asking them to hard-reload, not an
    // unhandled exception that breaks the whole composer.
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

        // SearchableDropdown.destroy() removes its container from the DOM.
        // If a prior open()/render destroyed the picker host, re-stamp a
        // fresh one into the .wa-tpl-row slot so loadTemplates's first
        // line (elPickerHost.innerHTML = …) doesn't throw. This is the
        // common case for the SECOND open of the modal — every other
        // element survives.
        if (!elPickerHost) {
            const slot = document.querySelector('.wa-tpl-row');
            if (slot) {
                const freshHost = document.createElement('div');
                freshHost.id = 'waTplPickerHost';
                slot.appendChild(freshHost);
                elPickerHost = freshHost;
            }
        }

        return !!(elModal && elClose && elCancel && elSend && elRefresh &&
                  elPickerHost && elParams && elPreview && elPreviewWrap &&
                  elMeta && elEmpty);
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
        // SearchableDropdown's destroy() does `parentNode.removeChild(this.container)`
        // — it removes the host element from the DOM entirely. If we just
        // destroyed and rebuilt against the original elPickerHost, the next
        // open() would find #waTplPickerHost missing and resolveDom would
        // bail. Recreate a fresh host div each render: stamp a new one
        // into the slot, replace the prior one in the DOM, then point
        // elPickerHost at it before handing to the dropdown.
        if (dropdown && typeof dropdown.destroy === 'function') {
            try { dropdown.destroy(); } catch (_) {}
        }
        const slot = document.querySelector('.wa-tpl-row'); // stable parent
        const freshHost = document.createElement('div');
        freshHost.id = 'waTplPickerHost';
        if (slot) {
            const old = document.getElementById('waTplPickerHost');
            if (old && old.parentNode) {
                old.parentNode.replaceChild(freshHost, old);
            } else {
                slot.appendChild(freshHost);
            }
        }
        elPickerHost = freshHost;

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
        // Marker class on the portaled menu so CSS can give template options
        // their own layout (label-above-description) without leaking to every
        // other SearchableDropdown on the page. The library portals menuEl
        // to <body>, so a parent-scoped selector (.wa-tpl-modal-backdrop …)
        // can't reach it.
        if (dropdown && dropdown.menuEl) {
            dropdown.menuEl.classList.add('wa-tpl-menu');
        }
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
        // Reclassification lint (#3): scan body_text for phrases Meta
        // has been silently flipping from UTILITY → MARKETING in India,
        // which 2-3x's per-send cost. The current Wisetrack template
        // "Hi {{1}}, following up on our last conversation dated
        // {{2}}…" is exactly the sort of phrasing that gets flipped.
        // Match is case-insensitive on substring — we err on the side
        // of false positives because a misclassification is way more
        // painful than a "this looks like marketing" warning.
        // English + Hindi/Hinglish corpus of phrases Meta's classifier has
        // been silently flipping UTILITY → MARKETING in India. Maintained
        // alongside the reference_whatsapp_utility_template_rules memory.
        // Match is case-insensitive substring (English Latin script) +
        // exact substring (Devanagari, case is irrelevant there).
        const utilityRiskPhrases = [
            // English
            'following up',
            "hope you're doing well",
            'hope you are doing well',
            'just checking in',
            "let's discuss",
            'lets discuss',
            'special offer',
            'limited time',
            'check out our',
            'gentle reminder',
            'last chance',
            "don't miss",
            'dont miss',
            'exclusive offer',
            'big discount',
            // Hindi (Devanagari) — common transactional-but-Marketing-flagged hooks
            'ज़रा सोचिए',          // "just imagine" — promo opener
            'जरा सोचिए',
            'क्या आप जानते',         // "do you know"
            'विशेष ऑफर',           // "special offer"
            'आज ही',               // "today only" / urgency
            'सीमित समय',           // "limited time"
            'सबसे अच्छा',           // "the best"
            'मौका न गंवाएं',         // "don't miss the chance"
            'मुफ्त में',             // "for free"
            'भारी छूट',            // "huge discount"
            // Hinglish / Roman-script Hindi
            'aap ke liye',
            'special discount',
            'limited stock',
            'free trial',
            'aaj hi',
            'mauka',
        ];
        const bodyLower = (t.body_text || '').toLowerCase();
        const matchedRisks = utilityRiskPhrases.filter(p => bodyLower.includes(p));
        const isUtilityCategory = (t.category || '').toUpperCase() === 'UTILITY';
        const showReclassificationWarning = isUtilityCategory && matchedRisks.length > 0;
        // Buttons + non-integer placeholder lint (#6): surface malformed
        // input to the rep instead of silently dropping. The render
        // pipeline already skips them; we just narrate the skip.
        let buttonsBroken = false;
        if (t.buttons_json) {
            try { JSON.parse(t.buttons_json); }
            catch (_) { buttonsBroken = true; }
        }
        const nonIntPlaceholders = ((t.body_text || '').match(/\{\{[^}]+\}\}/g) || [])
            .filter(tok => !/^\{\{\d+\}\}$/.test(tok));

        elMeta.innerHTML = `
            <span class="wa-tpl-badge wa-tpl-badge-${(t.category || 'OTHER').toLowerCase()}"
                  title="Meta re-classifies every send. UTILITY templates with sales-y phrasing
get silently flipped to MARKETING (2-3x cost in India).">
                ${escapeHtml(t.category || 'OTHER')}
            </span>
            <span class="wa-tpl-lang">${escapeHtml(t.language || '')}</span>
            ${showReclassificationWarning ? `
                <div class="wa-tpl-warning wa-tpl-warning--reclass">
                    ⚠ This UTILITY template contains phrases Meta has been flipping to
                    MARKETING category in India (2-3× cost). Watch for:
                    <em>${matchedRisks.map(escapeHtml).join(', ')}</em>.
                    Send anyway, but verify with your next month's invoice.
                </div>
            ` : ''}
            ${buttonsBroken ? `
                <div class="wa-tpl-warning wa-tpl-warning--info">
                    ℹ Template's buttons metadata is malformed — preview omits buttons
                    but the send itself still works (Interakt renders them server-side).
                </div>
            ` : ''}
            ${nonIntPlaceholders.length > 0 ? `
                <div class="wa-tpl-warning wa-tpl-warning--info">
                    ℹ Body text has non-numeric placeholders that Meta will treat as
                    literal text: <em>${escapeHtml(nonIntPlaceholders.join(', '))}</em>.
                </div>
            ` : ''}
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
        // Race-guard: sending is flipped SYNCHRONOUSLY before any await,
        // so a second rapid click sees sending=true and bails. The
        // disabled flag on elSend backs this up visually but is not the
        // primary defense (could be re-enabled by stray DOM mutations).
        if (sending || !selectedTemplate) return;
        sending = true;
        elSend.disabled = true;
        const originalSendLabel = elSend.textContent;
        elSend.textContent = 'Sending…';
        try {
            const { countryCode, local } = splitPhone(currentRecipientPhone);
            const params = readParams();

            // Compute the substituted body text so the CRM persists it on
            // the outbound row. Without this the inbox bubble renders
            // "(empty)" — the controller falls back to caption/body for
            // non-text sends, and templates carry neither natively.
            // Substituting client-side keeps the bubble pixel-accurate to
            // the live-preview the rep just confirmed; Interakt does the
            // canonical render server-side, but the body content matches.
            const renderedBody = substitute(selectedTemplate.body_text || '', params.body);

            // CRM body binding is JsonNamingPolicy.SnakeCaseLower (see
            // feedback_crm_snake_case_json memory). camelCase keys
            // silently bind to null which would send a malformed
            // template. Stick to snake_case here.
            //
            // Header and body placeholder values travel as INDEPENDENT
            // arrays end-to-end: Meta numbers header {{N}} and body {{N}}
            // separately, so flattening them would bind the wrong value
            // to the header slot. Backend (CRM controller → NS BL →
            // Interakt) forwards each into the matching component.
            const body = {
                business_phone_number: currentBusinessPhone || '',
                recipient_country_code: countryCode,
                recipient_phone: local,
                message_type: 'template',
                body: renderedBody,
                template_name: selectedTemplate.name,
                template_language: selectedTemplate.language,
                template_header_params: params.header,
                template_body_params: params.body,
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
            // Stale-cache detection (#4): when the template was deleted
            // on Interakt after we cached it, Meta/Interakt return
            // 404-ish errors. Surface a refresh CTA so the rep doesn't
            // assume "the app is broken" — single-click recovery.
            const looksStale =
                /\b(template[_ ]?name|does not exist|not found|invalid template|404)\b/i.test(msg);
            if (looksStale && typeof Toast !== 'undefined') {
                // Toast.error supports an optional action via .show with
                // custom config; fall back to chained toasts if not.
                if (Toast.show) {
                    Toast.show({
                        type: 'error',
                        message: 'Template no longer exists in Interakt. Refresh to load the latest list.',
                        action: { label: 'Refresh', onClick: () => loadTemplates(true) },
                        duration: 8000,
                    });
                } else {
                    Toast.error('Template no longer exists in Interakt — click Refresh and try again.');
                    setTimeout(() => loadTemplates(true), 500);
                }
            } else if (typeof Toast !== 'undefined') {
                Toast.error(msg);
            }
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
