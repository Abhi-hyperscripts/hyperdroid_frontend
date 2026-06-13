/**
 * Sequences (cadences) — list page + builder modal.
 *
 * Backend contract (CRM, Phase 1):
 *   GET    /sequences[?active_only=false]
 *   POST   /sequences                    (CRM_ADMIN)
 *   PUT    /sequences/{id}               (CRM_ADMIN)
 *   POST   /sequences/{id}/activate      (CRM_ADMIN)
 *   POST   /sequences/{id}/deactivate    (CRM_ADMIN)
 *   POST   /sequences/enroll             (any CRM user)
 *   POST   /sequences/enroll-bulk        (any CRM user)
 *   POST   /sequences/enrollments/{id}/unenroll
 *   GET    /sequences/by-lead/{leadId}/active
 *
 * All requests carry tenant_id in the JWT. CRM uses JsonNamingPolicy.SnakeCaseLower
 * so bodies use snake_case keys (lead_id, step_type, delay_days, etc).
 */
(function () {
    'use strict';

    // ── Constants ────────────────────────────────────────────────────────────

    const STEP_TYPES = [
        { value: 'email',             label: 'Send email' },
        { value: 'whatsapp_template', label: 'Send WhatsApp template' },
        { value: 'call_task',         label: 'Create call task' },
        { value: 'followup',          label: 'Create follow-up reminder' },
        { value: 'status_flip',       label: 'Auto-change lead status' },
        { value: 'wait',              label: 'Wait (do nothing)' },
    ];

    const STATUS_OPTIONS = ['new', 'assigned', 'contacted', 'qualified', 'unqualified', 'converted'];

    // ── State ────────────────────────────────────────────────────────────────

    let _sequences = [];
    let _editingId = null;      // null = create mode, uuid = edit mode

    // ── Page lifecycle ───────────────────────────────────────────────────────

    document.addEventListener('DOMContentLoaded', async () => {
        try {
            await loadList();
        } catch (e) {
            console.error('[sequences] load failed', e);
            Toast.error(e?.message || 'Failed to load sequences');
        }
    });

    // ── List ─────────────────────────────────────────────────────────────────

    async function loadList() {
        const list = await api.request('/sequences');
        _sequences = Array.isArray(list) ? list : [];
        renderList();
    }

    function renderList() {
        const empty = document.getElementById('seqEmptyState');
        const container = document.getElementById('seqList');
        if (!_sequences.length) {
            empty.style.display = '';
            container.innerHTML = '';
            return;
        }
        empty.style.display = 'none';
        container.innerHTML = _sequences.map(renderRow).join('');
    }

    function renderRow(seq) {
        // The list endpoint doesn't nest steps (keeps the payload small).
        // We omit the step-count chip rather than show a stale '–'; the
        // user sees the real count when they click Edit.
        const hasSteps = Array.isArray(seq.steps) && seq.steps.length > 0;
        const stepCount = hasSteps ? seq.steps.length : null;
        const exitParts = parseExitChips(seq);
        return `
            <div class="seq-row ${seq.is_active ? '' : 'seq-row-paused'}" data-seq-id="${esc(seq.id)}">
                <div class="seq-row-main">
                    <div class="seq-row-title">
                        <h3>${esc(seq.name)}</h3>
                        ${seq.is_active
                            ? '<span class="seq-badge seq-badge-active">Active</span>'
                            : '<span class="seq-badge seq-badge-paused">Paused</span>'}
                    </div>
                    ${seq.description
                        ? `<p class="seq-row-desc">${esc(seq.description)}</p>`
                        : ''}
                    <div class="seq-row-meta">
                        ${stepCount != null
                            ? `<span class="seq-meta-chip"><strong>${stepCount}</strong> ${stepCount === 1 ? 'step' : 'steps'}</span>`
                            : ''}
                        ${exitParts.map(c => `<span class="seq-meta-chip">${c}</span>`).join('')}
                    </div>
                </div>
                <div class="seq-row-actions">
                    <button class="btn btn-sm btn-outline" onclick="editSequence('${seq.id}')" title="Edit sequence">Edit</button>
                    ${seq.is_active
                        ? `<button class="btn btn-sm btn-outline-warning" onclick="toggleActive('${seq.id}', false)" title="Pause — new enrolments blocked, in-flight ones pause">Pause</button>`
                        : `<button class="btn btn-sm btn-outline-success" onclick="toggleActive('${seq.id}', true)" title="Activate — sequence accepts new enrolments again">Activate</button>`
                    }
                </div>
            </div>
        `;
    }

    function parseExitChips(seq) {
        let cond = {};
        try { cond = JSON.parse(seq.exit_conditions_json || '{}'); } catch (_) {}
        const chips = [];
        if (cond.on_email_reply)      chips.push('Exits on email reply');
        if (cond.on_whatsapp_inbound) chips.push('Exits on WhatsApp reply');
        if (Array.isArray(cond.on_status_in) && cond.on_status_in.length) {
            chips.push(`Exits at ${cond.on_status_in.join('/')}`);
        }
        return chips;
    }

    // ── Action handlers (window-exposed for inline onclick) ──────────────────

    window.toggleActive = async function (sequenceId, makeActive) {
        try {
            const path = makeActive ? 'activate' : 'deactivate';
            await api.request(`/sequences/${sequenceId}/${path}`, { method: 'POST' });
            Toast.success(makeActive ? 'Sequence activated' : 'Sequence paused');
            await loadList();
        } catch (e) {
            Toast.error(e?.message || 'Failed to update sequence');
        }
    };

    window.editSequence = function (sequenceId) {
        _editingId = sequenceId;
        const seq = _sequences.find(s => s.id === sequenceId);
        if (!seq) {
            Toast.error('Sequence not found in current list — try refreshing');
            return;
        }
        openBuilderModal(seq);
    };

    window.openSequenceBuilder = function () {
        _editingId = null;
        openBuilderModal(null);
    };

    // ── Builder modal ────────────────────────────────────────────────────────

    function openBuilderModal(seqOrNull) {
        const isEdit = !!seqOrNull;
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
            // Start with a single email step as a sensible default for a new sequence.
            initialSteps.push({ step_order: 1, step_type: 'email', delay_days: 0, delay_hours: 0, config: {} });
        }

        const overlay = document.getElementById('seqBuilderOverlay');
        // gm-overlay needs display:flex AND .active for the opacity transition.
        // The HTML defaults to display:none so it doesn't trap layout when empty.
        overlay.style.display = 'flex';
        overlay.classList.add('active');
        overlay.innerHTML = `
            <div class="gm-modal seq-builder gm-lg">
                <div class="gm-header">
                    <div class="gm-header-left">
                        <div>
                            <h2>${isEdit ? 'Edit sequence' : 'New sequence'}</h2>
                        </div>
                    </div>
                    <button class="gm-close" onclick="closeBuilder()" aria-label="Close" title="Close">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                    </button>
                </div>
                <div class="gm-body seq-builder-body">
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
                        <button type="button" class="btn btn-outline btn-sm" id="seqAddStepBtn">
                            + Add step
                        </button>
                    </fieldset>
                </div>
                <div class="gm-footer">
                    <button class="btn btn-outline" onclick="closeBuilder()">Cancel</button>
                    <button class="btn btn-primary" id="seqSaveBtn">${isEdit ? 'Save changes' : 'Create sequence'}</button>
                </div>
            </div>
        `;

        // Render the steps editor
        const stepsContainer = overlay.querySelector('#seqSteps');
        const stepsState = [...initialSteps];

        function renderSteps() {
            stepsContainer.innerHTML = stepsState.map((s, idx) => renderStepEditor(s, idx, stepsState.length)).join('');
            // Wire dropdowns + remove buttons after render
            stepsContainer.querySelectorAll('.seq-step-type-trigger').forEach(t => {
                const idx = parseInt(t.getAttribute('data-step-idx'), 10);
                const value = stepsState[idx].step_type;
                const triggerHost = t.parentElement;
                // We attach a SearchableDropdown for the step type — keeps theme consistent.
                triggerHost.innerHTML = '';
                new SearchableDropdown(triggerHost, {
                    options: STEP_TYPES,
                    placeholder: 'Pick a step type…',
                    value,
                    onChange: (newValue) => {
                        stepsState[idx].step_type = newValue;
                        // Re-render to update the per-type config editor
                        renderSteps();
                    },
                });
            });
            stepsContainer.querySelectorAll('input[data-field]').forEach(input => {
                input.addEventListener('input', (e) => {
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
                input.addEventListener('input', (e) => {
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
                    // Re-number remaining steps so step_order stays 1..N
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

        // Add-step button — appends a new empty step
        overlay.querySelector('#seqAddStepBtn').addEventListener('click', () => {
            stepsState.push({
                step_order: stepsState.length + 1,
                step_type: 'email',
                delay_days: 1,
                delay_hours: 0,
                config: {},
            });
            renderSteps();
        });

        // Save handler
        overlay.querySelector('#seqSaveBtn').addEventListener('click', async () => {
            await submitBuilder(stepsState, isEdit, seqOrNull?.id);
        });

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
                    </div>
                `;
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
                `;
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
                    </div>
                `;
                break;
            case 'status_flip':
                typeSpecific = `
                    <div class="form-row">
                        <label>Move lead to status</label>
                        <div class="seq-dd-host"><div class="seq-status-target-trigger" data-step-idx="${idx}"></div></div>
                    </div>
                `;
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
            </div>
        `;
    }

    async function submitBuilder(stepsState, isEdit, sequenceId) {
        const name = (document.getElementById('seqNameInput').value || '').trim();
        const description = (document.getElementById('seqDescInput').value || '').trim();
        const exitOnEmail = document.getElementById('seqExitEmail').checked;
        const exitOnWa = document.getElementById('seqExitWa').checked;
        const statusChips = [...document.querySelectorAll('#seqStatusChips input:checked')].map(i => i.value);

        if (!name) { Toast.error('Sequence name is required'); return; }
        if (!stepsState.length) { Toast.error('Add at least one step'); return; }

        // Strip empty config keys so the backend payload stays tidy.
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

        try {
            if (isEdit) {
                await api.request(`/sequences/${sequenceId}`, {
                    method: 'PUT',
                    body: JSON.stringify(body),
                });
                Toast.success('Sequence saved');
            } else {
                await api.request('/sequences', {
                    method: 'POST',
                    body: JSON.stringify(body),
                });
                Toast.success('Sequence created');
            }
            closeBuilder();
            await loadList();
        } catch (e) {
            Toast.error(e?.message || 'Save failed');
        }
    }

    window.closeBuilder = function () {
        const o = document.getElementById('seqBuilderOverlay');
        o.classList.remove('active');
        o.style.display = 'none';
        o.innerHTML = '';
    };

    // ── Helpers ──────────────────────────────────────────────────────────────

    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        })[c]);
    }
    function safeParseJson(s) {
        if (!s) return {};
        try { return JSON.parse(s); } catch (_) { return {}; }
    }
    function pruneEmpty(o) {
        const out = {};
        for (const [k, v] of Object.entries(o)) {
            if (v === null || v === undefined || v === '') continue;
            out[k] = v;
        }
        return out;
    }
})();
