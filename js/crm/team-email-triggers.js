// ─────────────────────────────────────────────────────────────────────────
// CRM Settings → Teams → Email Triggers modal
//
// Phase 5 of UNIFIED_MAILBOX_PLAN.md. Replaces the legacy "campaigns"
// concept. Per-team mapping: when a lead enters a status, fire the
// configured templates. Source filter (Facebook / Google Sheets / etc.)
// lets the same team route different sources to different templates.
//
// Backend:
//   GET    /api/status-email-triggers/team/{teamId}
//   POST   /api/status-email-triggers   (admin only)
//   DELETE /api/status-email-triggers   (admin only)
// ─────────────────────────────────────────────────────────────────────────

(function () {
    // Lead statuses come from the CRM status machine. Order matters — the UI
    // shows them in pipeline order so the user reads top-to-bottom as the
    // lead's journey unfolds. Keep in sync with LeadStatuses on the server.
    //
    // That last sentence was here while the list carried an eighth entry the
    // server does not have. 'Lost' was retired when Won/Lost moved to deal
    // stages, and the leads CHECK constraint forbids it — so a template
    // attached to the Lost tile saved, listed as an active automation, and
    // could never fire, while the leads that actually die are written
    // 'unqualified'. A tenant's lost-lead nurture sent nothing and looked
    // healthy. Do not re-add a status here without one existing in
    // LeadStatuses.All.
    const STATUSES = [
        { code: 'new',         label: 'New',         hint: 'Just imported / created — no team assignment yet' },
        { code: 'assigned',    label: 'Assigned',    hint: 'Picked up by a team' },
        { code: 'contacted',   label: 'Contacted',   hint: 'Rep made first contact' },
        { code: 'qualified',   label: 'Qualified',   hint: 'Marked as a real prospect' },
        { code: 'unqualified', label: 'Unqualified', hint: 'Dead lead — no follow-up' },
        { code: 'converted',   label: 'Converted',   hint: 'Won — became a customer' },
    ];

    let _state = {
        teamId: null,
        teamName: '',
        sources: [],     // [{id, source_name, source_type}]
        triggers: [],    // raw rows from API
        templates: [],   // for the "add template" picker
        addContext: null, // { status, sourceId } when picker is open
    };

    // ─── Open / close ──────────────────────────────────────────────────────

    window.openTriggersModal = async function (teamId, teamName) {
        _state.teamId = teamId;
        _state.teamName = teamName || '';
        document.getElementById('triggersModalTitle').textContent =
            `Email triggers — ${teamName || ''}`.trim();

        // Load sources, templates, and current triggers in parallel.
        try {
            const [srcResp, tplResp, trigResp] = await Promise.all([
                api.request('/lead-sources').catch(() => ({ items: [] })),
                api.request('/email-templates').catch(() => ({ items: [] })),
                api.request(`/status-email-triggers/team/${teamId}`).catch(() => ({ triggers: [] })),
            ]);
            // /lead-sources returns a bare array; templates returns {items: []}.
            _state.sources   = Array.isArray(srcResp)
                ? srcResp
                : ((srcResp && (srcResp.items || srcResp.lead_sources)) || []);
            _state.templates = (tplResp && tplResp.items) || [];
            _state.triggers  = (trigResp && trigResp.triggers) || [];
        } catch (e) {
            Toast.error('Failed to load triggers: ' + (e.message || e));
            return;
        }

        renderSourceDropdown();
        // Default selection: "Any source"
        const sel = document.getElementById('triggersSource');
        if (sel) sel.value = '';
        refreshTriggersGrid();
        showModal('triggersModal');
    };

    window.closeTriggersModal = function () {
        hideModal('triggersModal');
    };

    // ─── Renderers ─────────────────────────────────────────────────────────

    function renderSourceDropdown() {
        const sel = document.getElementById('triggersSource');
        if (!sel) return;
        sel.innerHTML = '<option value="">Any source (catch-all)</option>';
        _state.sources.forEach(s => {
            const opt = document.createElement('option');
            opt.value = s.id;
            const typeLabel = s.source_type ? ` · ${s.source_type}` : '';
            opt.textContent = `${s.source_name || s.name || '(unnamed)'}${typeLabel}`;
            sel.appendChild(opt);
        });
    }

    window.refreshTriggersGrid = function () {
        const sel = document.getElementById('triggersSource');
        const srcId = sel ? (sel.value || null) : null;
        const grid = document.getElementById('triggersGrid');
        if (!grid) return;

        // Filter triggers visible for the current source. Catch-all rows
        // (lead_source_id IS NULL) appear when "Any source" is selected;
        // a source-specific selection ONLY shows that source's rows so it's
        // clear what's overriding the catch-all.
        const visible = _state.triggers.filter(t =>
            srcId ? t.lead_source_id === srcId : t.lead_source_id == null);

        const byStatus = {};
        visible.forEach(t => {
            (byStatus[t.status] ||= []).push(t);
        });
        Object.values(byStatus).forEach(arr =>
            arr.sort((a, b) => (a.fire_order ?? 0) - (b.fire_order ?? 0)));

        grid.innerHTML = STATUSES.map(s => {
            const rows = byStatus[s.code] || [];
            const rowsHtml = rows.length === 0
                ? `<span class="trig-empty">No templates configured.</span>`
                : rows.map(t => `
                    <div class="trig-pill">
                        <span class="trig-pill-name">${escapeHtml(t.template_name || '(deleted)')}</span>
                        <button class="trig-pill-x" type="button"
                                onclick="window.removeTrigger && removeTrigger('${escapeHtmlJsAttr(t.team_id)}', ${t.lead_source_id ? `'${escapeHtmlJsAttr(t.lead_source_id)}'` : 'null'}, '${escapeHtmlJsAttr(t.status)}', '${escapeHtmlJsAttr(t.template_id)}')"
                                title="Remove this trigger">×</button>
                    </div>`).join('');
            return `
                <div class="trig-row">
                    <div class="trig-row-head" title="${escapeHtml(s.hint)}">
                        <strong>${escapeHtml(s.label)}</strong>
                    </div>
                    <div class="trig-row-body">
                        ${rowsHtml}
                        <button type="button" class="trig-add-btn"
                                onclick="window.openTriggerPickTemplate && openTriggerPickTemplate('${escapeHtmlJsAttr(s.code)}')">
                            + Add template
                        </button>
                    </div>
                </div>`;
        }).join('');
    };

    // ─── Add-template picker ───────────────────────────────────────────────

    window.openTriggerPickTemplate = function (status) {
        const sel = document.getElementById('triggersSource');
        const sourceId = sel ? (sel.value || null) : null;
        _state.addContext = { status, sourceId };

        const list = document.getElementById('triggerPickTemplateList');
        const empty = document.getElementById('triggerPickTemplateEmpty');
        if (!list || !empty) return;

        // Filter out templates already attached to this (status, source) so the
        // user doesn't add duplicates (the backend would silently UPSERT but
        // it's friendlier to hide them here).
        const existingTplIds = new Set(_state.triggers
            .filter(t => t.status === status && (t.lead_source_id || null) === sourceId)
            .map(t => t.template_id));
        const candidates = _state.templates.filter(tp => !existingTplIds.has(tp.id));

        if (candidates.length === 0) {
            list.innerHTML = '';
            empty.style.display = '';
            empty.textContent = existingTplIds.size > 0
                ? 'Every template is already attached to this status / source.'
                : 'No templates yet. Create one under the Templates tab first.';
        } else {
            empty.style.display = 'none';
            list.innerHTML = candidates.map(tp => `
                <button type="button" class="trig-pick-row"
                        onclick="window.confirmTriggerPickTemplate && confirmTriggerPickTemplate('${escapeHtmlJsAttr(tp.id)}')">
                    <div class="trig-pick-name">${escapeHtml(tp.name)}</div>
                    <div class="trig-pick-sub">${escapeHtml(tp.subject || '(no subject)')}</div>
                </button>`).join('');
        }
        showModal('triggerPickTemplateModal');
    };

    window.closeTriggerPickTemplate = function () { hideModal('triggerPickTemplateModal'); };

    window.confirmTriggerPickTemplate = async function (templateId) {
        if (!_state.addContext) return;
        const { status, sourceId } = _state.addContext;
        // fire_order: append at end (after current max)
        const existing = _state.triggers.filter(t => t.status === status && (t.lead_source_id || null) === sourceId);
        const nextOrder = existing.length === 0
            ? 0
            : Math.max(...existing.map(t => t.fire_order ?? 0)) + 1;
        try {
            await api.request('/status-email-triggers', {
                method: 'POST',
                body: JSON.stringify({
                    team_id: _state.teamId,
                    lead_source_id: sourceId || null,
                    status: status,
                    template_id: templateId,
                    fire_order: nextOrder,
                }),
            });
            // Reload triggers
            const trigResp = await api.request(`/status-email-triggers/team/${_state.teamId}`);
            _state.triggers = (trigResp && trigResp.triggers) || [];
            hideModal('triggerPickTemplateModal');
            refreshTriggersGrid();
            Toast.success('Template attached.');
        } catch (e) {
            Toast.error('Failed to attach template: ' + (e.message || e));
        }
    };

    // ─── Remove ───────────────────────────────────────────────────────────

    window.removeTrigger = async function (teamId, sourceId, status, templateId) {
        if (!await Confirm.danger('Stop this email from firing on this transition?', 'Remove trigger')) return;
        try {
            const qs = new URLSearchParams({
                team_id: teamId,
                status: status,
                template_id: templateId,
            });
            if (sourceId) qs.set('lead_source_id', sourceId);
            await api.request(`/status-email-triggers?${qs}`, { method: 'DELETE' });
            const trigResp = await api.request(`/status-email-triggers/team/${_state.teamId}`);
            _state.triggers = (trigResp && trigResp.triggers) || [];
            refreshTriggersGrid();
            Toast.success('Trigger removed.');
        } catch (e) {
            Toast.error('Failed to remove: ' + (e.message || e));
        }
    };

    function escapeHtml(s) {
        if (s == null) return '';
        return String(s).replace(/[&<>"']/g, c => ({
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
    function escapeHtmlJsAttr(s) {
        return escapeHtml(String(s ?? '')
            .replace(/\\/g, '\\\\')
            .replace(/'/g, "\\'")
            .replace(/\r?\n/g, '\\n'));
    }

    // Each Settings sub-page defines its own showModal/hideModal locally
    // (private to the IIFE). Mirror the .gm-overlay.active toggle pattern
    // they use so this module doesn't depend on theirs.
    function showModal(id) {
        const el = document.getElementById(id);
        if (el) el.classList.add('active');
    }
    function hideModal(id) {
        const el = document.getElementById(id);
        if (el) el.classList.remove('active');
    }
})();
