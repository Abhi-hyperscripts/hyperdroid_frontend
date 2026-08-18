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
    // Create/edit/activate/pause are CRM_ADMIN-only (see endpoint list at top of
    // file). Viewing the list is open to any CRM user, so we don't guard the page —
    // we just hide the mutating affordances so a rep can't fill the whole builder
    // and lose it to a 403 on save.
    let _seqAdmin = false;

    // ── Page lifecycle ───────────────────────────────────────────────────────

    document.addEventListener('DOMContentLoaded', async () => {
        const roles = (typeof getUserRoles === 'function') ? getUserRoles() : [];
        _seqAdmin = roles.includes('CRM_ADMIN') || roles.includes('SUPERADMIN');
        if (!_seqAdmin) {
            document.querySelectorAll('[onclick="openSequenceBuilder()"]').forEach(b => { b.style.display = 'none'; });
        }
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
        const countEl = document.getElementById('sqxCount');
        if (countEl) {
            const active = _sequences.filter(s => s.is_active).length;
            countEl.textContent = _sequences.length
                ? `${_sequences.length} · ${active} active`
                : '0';
        }
        if (!_sequences.length) {
            empty.style.display = '';
            container.innerHTML = '';
            return;
        }
        empty.style.display = 'none';
        container.innerHTML = _sequences.map(renderRow).join('');
    }

    // Cadence-timeline card. The signature: steps drawn as a horizontal
    // mini-timeline (channel icon + delay marker per node) so the shape of
    // the cadence reads at a glance. Steps are optional on the list payload —
    // the timeline row is simply omitted when absent.
    const STEP_META = {
        email:             { label: 'Email',    svg: '<path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/>' },
        whatsapp_template: { label: 'WhatsApp', svg: '<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>' },
        call_task:         { label: 'Call',     svg: '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>' },
        followup:          { label: 'Follow-up', svg: '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/>' },
        status_flip:       { label: 'Status',   svg: '<polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>' },
        wait:              { label: 'Wait',     svg: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>' }
    };

    function stepDelayLabel(step, idx) {
        const d = parseInt(step.delay_days, 10) || 0;
        const h = parseInt(step.delay_hours, 10) || 0;
        if (idx === 0 && d === 0 && h === 0) return 'Day 0';
        if (d === 0 && h === 0) return 'same day';
        const parts = [];
        if (d) parts.push('+' + d + 'd');
        if (h) parts.push(h + 'h');
        return parts.join(' ');
    }

    function renderTimeline(steps) {
        const sorted = [...steps].sort((a, b) => (a.step_order || 0) - (b.step_order || 0));
        return `<div class="sqx-timeline">` + sorted.map((st, i) => {
            const meta = STEP_META[st.step_type] || { label: st.step_type, svg: STEP_META.wait.svg };
            return (i > 0 ? '<i class="sqx-link"></i>' : '') +
                `<div class="sqx-node t-${esc(st.step_type)}">` +
                `<span class="sicon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${meta.svg}</svg></span>` +
                `<span class="slabel">${esc(meta.label)}</span>` +
                `<span class="sdelay">${esc(stepDelayLabel(st, i))}</span>` +
                `</div>`;
        }).join('') + `</div>`;
    }

    function renderRow(seq) {
        const hasSteps = Array.isArray(seq.steps) && seq.steps.length > 0;
        const exitParts = parseExitChips(seq);
        return `
            <div class="sqx-card ${seq.is_active ? '' : 'paused'}" data-seq-id="${esc(seq.id)}">
                <div class="sqx-cardhead">
                    <h3 class="sqx-name">${esc(seq.name)}</h3>
                    ${seq.is_active
                        ? '<span class="sqx-pill on">Active</span>'
                        : '<span class="sqx-pill off">Paused</span>'}
                </div>
                ${seq.description ? `<p class="sqx-desc">${esc(seq.description)}</p>` : ''}
                ${hasSteps ? renderTimeline(seq.steps) : ''}
                ${exitParts.length
                    ? `<div class="sqx-exits">${exitParts.map(c => `<span class="sqx-exit">${c}</span>`).join('')}</div>`
                    : ''}
                <div class="sqx-foot">
                    <span class="sqx-steps-n">${hasSteps ? seq.steps.length + (seq.steps.length === 1 ? ' step' : ' steps') : ''}</span>
                    <div class="sqx-actions">
                        ${_seqAdmin ? `
                        <button class="btn" onclick="editSequence('${escJsAttr(seq.id)}')" title="Edit sequence">Edit</button>
                        ${seq.is_active
                            ? `<button class="btn warn" onclick="toggleActive('${escJsAttr(seq.id)}', false)" title="Pause — new enrolments blocked, in-flight ones pause">Pause</button>`
                            : `<button class="btn ok" onclick="toggleActive('${escJsAttr(seq.id)}', true)" title="Activate — sequence accepts new enrolments again">Activate</button>`
                        }` : ''}
                    </div>
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

    // Both open the full-page builder (sequence-builder.html) rather than a
    // modal. The builder's step-type picker is a SearchableDropdown whose popup
    // fought the dimmed gm-overlay's stacking context and rendered behind the
    // scrim; a page has nothing for it to sit behind.
    window.editSequence = function (sequenceId) {
        window.location = 'sequence-builder.html?id=' + encodeURIComponent(sequenceId);
    };

    window.openSequenceBuilder = function () {
        window.location = 'sequence-builder.html';
    };

    // ── Helpers ──────────────────────────────────────────────────────────────

    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        })[c]);
    }

    // A value going into a JS STRING inside an inline handler needs BOTH
    // escapings, and HTML-escaping alone cannot do it. The parser decodes
    // entities in an attribute BEFORE the JS is parsed, so &#39; becomes a
    // real quote again and `');alert(1);//` still breaks out — verified in a
    // browser, see tests/security/escaper-quote-safety.spec.js.
    //
    // JS-escape first, then HTML-escape: the backslash survives as \&#39;,
    // decodes to \' and reaches JS as an escaped quote. It also fixes an
    // ordinary bug — a lead called O'Brien currently breaks these handlers
    // outright with a syntax error.
    function escJsAttr(s) {
        return esc(String(s ?? '')
            .replace(/\\/g, '\\\\')
            .replace(/'/g, "\\'")
            .replace(/\r?\n/g, '\\n'));
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
