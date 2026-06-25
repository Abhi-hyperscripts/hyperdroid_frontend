/**
 * Bulk WhatsApp Send Modal — 4-step wizard.
 *
 * Mounted on leads.html; opens when the rep clicks "WhatsApp" in the
 * bulk-action toolbar (after selecting ≥2 leads). The four steps:
 *
 *   1. Recipients — show selected leads with names + phones; auto-flag
 *      missing/invalid phones; allow deselect.
 *   2. Template   — picker (server returns approved-only); variable
 *      mapping (per-placeholder: lead field OR static value).
 *   3. Preview    — render the first 3 + last 1 recipient with their
 *      resolved values so the rep eyeballs the output.
 *   4. Send       — confirm CTA → POST /api/whatsapp/bulk-send → swap
 *      pane to live progress (polls /bulk-send/{id} every 2s).
 *
 * Behaviour locked in by the survey decisions:
 *   • Any CRM_USER can launch — no client-side role gate; backend
 *     enforces the [Authorize] attribute.
 *   • Always template — no free-form path even when last inbound < 24h.
 *   • Skip silently — bad rows are dropped client-side too with a
 *     visible warning, never block the batch.
 *
 * The wizard state lives in a single module-private `state` object so
 * the back/next handlers can read+write a single source of truth.
 * Mounting is via direct DOM ids (no framework); same pattern as the
 * lead-qr-modal that ships next to this file.
 */
(function () {
    'use strict';

    // ─── Module state ────────────────────────────────────────────

    const STEPS = ['recipients', 'template', 'preview', 'send'];

    const state = {
        step: 'recipients',
        // Recipients the modal was opened with. Each entry has the
        // shape produced by gatherSelectedLeads() below.
        recipients: [],
        // Tenant's configured WA business numbers (loaded on open).
        numbers: [],
        // Currently-selected sender number.
        businessPhone: '',
        // Templates fetched from the server (approved-only).
        templates: [],
        // Currently-selected template object.
        template: null,
        // Per-placeholder mapping. Two flavours:
        //   { type: 'lead_field', field: 'first_name' }
        //   { type: 'static',     value: 'Batuk Sharma' }
        // header/body each have their own positional list.
        headerMapping: [],
        bodyMapping: [],
        // Created batch (after POST succeeds).
        batchId: null,
        pollHandle: null,
    };

    /** Which lead fields the BL whitelists. Keep in sync with
     *  BusinessLayer_WhatsAppBulkSends.ResolveLeadField — the picker
     *  must offer exactly these or the rep ends up wondering why a
     *  field "didn't work". */
    const LEAD_FIELD_OPTIONS = [
        { value: 'first_name',       label: 'First name' },
        { value: 'last_name',        label: 'Last name' },
        { value: 'full_name',        label: 'Full name' },
        { value: 'email',            label: 'Email' },
        { value: 'phone',            label: 'Phone' },
        { value: 'company',          label: 'Company' },
        { value: 'job_title',        label: 'Job title' },
        { value: 'city',             label: 'City' },
        { value: 'state',            label: 'State' },
        { value: 'country',          label: 'Country' },
        { value: 'lead_number',      label: 'Lead number' },
        { value: 'product_interest', label: 'Product interest' },
    ];

    // ─── Helpers ─────────────────────────────────────────────────

    function esc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    /** Pull the in-memory selected-lead cache from leads.js. The cache
     *  holds every row the user has scrolled through; selections survive
     *  pagination because leads.js maintains it across requests. */
    function gatherSelectedLeads() {
        if (typeof selectedLeadIds === 'undefined' || selectedLeadIds.size === 0) {
            return [];
        }
        const cache = (typeof selectedLeadsData !== 'undefined') ? selectedLeadsData : new Map();
        const all = (typeof allLeads !== 'undefined') ? allLeads : [];
        const out = [];
        for (const id of selectedLeadIds) {
            const lead = cache.get(id) || all.find(x => x.id === id);
            if (!lead) {
                // Selected from a page we haven't reloaded — include a
                // stub so the count is honest; the table row will warn
                // that the lead data is missing.
                out.push({ id, _stub: true });
                continue;
            }
            out.push({
                id: lead.id,
                first_name: lead.firstName || lead.first_name || '',
                last_name:  lead.lastName  || lead.last_name  || '',
                full_name:  `${lead.firstName || lead.first_name || ''} ${lead.lastName || lead.last_name || ''}`.trim(),
                email:      lead.email || '',
                phone:      lead.phone || '',
                company:    lead.companyName || lead.company_name || '',
                job_title:  lead.jobTitle || lead.job_title || '',
                city:       lead.city || '',
                state:      lead.state || '',
                country:    lead.country || '',
                lead_number:     lead.leadNumber || lead.lead_number || '',
                product_interest: lead.productInterest || lead.product_interest || '',
            });
        }
        return out;
    }

    /** Cheap client-side phone classifier mirroring the BL skip rules.
     *  We don't try to be perfect — the server is the source of truth.
     *  This just paints the warning before the rep clicks "send" so
     *  they're not surprised by the skip report.
     *  Returns "ok" / "missing" / "invalid". */
    function classifyPhone(raw) {
        if (raw == null || String(raw).trim() === '') return 'missing';
        const digits = String(raw).replace(/[^0-9]/g, '');
        if (digits.length < 7) return 'invalid';
        // 10-digit (defaults to +91), or 11-15 digits with cc; everything
        // else is suspicious. Matches the BL's normaliser branches.
        if (digits.length === 10) return 'ok';
        if (digits.length >= 11 && digits.length <= 15) return 'ok';
        // +<10 digits> edge case the BL also accepts (we added this
        // during local integration testing).
        if (String(raw).trim().startsWith('+') && digits.length >= 8 && digits.length <= 10) return 'ok';
        return 'invalid';
    }

    function setStep(step) {
        if (!STEPS.includes(step)) return;
        state.step = step;
        // Stepper visual state.
        document.querySelectorAll('#bulkWaStepper .bulk-wa-step').forEach(el => {
            const id = el.dataset.step;
            el.classList.remove('is-active', 'is-done');
            if (id === step) el.classList.add('is-active');
            else if (STEPS.indexOf(id) < STEPS.indexOf(step)) el.classList.add('is-done');
        });
        // Pane swap.
        document.querySelectorAll('#bulkWaBody .bulk-wa-pane').forEach(el => {
            el.style.display = (el.dataset.pane === step) ? '' : 'none';
        });
        // Footer button visibility.
        const backBtn = document.getElementById('bulkWaBackBtn');
        const nextBtn = document.getElementById('bulkWaNextBtn');
        backBtn.style.display = (step === 'recipients' || state.batchId) ? 'none' : '';
        if (state.batchId) {
            // We're showing the live progress pane; the "Next" button
            // becomes "Cancel batch" once a batch is in flight.
            nextBtn.textContent = 'Cancel batch';
            nextBtn.classList.remove('btn-primary');
            nextBtn.classList.add('btn-outline-danger');
        } else if (step === 'send') {
            nextBtn.textContent = 'Send';
            nextBtn.classList.remove('btn-outline-danger');
            nextBtn.classList.add('btn-primary');
        } else {
            nextBtn.textContent = 'Next';
            nextBtn.classList.remove('btn-outline-danger');
            nextBtn.classList.add('btn-primary');
        }
        // Render the step's contents.
        if (step === 'recipients') renderRecipientsPane();
        else if (step === 'template') renderTemplatePane();
        else if (step === 'preview')  renderPreviewPane();
        else if (step === 'send')     renderSendPane();
    }

    // ─── Step 1: Recipients ──────────────────────────────────────

    function renderRecipientsPane() {
        const total = state.recipients.length;
        const phoneFlags = state.recipients.map(r => ({ id: r.id, klass: classifyPhone(r.phone) }));
        const ok = phoneFlags.filter(p => p.klass === 'ok').length;
        const bad = total - ok;
        const summary = document.getElementById('bulkWaRecipientsSummary');
        summary.innerHTML = `
            <div class="bulk-wa-summary-stat is-good">
                <div class="num">${total}</div>
                <div class="label">Selected</div>
            </div>
            <div class="bulk-wa-summary-stat ${ok === total ? 'is-good' : ''}">
                <div class="num">${ok}</div>
                <div class="label">Will receive</div>
            </div>
            ${bad > 0 ? `
            <div class="bulk-wa-summary-stat is-warn">
                <div class="num">${bad}</div>
                <div class="label">Will be skipped</div>
            </div>` : ''}
        `;
        const table = document.getElementById('bulkWaRecipientsTable');
        if (total === 0) {
            table.innerHTML = `<div style="padding:24px;text-align:center;color:var(--text-secondary);">No recipients left. Add some leads on the previous screen.</div>`;
            return;
        }
        table.innerHTML = state.recipients.map(r => {
            const klass = classifyPhone(r.phone);
            const skipReason = klass === 'missing' ? 'no phone'
                               : klass === 'invalid' ? 'invalid phone'
                               : null;
            return `
                <div class="bulk-wa-recipient-row ${skipReason ? 'is-skipped' : ''}" data-lead-id="${esc(r.id)}">
                    <div>
                        <span class="bulk-wa-recipient-name">${esc(r.full_name || r.first_name || r.id.slice(0, 8))}</span>
                        ${skipReason ? `<span class="bulk-wa-recipient-skip-reason">${esc(skipReason)}</span>` : ''}
                    </div>
                    <div class="bulk-wa-recipient-phone">${esc(r.phone || '—')}</div>
                    <button type="button" class="bulk-wa-recipient-remove" title="Remove from this batch"
                        onclick="bulkWaRemoveRecipient('${esc(r.id)}')">×</button>
                </div>
            `;
        }).join('');
    }

    function removeRecipient(leadId) {
        state.recipients = state.recipients.filter(r => r.id !== leadId);
        renderRecipientsPane();
    }

    // ─── Step 2: Template + variable mapping ─────────────────────

    async function loadWaContext() {
        // Load business numbers + templates independently so a flaky
        // templates endpoint doesn't kill the number picker. Use
        // Promise.allSettled so we always get partial state instead
        // of all-or-nothing. The pane render shows a clear warning
        // when either piece is missing so the rep knows what's up.
        const [numbersResult, templatesResult] = await Promise.allSettled([
            api.request('/whatsapp/numbers'),
            api.request('/whatsapp/templates'),
        ]);
        if (numbersResult.status === 'fulfilled') {
            state.numbers = (numbersResult.value && numbersResult.value.numbers) || [];
            if (state.numbers.length > 0 && !state.businessPhone) {
                state.businessPhone = state.numbers[0].business_phone_number;
            }
        } else {
            console.error('[BulkWA] failed to load WA numbers', numbersResult.reason);
        }
        if (templatesResult.status === 'fulfilled') {
            state.templates = (templatesResult.value && templatesResult.value.templates) || [];
        } else {
            console.error('[BulkWA] failed to load WA templates', templatesResult.reason);
            if (typeof Toast !== 'undefined') {
                Toast.error('Could not load templates — check Settings → WhatsApp');
            }
        }
        // Re-render in case we landed on the template step before the
        // promises resolved (race on a slow API).
        if (state.step === 'template') renderTemplatePane();
    }

    function renderTemplatePane() {
        // Build the number picker (if more than one).
        const numMount = document.getElementById('bulkWaNumberMount');
        if (state.numbers.length <= 1) {
            const n = state.numbers[0];
            numMount.innerHTML = n
                ? `<div style="padding:8px 12px;color:var(--text-secondary);font-size:13px;">From <strong style="color:var(--text-primary);">+${esc(n.business_phone_number)}</strong></div>`
                : `<div style="padding:8px 12px;color:var(--color-warning);font-size:13px;">No WhatsApp number configured for this tenant — set one up in Settings first.</div>`;
        } else {
            numMount.innerHTML = `
                <select class="form-control bulk-wa-mapping-type" id="bulkWaBusinessPhone">
                    ${state.numbers.map(n => `
                        <option value="${esc(n.business_phone_number)}" ${state.businessPhone === n.business_phone_number ? 'selected' : ''}>
                            +${esc(n.business_phone_number)}
                        </option>
                    `).join('')}
                </select>
            `;
            document.getElementById('bulkWaBusinessPhone').addEventListener('change', e => {
                state.businessPhone = e.target.value;
            });
        }

        // Template picker.
        const tmplMount = document.getElementById('bulkWaTemplateMount');
        if (state.templates.length === 0) {
            tmplMount.innerHTML = `<div style="padding:8px 12px;color:var(--color-warning);font-size:13px;">No approved templates available. Submit a template in your Interakt dashboard first.</div>`;
            document.getElementById('bulkWaTemplateBody').innerHTML = '';
            document.getElementById('bulkWaMapping').innerHTML = '';
            return;
        }
        tmplMount.innerHTML = `
            <select class="form-control bulk-wa-mapping-type" id="bulkWaTemplateSelect">
                <option value="">— Pick a template —</option>
                ${state.templates.map(t => `
                    <option value="${esc(t.name)}|${esc(t.language || 'en')}"
                            ${state.template && state.template.name === t.name && (state.template.language || 'en') === (t.language || 'en') ? 'selected' : ''}>
                        ${esc(t.name)} (${esc(t.language || 'en')}) · ${esc(t.category || '')}
                    </option>
                `).join('')}
            </select>
        `;
        document.getElementById('bulkWaTemplateSelect').addEventListener('change', e => {
            const [name, lang] = (e.target.value || '').split('|');
            state.template = state.templates.find(t => t.name === name && (t.language || 'en') === lang) || null;
            // Reset mapping when template changes — old positional
            // values almost certainly don't apply.
            state.headerMapping = buildEmptyMapping(state.template, 'header');
            state.bodyMapping   = buildEmptyMapping(state.template, 'body');
            renderTemplateBodyAndMapping();
        });
        renderTemplateBodyAndMapping();
    }

    function buildEmptyMapping(template, kind) {
        if (!template) return [];
        const count = countPlaceholders(getTemplateText(template, kind));
        const out = [];
        for (let i = 0; i < count; i++) {
            // Heuristic defaults that save the rep a tap: most v1
            // templates use first_name as their first variable.
            out.push(i === 0 && kind === 'body'
                ? { type: 'lead_field', field: 'first_name' }
                : { type: 'static', value: '' });
        }
        return out;
    }

    function getTemplateText(template, kind) {
        // Different BSPs name these fields differently. Try the common
        // shapes from Interakt + Meta's catalog formats.
        if (!template) return '';
        if (kind === 'header') {
            return template.header_text || template.headerText || (template.header && template.header.text) || '';
        }
        return template.body_text || template.bodyText || template.body || '';
    }

    function countPlaceholders(text) {
        if (!text) return 0;
        // Meta-approved templates use {{1}}, {{2}}, ... — count the
        // distinct positional placeholders (some templates repeat
        // {{1}} so we collect unique numbers then take max).
        const matches = String(text).matchAll(/\{\{(\d+)\}\}/g);
        let max = 0;
        for (const m of matches) {
            const n = parseInt(m[1], 10);
            if (n > max) max = n;
        }
        return max;
    }

    function renderTemplateBodyAndMapping() {
        const bodyEl = document.getElementById('bulkWaTemplateBody');
        const mapEl  = document.getElementById('bulkWaMapping');
        if (!state.template) {
            bodyEl.innerHTML = '';
            mapEl.innerHTML = '';
            return;
        }
        const bodyText = getTemplateText(state.template, 'body');
        // Render the template body with placeholders styled as
        // little badges so the rep can SEE where each value lands.
        bodyEl.innerHTML = esc(bodyText).replace(/\{\{(\d+)\}\}/g, (_m, n) =>
            `<span class="var-token">{{${n}}}</span>`);
        // Build mapping rows for body params (header support deferred —
        // very few approved templates use header variables; revisit
        // when a real customer hits this).
        if (state.bodyMapping.length === 0) {
            mapEl.innerHTML = `<p style="font-size:12.5px;color:var(--text-secondary);margin:0;">This template has no variables — nothing to map.</p>`;
            return;
        }
        mapEl.innerHTML = state.bodyMapping.map((m, i) => `
            <div class="bulk-wa-mapping-row" data-idx="${i}">
                <div class="bulk-wa-mapping-label">{{${i + 1}}}</div>
                <select class="bulk-wa-mapping-type" data-idx="${i}" data-role="type">
                    <option value="lead_field" ${m.type === 'lead_field' ? 'selected' : ''}>Lead field</option>
                    <option value="static"     ${m.type === 'static'     ? 'selected' : ''}>Static text</option>
                </select>
                ${m.type === 'lead_field' ? `
                    <select class="bulk-wa-mapping-value" data-idx="${i}" data-role="value">
                        ${LEAD_FIELD_OPTIONS.map(f => `
                            <option value="${esc(f.value)}" ${m.field === f.value ? 'selected' : ''}>${esc(f.label)}</option>
                        `).join('')}
                    </select>
                ` : `
                    <input type="text" class="bulk-wa-mapping-value" data-idx="${i}" data-role="value"
                           value="${esc(m.value || '')}" placeholder="Type the value everyone gets…">
                `}
            </div>
        `).join('');
        // Wire change handlers — single delegated listener on the
        // container is cheaper than per-row bindings.
        mapEl.querySelectorAll('[data-role]').forEach(el => {
            el.addEventListener('change', onMappingChange);
            el.addEventListener('input',  onMappingChange);
        });
    }

    function onMappingChange(e) {
        const idx  = parseInt(e.target.dataset.idx, 10);
        const role = e.target.dataset.role;
        const m = state.bodyMapping[idx];
        if (!m) return;
        if (role === 'type') {
            const newType = e.target.value;
            state.bodyMapping[idx] = newType === 'lead_field'
                ? { type: 'lead_field', field: 'first_name' }
                : { type: 'static', value: '' };
            renderTemplateBodyAndMapping(); // re-render so the value
            // control swaps between <select> and <input>.
        } else if (role === 'value') {
            if (m.type === 'lead_field') m.field = e.target.value;
            else m.value = e.target.value;
        }
    }

    // ─── Step 3: Preview ─────────────────────────────────────────

    function renderPreviewPane() {
        const live = state.recipients.filter(r => classifyPhone(r.phone) === 'ok');
        const sample = live.slice(0, 3);
        if (live.length > 4) sample.push(live[live.length - 1]);
        const cards = document.getElementById('bulkWaPreviewCards');
        if (sample.length === 0 || !state.template) {
            cards.innerHTML = `<div style="padding:24px;text-align:center;color:var(--text-secondary);">Pick a template and at least one recipient with a valid phone to preview.</div>`;
            return;
        }
        const bodyText = getTemplateText(state.template, 'body');
        cards.innerHTML = sample.map(r => {
            const rendered = bodyText.replace(/\{\{(\d+)\}\}/g, (_m, n) => {
                const m = state.bodyMapping[parseInt(n, 10) - 1];
                if (!m) return `{{${n}}}`;
                if (m.type === 'static') return m.value || ' ';
                return r[m.field] || ' ';
            });
            return `
                <div class="bulk-wa-preview-card">
                    <div class="bulk-wa-preview-card-head">
                        <span class="bulk-wa-preview-card-name">${esc(r.full_name || r.first_name)}</span>
                        <span class="bulk-wa-preview-card-phone">${esc(r.phone)}</span>
                    </div>
                    <div class="bulk-wa-preview-card-body">${esc(rendered)}</div>
                </div>
            `;
        }).join('');
    }

    // ─── Step 4: Send + progress ─────────────────────────────────

    function renderSendPane() {
        if (state.batchId) {
            // Once a batch is created the same pane is shown but
            // we swap the intro for the progress strip. updatePollData
            // populates the stats; the user just sees them rolling.
            document.getElementById('bulkWaSendIntro').style.display = 'none';
            document.getElementById('bulkWaProgress').style.display = '';
            return;
        }
        document.getElementById('bulkWaSendIntro').style.display = '';
        document.getElementById('bulkWaProgress').style.display = 'none';
        const ok = state.recipients.filter(r => classifyPhone(r.phone) === 'ok').length;
        const skip = state.recipients.length - ok;
        const sum = document.getElementById('bulkWaConfirmSummary');
        sum.innerHTML = `
            <div><div class="label">Will send</div><div class="value">${ok}</div></div>
            ${skip > 0 ? `<div><div class="label">Skipped</div><div class="value" style="color:var(--color-warning);">${skip}</div></div>` : ''}
            <div><div class="label">Template</div><div class="value">${esc(state.template ? state.template.name : '—')}</div></div>
            <div><div class="label">From</div><div class="value">+${esc(state.businessPhone)}</div></div>
            <div><div class="label">Pacing</div><div class="value">~1 / sec</div></div>
        `;
    }

    /// <summary>
    /// Friendly explanations for the most common Meta error codes the
    /// rep will hit. Keys are extracted by NS from data.errors[].code.
    /// When a recipient's error_message starts with one of these codes,
    /// show the friendly explanation INSTEAD of the raw error so the
    /// rep understands what to do (or why it's not their fault).
    /// </summary>
    const META_ERROR_EXPLANATIONS = {
        '131049': {
            label: 'Meta marketing throttle',
            help: "Meta limits how many marketing messages a single user receives across all businesses. They throttled this delivery because the recipient was less likely to engage. Try again in 24h, or use a Utility template if the message is transactional.",
        },
        '131026': {
            label: 'Undeliverable',
            help: "Phone is invalid, blocked, or the recipient opted out of WhatsApp business messages.",
        },
        '131047': {
            label: 'Outside 24h window',
            help: "More than 24 hours since the recipient last messaged you, and Meta wouldn't accept the template. Resubmit the template for approval if it's been rejected.",
        },
        '132001': {
            label: 'Template paused',
            help: "Meta paused this template because of low quality scores. Submit a fresh variant in your BSP dashboard.",
        },
        '132012': {
            label: 'Template parameter mismatch',
            help: "The template variables don't match what Meta approved. Check the {{N}} count against the approved version.",
        },
    };

    function classifyError(errorMessage) {
        if (!errorMessage) return null;
        // NS forwards errors as "{code} — {title}: {detail}". Pluck the
        // leading code via a tight regex; fall back to substring match
        // for older string-only error_messages.
        const match = String(errorMessage).match(/^(\d{6})\b/);
        if (match && META_ERROR_EXPLANATIONS[match[1]]) {
            return { code: match[1], ...META_ERROR_EXPLANATIONS[match[1]], raw: errorMessage };
        }
        return null;
    }

    async function loadRecipientsDetail() {
        if (!state.batchId) return [];
        try {
            const resp = await api.request(`/whatsapp/bulk-send/${state.batchId}/recipients`);
            return (resp && resp.recipients) || [];
        } catch (err) {
            console.error('[BulkWA] failed to load recipient detail', err);
            return [];
        }
    }

    function renderRecipientsBreakdown(recipients) {
        if (!recipients || recipients.length === 0) return '';
        // Group by status priority
        const failed = recipients.filter(r => r.status === 'failed' || r.status === 'cancelled' || r.status === 'skipped');
        const success = recipients.filter(r => r.status === 'delivered' || r.status === 'read');
        const inFlight = recipients.filter(r => r.status === 'sent' || r.status === 'sending' || r.status === 'pending');
        if (failed.length === 0 && success.length === 0 && inFlight.length === 0) return '';

        const card = (r, statusKlass) => {
            const err = classifyError(r.error_message);
            const errDisplay = err
                ? `<div class="bulk-wa-detail-err"><strong>${esc(err.code)} — ${esc(err.label)}</strong><div class="bulk-wa-detail-err-help">${esc(err.help)}</div></div>`
                : (r.error_message ? `<div class="bulk-wa-detail-err">${esc(r.error_message)}</div>` : '');
            return `
                <div class="bulk-wa-detail-row is-${statusKlass}">
                    <div class="bulk-wa-detail-phone">${esc(r.phone)} ${r.recipient_name ? `<span class="bulk-wa-detail-name">· ${esc(r.recipient_name)}</span>` : ''}</div>
                    <div class="bulk-wa-detail-status">${esc(r.status)}</div>
                    ${errDisplay}
                </div>`;
        };
        let html = '';
        if (failed.length > 0) {
            html += `<h4 class="bulk-wa-detail-section-h">Needs attention (${failed.length})</h4>`;
            html += failed.map(r => card(r, 'fail')).join('');
        }
        if (inFlight.length > 0) {
            html += `<h4 class="bulk-wa-detail-section-h">In flight (${inFlight.length})</h4>`;
            html += inFlight.map(r => card(r, 'inflight')).join('');
        }
        if (success.length > 0) {
            html += `<h4 class="bulk-wa-detail-section-h">Delivered (${success.length})</h4>`;
            html += success.map(r => card(r, 'ok')).join('');
        }
        return html;
    }

    async function refreshRecipientDetail() {
        // Only fetch detail on terminal-batch refresh (when it's actually
        // useful) AND on the failed-count being non-zero. Avoids
        // hammering the endpoint during a healthy run.
        if (!state.lastPoll) return;
        const c = state.lastPoll.counts || {};
        const hasFailures = (c.failed || 0) + (c.skipped || 0) + (c.cancelled || 0) > 0;
        const isTerminal = ['completed','cancelled','failed'].includes(state.lastPoll.status);
        if (!hasFailures && !isTerminal) return;
        const recipients = await loadRecipientsDetail();
        const mountId = 'bulkWaRecipientBreakdown';
        let mount = document.getElementById(mountId);
        if (!mount) {
            const progressPane = document.querySelector('.bulk-wa-pane[data-pane="send"] #bulkWaProgress');
            if (!progressPane) return;
            mount = document.createElement('div');
            mount.id = mountId;
            mount.className = 'bulk-wa-recipient-breakdown';
            progressPane.appendChild(mount);
        }
        mount.innerHTML = renderRecipientsBreakdown(recipients);
    }

    function updatePollData(data) {
        // Stash for stepNext (cancel button) to branch on.
        state.lastPoll = data;
        const c = data.counts || {};
        const total = data.total_count || 1;
        const done = (c.sent || 0) + (c.delivered || 0) + (c.read || 0) + (c.failed || 0) + (c.skipped || 0) + (c.cancelled || 0);
        const pct = Math.max(2, Math.round((done / total) * 100));
        document.getElementById('bulkWaProgressBarInner').style.width = pct + '%';
        document.getElementById('bulkWaProgressStats').innerHTML = `
            <div class="bulk-wa-progress-stat is-pending">
                <div class="num">${(c.pending || 0) + (c.sending || 0)}</div>
                <div class="label">Pending</div>
            </div>
            <div class="bulk-wa-progress-stat is-sent">
                <div class="num">${c.sent || 0}</div>
                <div class="label">Sent</div>
            </div>
            <div class="bulk-wa-progress-stat is-delivered">
                <div class="num">${(c.delivered || 0) + (c.read || 0)}</div>
                <div class="label">Delivered</div>
            </div>
            <div class="bulk-wa-progress-stat is-failed">
                <div class="num">${(c.failed || 0) + (c.skipped || 0) + (c.cancelled || 0)}</div>
                <div class="label">Failed</div>
            </div>
        `;
        // Refresh the per-recipient detail breakdown when failures exist
        // or the batch is terminal. Fire-and-forget — don't block the
        // poll cycle on the detail fetch.
        refreshRecipientDetail();

        let note;
        if (data.status === 'completed') {
            const ok = (c.delivered || 0) + (c.read || 0);
            const sentNotYetDelivered = c.sent || 0;
            const bad = (c.failed || 0) + (c.skipped || 0) + (c.cancelled || 0);
            const noteParts = [`Batch complete`];
            if (ok > 0) noteParts.push(`${ok} delivered`);
            if (sentNotYetDelivered > 0) noteParts.push(`${sentNotYetDelivered} sent (awaiting delivery receipt)`);
            if (bad > 0) noteParts.push(`${bad} failed`);
            note = noteParts.join(' — ');
            stopPolling();
            // Flip the cancel button to "Close" once the batch is done.
            const nextBtn = document.getElementById('bulkWaNextBtn');
            nextBtn.textContent = 'Close';
            nextBtn.classList.remove('btn-outline-danger');
            nextBtn.classList.add('btn-primary');
        } else if (data.status === 'cancelled') {
            note = `Batch cancelled. ${c.sent + c.delivered + c.read} already-sent messages can't be unsent.`;
            stopPolling();
            const nextBtn = document.getElementById('bulkWaNextBtn');
            nextBtn.textContent = 'Close';
            nextBtn.classList.remove('btn-outline-danger');
            nextBtn.classList.add('btn-primary');
        } else if (data.status === 'failed') {
            note = `Batch failed to start — check your WhatsApp configuration.`;
            stopPolling();
        } else if (data.status === 'queued') {
            note = `Queued — the drainer ticks once a minute; first send fires within ~60s.`;
        } else {
            note = `Sending… ${done} of ${total} processed.`;
        }
        document.getElementById('bulkWaProgressNote').textContent = note;
    }

    function startPolling() {
        stopPolling();
        const tick = async () => {
            if (!state.batchId) return;
            try {
                const data = await api.request(`/whatsapp/bulk-send/${state.batchId}`);
                updatePollData(data);
            } catch (err) {
                console.error('[BulkWA] poll failed', err);
            }
        };
        // Fire immediately for snappy first paint then every 2s.
        tick();
        state.pollHandle = setInterval(tick, 2000);
    }

    function stopPolling() {
        if (state.pollHandle) {
            clearInterval(state.pollHandle);
            state.pollHandle = null;
        }
    }

    // ─── Wizard nav ──────────────────────────────────────────────

    function stepNext() {
        // If a batch is in flight, the "Next" button is the cancel.
        if (state.batchId) {
            const data = state.lastPoll;
            if (data && (data.status === 'completed' || data.status === 'cancelled' || data.status === 'failed')) {
                closeModal();
            } else {
                cancelBatch();
            }
            return;
        }
        if (state.step === 'recipients') {
            const ok = state.recipients.filter(r => classifyPhone(r.phone) === 'ok').length;
            if (ok === 0) {
                if (typeof Toast !== 'undefined') Toast.error('At least one recipient needs a valid phone');
                return;
            }
            setStep('template');
        } else if (state.step === 'template') {
            if (!state.template) {
                if (typeof Toast !== 'undefined') Toast.error('Pick a template to continue');
                return;
            }
            if (!state.businessPhone) {
                if (typeof Toast !== 'undefined') Toast.error('No WhatsApp number configured');
                return;
            }
            setStep('preview');
        } else if (state.step === 'preview') {
            setStep('send');
        } else if (state.step === 'send') {
            sendBatch();
        }
    }

    function stepBack() {
        const i = STEPS.indexOf(state.step);
        if (i > 0) setStep(STEPS[i - 1]);
    }

    async function sendBatch() {
        // Submit. Snake_case keys (CRM body binding rule).
        const live = state.recipients.filter(r => classifyPhone(r.phone) === 'ok').map(r => r.id);
        const payload = {
            lead_ids: live,
            business_phone_number: state.businessPhone,
            template_name: state.template.name,
            template_language: state.template.language || 'en',
            body_params: state.bodyMapping,
            header_params: state.headerMapping,
        };
        const nextBtn = document.getElementById('bulkWaNextBtn');
        nextBtn.disabled = true;
        nextBtn.textContent = 'Sending…';
        try {
            const resp = await api.request('/whatsapp/bulk-send', {
                method: 'POST',
                body: JSON.stringify(payload),
            });
            state.batchId = resp.batch_id;
            renderSendPane();
            startPolling();
            if (typeof Toast !== 'undefined') {
                const skip = resp.skipped_count || 0;
                Toast.success(skip > 0
                    ? `Batch started — ${resp.total_recipients} queued, ${skip} skipped`
                    : `Batch started — ${resp.total_recipients} queued`);
            }
        } catch (err) {
            console.error('[BulkWA] send failed', err);
            if (typeof Toast !== 'undefined') Toast.error(err.message || 'Failed to start batch');
            nextBtn.disabled = false;
            nextBtn.textContent = 'Send';
        }
    }

    async function cancelBatch() {
        if (!state.batchId) return;
        if (typeof Confirm !== 'undefined') {
            const ok = await Confirm.show({
                title: 'Cancel this batch?',
                message: 'Recipients who have already been sent can\'t be recalled. Continue?',
                confirmText: 'Cancel batch',
                cancelText: 'Keep sending',
                tone: 'danger',
            });
            if (!ok) return;
        }
        try {
            await api.request(`/whatsapp/bulk-send/${state.batchId}/cancel`, { method: 'POST' });
            if (typeof Toast !== 'undefined') Toast.info('Cancel requested');
        } catch (err) {
            console.error('[BulkWA] cancel failed', err);
            if (typeof Toast !== 'undefined') Toast.error(err.message || 'Cancel failed');
        }
    }

    // ─── Open / close ────────────────────────────────────────────

    async function openModal() {
        state.step = 'recipients';
        state.recipients = gatherSelectedLeads();
        state.template = null;
        state.headerMapping = [];
        state.bodyMapping = [];
        state.batchId = null;
        state.lastPoll = null;
        if (state.recipients.length === 0) {
            if (typeof Toast !== 'undefined') Toast.info('Select at least one lead first');
            return;
        }
        const modal = document.getElementById('bulkWhatsAppModal');
        if (!modal) return;
        modal.style.display = '';
        modal.classList.add('gm-animating');
        requestAnimationFrame(() => modal.classList.add('active'));
        // Pull WA context in parallel with rendering step 1.
        loadWaContext();
        setStep('recipients');
    }

    function closeModal() {
        stopPolling();
        const modal = document.getElementById('bulkWhatsAppModal');
        if (modal) {
            modal.classList.remove('active');
            setTimeout(() => {
                modal.classList.remove('gm-animating');
                modal.style.display = 'none';
            }, 200);
        }
        // Reset the Next button styling so re-opens are clean.
        const nextBtn = document.getElementById('bulkWaNextBtn');
        if (nextBtn) {
            nextBtn.disabled = false;
            nextBtn.textContent = 'Next';
            nextBtn.classList.remove('btn-outline-danger');
            nextBtn.classList.add('btn-primary');
        }
    }

    // ─── Public surface ──────────────────────────────────────────

    window.openBulkWhatsAppModal = openModal;
    window.closeBulkWhatsAppModal = closeModal;
    window.bulkWaStepNext = stepNext;
    window.bulkWaStepBack = stepBack;
    window.bulkWaRemoveRecipient = removeRecipient;
})();
