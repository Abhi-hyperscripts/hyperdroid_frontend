/**
 * Sequence builder — FULL PAGE (create + edit).
 *
 * Replaces the old in-modal builder. The step-type picker is a SearchableDropdown;
 * inside a dimmed gm-overlay modal its popup fought the overlay's stacking context
 * and rendered behind the scrim. On a normal page it opens in ordinary flow with
 * nothing to sit behind — same reason the Accounts invoice/bill editors are pages,
 * not modals.
 *
 * Navigation:
 *   sequence-builder.html            → create
 *   sequence-builder.html?id=<uuid>  → edit
 *   Save / Cancel                    → back to sequences.html
 *
 * Backend contract (CRM): POST /sequences, PUT /sequences/{id}. Bodies are
 * snake_case (CRM uses JsonNamingPolicy.SnakeCaseLower).
 */
(function () {
    'use strict';

    const STEP_TYPES = [
        { value: 'email',             label: 'Send email' },
        { value: 'whatsapp_template', label: 'Send WhatsApp template' },
        { value: 'call_task',         label: 'Create call task' },
        { value: 'followup',          label: 'Create follow-up reminder' },
        { value: 'status_flip',       label: 'Auto-change lead status' },
        { value: 'wait',              label: 'Wait (do nothing)' },
    ];

    const STATUS_OPTIONS = ['new', 'assigned', 'contacted', 'qualified', 'unqualified', 'converted'];

    let _editingId = null;   // null = create, uuid = edit

    document.addEventListener('DOMContentLoaded', async () => {
        const params = new URLSearchParams(window.location.search);
        const id = params.get('id');

        try {
            let seq = null;
            if (id) {
                // No GET /sequences/{id} on the backend — pull the list and pick
                // it out. Works on a direct URL load and on refresh.
                const list = await api.request('/sequences');
                seq = (Array.isArray(list) ? list : []).find(s => s.id === id) || null;
                if (!seq) {
                    Toast.error('Sequence not found — it may have been deleted');
                    setTimeout(() => { window.location = 'sequences.html'; }, 1200);
                    return;
                }
                _editingId = id;
            }
            renderBuilder(seq);
        } catch (e) {
            console.error('[sequence-builder] load failed', e);
            Toast.error(e?.message || 'Failed to load the sequence');
        }
    });

    function renderBuilder(seqOrNull) {
        const isEdit = !!seqOrNull;

        // Chrome: title + save button label
        const titleEl = document.getElementById('seqbTitle');
        if (titleEl) titleEl.textContent = isEdit ? 'Edit sequence' : 'New sequence';
        const saveBtn = document.getElementById('seqbSaveBtn');
        if (saveBtn) saveBtn.textContent = isEdit ? 'Save changes' : 'Create sequence';

        let cond = {};
        try { cond = JSON.parse(seqOrNull?.exit_conditions_json || '{}'); } catch (_) {}

        const initialSteps = (seqOrNull?.steps || []).map((s, i) => ({
            step_order: s.step_order || (i + 1),
            step_type: s.step_type,
            delay_days: s.delay_days || 0,
            delay_hours: s.delay_hours || 0,
            config: safeParseJson(s.config_json),
        }));
        if (!initialSteps.length) {
            initialSteps.push({ step_order: 1, step_type: 'email', delay_days: 0, delay_hours: 0, config: {} });
        }

        const root = document.getElementById('seqBuilderRoot');
        root.innerHTML = `
            <div class="form-row">
                <label for="seqNameInput">Name <span class="req">*</span></label>
                <input id="seqNameInput" class="form-control" type="text"
                       placeholder="e.g. SaaS Founder Outbound"
                       value="${esc(seqOrNull?.name || '')}" />
            </div>
            <div class="form-row">
                <label for="seqDescInput">Description</label>
                <textarea id="seqDescInput" class="form-control" rows="2"
                          placeholder="What this cadence is for. Helps reps pick the right one.">${esc(seqOrNull?.description || '')}</textarea>
            </div>

            <fieldset class="seq-fieldset">
                <legend>Exit conditions <small>— when should a lead drop out automatically?</small></legend>
                <label class="seq-check">
                    <input type="checkbox" id="seqExitEmail" ${cond.on_email_reply !== false ? 'checked' : ''} />
                    <span>If they <strong>reply to a sequence email</strong></span>
                </label>
                <label class="seq-check">
                    <input type="checkbox" id="seqExitWa" ${cond.on_whatsapp_inbound !== false ? 'checked' : ''} />
                    <span>If they <strong>send us a WhatsApp message</strong></span>
                </label>
                <div class="seq-status-exits">
                    <label>If their status becomes any of:</label>
                    <div class="seq-status-chips" id="seqStatusChips">
                        ${STATUS_OPTIONS.map(s => `
                            <label class="seq-status-chip">
                                <input type="checkbox" value="${s}" ${(cond.on_status_in || ['contacted','qualified','converted','unqualified']).includes(s) ? 'checked' : ''} />
                                <span>${s}</span>
                            </label>
                        `).join('')}
                    </div>
                </div>
            </fieldset>

            <fieldset class="seq-fieldset">
                <legend>Steps <small>— ordered, each delay measured from the previous step</small></legend>
                <div id="seqSteps" class="seq-steps"></div>
                <button type="button" class="btn btn-outline btn-sm" id="seqAddStepBtn">+ Add step</button>
            </fieldset>
        `;

        const stepsContainer = root.querySelector('#seqSteps');
        const stepsState = [...initialSteps];

        function renderSteps() {
            stepsContainer.innerHTML = stepsState.map((s, idx) => renderStepEditor(s, idx, stepsState.length)).join('');

            stepsContainer.querySelectorAll('.seq-step-type-trigger').forEach(t => {
                const idx = parseInt(t.getAttribute('data-step-idx'), 10);
                const value = stepsState[idx].step_type;
                const host = t.parentElement;
                host.innerHTML = '';
                new SearchableDropdown(host, {
                    options: STEP_TYPES,
                    placeholder: 'Pick a step type…',
                    value,
                    onChange: (newValue) => { stepsState[idx].step_type = newValue; renderSteps(); },
                });
            });
            stepsContainer.querySelectorAll('input[data-field]').forEach(input => {
                input.addEventListener('input', () => {
                    const idx = parseInt(input.getAttribute('data-step-idx'), 10);
                    const field = input.getAttribute('data-field');
                    if (field === 'delay_days' || field === 'delay_hours') {
                        stepsState[idx][field] = Math.max(0, parseInt(input.value || '0', 10));
                    } else if (field.startsWith('config.')) {
                        const key = field.slice(7);
                        stepsState[idx].config = stepsState[idx].config || {};
                        stepsState[idx].config[key] = input.value;
                    }
                });
            });
            stepsContainer.querySelectorAll('textarea[data-field]').forEach(input => {
                input.addEventListener('input', () => {
                    const idx = parseInt(input.getAttribute('data-step-idx'), 10);
                    const field = input.getAttribute('data-field');
                    if (field.startsWith('config.')) {
                        const key = field.slice(7);
                        stepsState[idx].config = stepsState[idx].config || {};
                        stepsState[idx].config[key] = input.value;
                    }
                });
            });
            stepsContainer.querySelectorAll('.seq-step-remove').forEach(btn => {
                btn.addEventListener('click', () => {
                    const idx = parseInt(btn.getAttribute('data-step-idx'), 10);
                    stepsState.splice(idx, 1);
                    stepsState.forEach((s, i) => { s.step_order = i + 1; });
                    renderSteps();
                });
            });
            stepsContainer.querySelectorAll('.seq-status-target-trigger').forEach(t => {
                const idx = parseInt(t.getAttribute('data-step-idx'), 10);
                const value = stepsState[idx].config?.status_target || '';
                const host = t.parentElement;
                host.innerHTML = '';
                new SearchableDropdown(host, {
                    options: STATUS_OPTIONS.map(s => ({ value: s, label: s })),
                    placeholder: 'Pick target status…',
                    value,
                    onChange: (newValue) => {
                        stepsState[idx].config = stepsState[idx].config || {};
                        stepsState[idx].config.status_target = newValue;
                    },
                });
            });
        }

        root.querySelector('#seqAddStepBtn').addEventListener('click', () => {
            stepsState.push({ step_order: stepsState.length + 1, step_type: 'email', delay_days: 1, delay_hours: 0, config: {} });
            renderSteps();
        });

        saveBtn.addEventListener('click', () => submit(stepsState, isEdit, seqOrNull?.id));

        renderSteps();
    }

    function renderStepEditor(step, idx, totalSteps) {
        const cfg = step.config || {};
        let typeSpecific = '';
        switch (step.step_type) {
            case 'email':
                typeSpecific = `
                    <div class="form-row">
                        <label>Email subject</label>
                        <input class="form-control" type="text"
                               data-step-idx="${idx}" data-field="config.subject"
                               placeholder="Hey {{first_name}}, quick question"
                               value="${esc(cfg.subject || '')}" />
                    </div>
                    <div class="form-row">
                        <label>Email body</label>
                        <textarea class="form-control" rows="4"
                                  data-step-idx="${idx}" data-field="config.body_text"
                                  placeholder="Use {{first_name}}, {{company}}, {{job_title}} as merge fields.">${esc(cfg.body_text || '')}</textarea>
                    </div>`;
                break;
            case 'whatsapp_template':
                typeSpecific = `
                    <div class="form-row">
                        <label>Template name <small>(must be pre-approved on Interakt)</small></label>
                        <input class="form-control" type="text"
                               data-step-idx="${idx}" data-field="config.template_name"
                               placeholder="e.g. cold_intro_v1"
                               value="${esc(cfg.template_name || '')}" />
                    </div>
                    <div class="form-row">
                        <label>Template language</label>
                        <input class="form-control" type="text"
                               data-step-idx="${idx}" data-field="config.template_language"
                               placeholder="en, en_US, hi, etc."
                               value="${esc(cfg.template_language || 'en')}" />
                    </div>
                    <div class="form-row">
                        <label>Send from number
                            <small>(leave blank if you have one WhatsApp number)</small></label>
                        <input class="form-control" type="text"
                               data-step-idx="${idx}" data-field="config.business_phone_number"
                               placeholder="e.g. 918586084450 — digits with country code"
                               value="${esc(cfg.business_phone_number || '')}" />
                        <small class="form-hint">Required when your workspace has more than one
                            WhatsApp business number, otherwise this step cannot pick a sender
                            and will fail.</small>
                    </div>`;
                break;
            case 'call_task':
            case 'followup':
                typeSpecific = `
                    <div class="form-row">
                        <label>Task title</label>
                        <input class="form-control" type="text"
                               data-step-idx="${idx}" data-field="config.title"
                               placeholder="Call to follow up"
                               value="${esc(cfg.title || '')}" />
                    </div>
                    <div class="form-row">
                        <label>Notes <small>(rep sees this on their My Day)</small></label>
                        <textarea class="form-control" rows="2"
                                  data-step-idx="${idx}" data-field="config.notes"
                                  placeholder="Reference Day 0 email; ask about hiring stack">${esc(cfg.notes || '')}</textarea>
                    </div>`;
                break;
            case 'status_flip':
                typeSpecific = `
                    <div class="form-row">
                        <label>Move lead to status</label>
                        <div class="seq-dd-host"><div class="seq-status-target-trigger" data-step-idx="${idx}"></div></div>
                    </div>`;
                break;
            case 'wait':
                typeSpecific = `<p class="seq-step-hint">A wait step does nothing — it just adds time before the next step.</p>`;
                break;
        }

        return `
            <div class="seq-step" data-step-idx="${idx}">
                <div class="seq-step-header">
                    <span class="seq-step-num">Step ${idx + 1}</span>
                    <div class="seq-dd-host">
                        <div class="seq-step-type-trigger" data-step-idx="${idx}"></div>
                    </div>
                    ${totalSteps > 1 ? `<button class="seq-step-remove" type="button" data-step-idx="${idx}" title="Remove this step" aria-label="Remove step">&times;</button>` : ''}
                </div>
                <div class="seq-step-body">
                    <div class="seq-step-delay">
                        <label>Delay from previous step:</label>
                        <input type="number" min="0" step="1" value="${step.delay_days || 0}"
                               data-step-idx="${idx}" data-field="delay_days" /> days
                        <input type="number" min="0" step="1" value="${step.delay_hours || 0}"
                               data-step-idx="${idx}" data-field="delay_hours" /> hours
                    </div>
                    ${typeSpecific}
                </div>
            </div>`;
    }

    async function submit(stepsState, isEdit, sequenceId) {
        const name = (document.getElementById('seqNameInput').value || '').trim();
        const description = (document.getElementById('seqDescInput').value || '').trim();
        const exitOnEmail = document.getElementById('seqExitEmail').checked;
        const exitOnWa = document.getElementById('seqExitWa').checked;
        const statusChips = [...document.querySelectorAll('#seqStatusChips input:checked')].map(i => i.value);

        if (!name) { Toast.error('Sequence name is required'); return; }
        if (!stepsState.length) { Toast.error('Add at least one step'); return; }

        const cleanSteps = stepsState.map(s => ({
            step_order: s.step_order,
            step_type: s.step_type,
            delay_days: s.delay_days || 0,
            delay_hours: s.delay_hours || 0,
            config: pruneEmpty(s.config || {}),
        }));

        const body = {
            name,
            description: description || null,
            exit_on_email_reply: exitOnEmail,
            exit_on_whatsapp_inbound: exitOnWa,
            exit_on_status_in: statusChips,
            steps: cleanSteps,
        };

        const saveBtn = document.getElementById('seqbSaveBtn');
        const original = saveBtn.textContent;
        saveBtn.disabled = true;
        saveBtn.textContent = 'Saving…';
        try {
            if (isEdit) {
                await api.request(`/sequences/${sequenceId}`, { method: 'PUT', body: JSON.stringify(body) });
                Toast.success('Sequence saved');
            } else {
                await api.request('/sequences', { method: 'POST', body: JSON.stringify(body) });
                Toast.success('Sequence created');
            }
            window.location = 'sequences.html';
        } catch (e) {
            Toast.error(e?.message || 'Save failed');
            saveBtn.disabled = false;
            saveBtn.textContent = original;
        }
    }

    // ── Helpers ──────────────────────────────────────────────────────────────
    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        })[c]);
    }
    function safeParseJson(s) { if (!s) return {}; try { return JSON.parse(s); } catch (_) { return {}; } }
    function pruneEmpty(o) {
        const out = {};
        for (const [k, v] of Object.entries(o)) {
            if (v === null || v === undefined || v === '') continue;
            out[k] = v;
        }
        return out;
    }
})();
