/**
 * Form-answers filter — shared across the leads list and the analytics
 * dashboard. Both pages embed identical modal markup (#formAnswersModal,
 * #formAnswersFilterBtn, etc); this module owns the state, the lazy
 * loading of question summaries + per-question values, and the
 * sidebar/values-pane rendering.
 *
 * Usage from a host page:
 *
 *   FormAnswersFilter.init({
 *     getSourceId: () => filterSourceDropdown.getValue(),  // or any other lookup
 *     onApply: () => { applyFilters(); }                   // host refresh callback
 *   });
 *
 *   // To check current button state when source changes:
 *   FormAnswersFilter.refreshButtonState();
 *   // To reset (typically when source changes — different forms = different questions):
 *   FormAnswersFilter.reset();
 *   // To read what's currently applied (host serialises it onto its API calls):
 *   const filter = FormAnswersFilter.getFilter();   // {key: [vals]}
 *   const count  = FormAnswersFilter.activeCount(); // total values selected
 */
(function (global) {
    'use strict';

    const FA_TOP_N = 12;

    // Host hooks — set by init().
    let _getSourceId = () => null;
    let _onApply = () => {};
    let _onSourceCheckedDisabled = (isDisabled) => {};

    // State.
    let _filter = {};
    let _applied = {};       // last-applied snapshot, restored on Cancel
    let _questions = [];     // [{key,label,leads_with_answer,no_answer_count}]
    let _valuesCache = {};   // {key: {values:[{value,count}], noAnswer:n, label}}
    let _activeKey = null;
    let _search = '';
    let _shownAll = {};

    function escapeHtml(s) {
        return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }
    function escapeAttr(s) { return escapeHtml(s); }

    // ── Public API ─────────────────────────────────────────────────

    function init(opts) {
        _getSourceId = opts?.getSourceId || (() => null);
        _onApply = opts?.onApply || (() => {});
        _onSourceCheckedDisabled = opts?.onButtonStateChange || (() => {});
        wireWindowHandlers();
        refreshButtonState();
    }

    function getFilter() {
        return JSON.parse(JSON.stringify(_filter));
    }

    function activeCount() {
        return Object.values(_filter).reduce((s, a) => s + (a?.length || 0), 0);
    }

    function reset() {
        _filter = {};
        _applied = {};
        _questions = [];
        _valuesCache = {};
        _activeKey = null;
        _search = '';
        _shownAll = {};
        refreshButtonState();
    }

    function refreshButtonState() {
        const btn = document.getElementById('formAnswersFilterBtn');
        if (!btn) return;
        const source = _getSourceId();
        // Pseudo-source values use a `__sentinel__` prefix to distinguish them
        // from real lead_source UUIDs: `__legacy:<type>` (legacy fallback when
        // /lead-sources is down) and `__manual__` / `__imported__` (the
        // no-source-id buckets). None of them have form questions to filter by.
        const isPseudo = source && typeof source === 'string' && source.startsWith('__');
        const enabled = !!source && !isPseudo;
        // Soft-disable: a hard `disabled` attribute suppresses ALL mouse
        // events, so the explanatory data-tooltip below could never show and
        // the button just read as dead. Keep it hoverable; the click guard
        // in openFormAnswersModal() enforces the gating.
        btn.disabled = false;
        btn.classList.toggle('is-disabled', !enabled);
        btn.setAttribute('aria-disabled', String(!enabled));
        // Use data-tooltip so the global tooltip.js renders the custom themed
        // bubble (matches the action buttons on the leads page). Native `title`
        // would short-circuit it via the browser's built-in tooltip and look
        // out of place.
        btn.dataset.tooltip = enabled
            ? 'Filter leads by their answers to this form'
            : (isPseudo
                ? 'Form answer filter is only available on tenant-named sources'
                : 'Pick a single source above to filter by form answers');
        // Belt-and-braces: clear any leftover `title` so the browser doesn't
        // race the custom tooltip.
        if (btn.hasAttribute('title')) btn.removeAttribute('title');

        const badge = document.getElementById('formAnswersActiveCount');
        const dot = document.getElementById('formAnswersActiveDot');
        const n = activeCount();
        if (badge) {
            badge.textContent = String(n);
            badge.style.display = n > 0 ? 'inline-flex' : 'none';
        }
        if (dot) dot.hidden = !(n > 0 && enabled);
        _onSourceCheckedDisabled(!enabled);
    }

    async function open() {
        const source = _getSourceId();
        // Block opening for any pseudo-source — manual/imported/legacy don't
        // have form questions, and the questions endpoint would 400 on a
        // non-Guid id (which sentinels like '__imported__' aren't).
        if (!source || (typeof source === 'string' && source.startsWith('__'))) return;

        const modal = document.getElementById('formAnswersModal');
        if (!modal) return;

        // Snapshot for Cancel/overlay-click revert
        _applied = JSON.parse(JSON.stringify(_filter || {}));

        const list = document.getElementById('formAnswersQuestionList');
        const pane = document.getElementById('formAnswersValuesPane');
        if (list) list.innerHTML = '<p class="fa-loading">Loading…</p>';
        if (pane) pane.innerHTML = '';
        const searchInput = document.getElementById('formAnswersSearch');
        if (searchInput) searchInput.value = _search || '';

        modal.classList.add('active');
        document.body.style.overflow = 'hidden';

        try {
            if (_questions.length === 0) {
                const summary = await api.request(`/crm/lead-sources/${source}/answer-options`);
                _questions = Array.isArray(summary) ? summary : [];
            }
            if (!_activeKey && _questions.length > 0) _activeKey = _questions[0].key;
            renderSidebar();
            renderPills();
            await renderValuesPane();
        } catch (e) {
            if (list) list.innerHTML = `<p class="fa-error">Failed to load questions: ${escapeHtml(e?.message || String(e))}</p>`;
        }
    }

    function close(revert = true) {
        const modal = document.getElementById('formAnswersModal');
        if (modal) modal.classList.remove('active');
        document.body.style.overflow = '';
        if (revert) {
            _filter = JSON.parse(JSON.stringify(_applied || {}));
            refreshButtonState();
        }
    }

    function apply() {
        _applied = JSON.parse(JSON.stringify(_filter || {}));
        close(/*revert=*/false);
        refreshButtonState();
        _onApply();
    }

    // ── Renderers ─────────────────────────────────────────────────

    function renderSidebar() {
        const list = document.getElementById('formAnswersQuestionList');
        if (!list) return;
        if (_questions.length === 0) {
            list.innerHTML = `<p class="fa-empty">This form has no custom questions configured. Add mappings under Settings → Lead Sources to make questions filterable.</p>`;
            return;
        }
        const q = (_search || '').trim().toLowerCase();
        const matches = _questions.filter(question => {
            if (!q) return true;
            const hay = (question.label + ' ' + question.key).toLowerCase();
            if (hay.includes(q)) return true;
            const cached = _valuesCache[question.key];
            if (cached) {
                for (const v of cached.values) if (v.value.toLowerCase().includes(q)) return true;
            }
            return false;
        });
        if (matches.length === 0) {
            list.innerHTML = `<p class="fa-empty">No questions match “${escapeHtml(_search)}”.</p>`;
            return;
        }
        list.innerHTML = matches.map(q => {
            const sel = (_filter[q.key] || []).length;
            const isActive = q.key === _activeKey;
            return `<button type="button" class="fa-q-item ${isActive ? 'is-active' : ''}"
                        role="tab" aria-selected="${isActive}"
                        onclick="window.faSetActive('${escapeAttr(q.key)}')">
                        <span class="fa-q-label">${escapeHtml(q.label || q.key)}</span>
                        ${sel > 0 ? `<span class="fa-q-badge">${sel}</span>` : ''}
                    </button>`;
        }).join('');
    }

    async function renderValuesPane() {
        const pane = document.getElementById('formAnswersValuesPane');
        if (!pane) return;
        if (!_activeKey) {
            pane.innerHTML = `<p class="fa-empty">Pick a question to see its answers.</p>`;
            return;
        }
        if (!_valuesCache[_activeKey]) {
            pane.innerHTML = '<p class="fa-loading">Loading answers…</p>';
            try {
                const source = _getSourceId();
                const url = `/crm/lead-sources/${source}/answer-options?key=${encodeURIComponent(_activeKey)}`;
                const data = await api.request(url);
                _valuesCache[_activeKey] = {
                    values: Array.isArray(data?.values) ? data.values : [],
                    noAnswer: data?.no_answer_count || 0,
                    label: data?.label || _activeKey
                };
            } catch (e) {
                pane.innerHTML = `<p class="fa-error">Failed to load answers: ${escapeHtml(e?.message || String(e))}</p>`;
                return;
            }
        }
        const cached = _valuesCache[_activeKey];
        const selected = new Set((_filter[_activeKey] || []).map(v => v.toLowerCase()));
        const showAll = !!_shownAll[_activeKey];
        const allValues = cached.values || [];
        const visible = showAll ? allValues : allValues.slice(0, FA_TOP_N);
        const remaining = allValues.length - visible.length;
        const valChips = visible.map(v => {
            const isOn = selected.has(v.value.toLowerCase());
            // Zero-count pill: the answer was on leads that were later
            // deleted/wiped — render it disabled so the user can see the
            // shape of the data without picking a chip that returns no rows.
            const isZero = (v.count || 0) === 0;
            const cls = ['form-answer-chip',
                         isOn ? 'is-on' : '',
                         isZero ? 'is-zero' : ''].filter(Boolean).join(' ');
            const onclick = isZero ? '' : `onclick="window.faToggleChip(this)"`;
            const disabledAttr = isZero ? 'disabled aria-disabled="true"' : '';
            const tooltip = isZero
                ? 'data-tooltip="No active leads have this answer (the matching leads were deleted)"'
                : '';
            return `<button type="button" class="${cls}"
                        data-key="${escapeAttr(_activeKey)}" data-value="${escapeAttr(v.value)}"
                        ${disabledAttr} ${tooltip} ${onclick}>
                        <span>${escapeHtml(v.value)}</span>
                        <span class="form-answer-count">${v.count}</span>
                    </button>`;
        }).join('');
        const noAnsOn = selected.has('__no_answer__');
        const noAnsChip = (cached.noAnswer || 0) > 0
            ? `<button type="button" class="form-answer-chip form-answer-noans ${noAnsOn ? 'is-on' : ''}"
                    data-key="${escapeAttr(_activeKey)}" data-value="__no_answer__"
                    onclick="window.faToggleChip(this)">
                    <span>(no answer)</span>
                    <span class="form-answer-count">${cached.noAnswer}</span>
                </button>`
            : '';
        const moreBtn = remaining > 0
            ? `<button type="button" class="fa-show-more" onclick="window.faShowAll('${escapeAttr(_activeKey)}')">+${remaining} more</button>`
            : '';
        // Empty-state: zero distinct answer values AND zero no-answer rows
        // — only happens for a brand-new question that has no leads at all.
        // The "all matching leads were deleted" case now shows zero-count
        // disabled pills (see is-zero handling above), so it's no longer
        // an empty pane.
        const isEmpty = allValues.length === 0 && (cached.noAnswer || 0) === 0;
        pane.innerHTML = `
            <div class="fa-q-title">${escapeHtml(cached.label)}</div>
            ${isEmpty
                ? `<p class="fa-empty">No leads have this question yet — once the form starts collecting answers they'll appear here.</p>`
                : `<div class="form-answer-chips">${valChips}${noAnsChip}${moreBtn}</div>`}
        `;
    }

    function renderPills() {
        const wrap = document.getElementById('formAnswersPills');
        if (!wrap) return;
        const pills = [];
        for (const [key, vals] of Object.entries(_filter)) {
            const label = (_questions.find(q => q.key === key)?.label) || key;
            for (const v of vals) {
                const display = v === '__no_answer__' ? '(no answer)' : v;
                pills.push(`<span class="fa-pill" title="${escapeAttr(label)}">
                    <span class="fa-pill-q">${escapeHtml(label)}:</span>
                    <span class="fa-pill-v">${escapeHtml(display)}</span>
                    <button type="button" class="fa-pill-x" aria-label="Remove"
                        onclick="window.faRemovePill('${escapeAttr(key)}','${escapeAttr(v)}')">×</button>
                </span>`);
            }
        }
        wrap.innerHTML = pills.length === 0
            ? '<span class="fa-pills-empty">No filters yet — pick answers below.</span>'
            : pills.join('');
        const total = activeCount();
        const apply = document.getElementById('formAnswersApplyCount');
        if (apply) {
            apply.hidden = total === 0;
            apply.textContent = total > 0 ? `(${total})` : '';
        }
    }

    // ── Mutators (wired to window.faXxx for inline onclick) ───────

    function toggleChip(el) {
        const key = el.getAttribute('data-key');
        const value = el.getAttribute('data-value');
        if (!key || !value) return;
        const list = _filter[key] || [];
        const idx = list.findIndex(v => v.toLowerCase() === value.toLowerCase());
        if (idx >= 0) list.splice(idx, 1);
        else list.push(value);
        if (list.length === 0) delete _filter[key];
        else _filter[key] = list;
        el.classList.toggle('is-on');
        renderSidebar();
        renderPills();
    }

    function removePill(key, value) {
        const list = _filter[key];
        if (!list) return;
        const idx = list.findIndex(v => v.toLowerCase() === value.toLowerCase());
        if (idx >= 0) list.splice(idx, 1);
        if (list.length === 0) delete _filter[key];
        renderSidebar();
        renderPills();
        if (_activeKey) renderValuesPane();
    }

    function clearAll() {
        _filter = {};
        renderSidebar();
        renderPills();
        if (_activeKey) renderValuesPane();
    }

    async function setActive(key) {
        _activeKey = key;
        renderSidebar();
        renderPills();
        await renderValuesPane();
    }

    function showAll(key) {
        _shownAll[key] = true;
        renderValuesPane();
    }

    function onSearch() {
        const el = document.getElementById('formAnswersSearch');
        _search = el ? el.value : '';
        renderSidebar();
    }

    function wireWindowHandlers() {
        // The modal markup uses inline onclick="window.faXxx(…)" so the
        // host page doesn't need to know any internals.
        global.faOpen          = open;
        global.faClose         = () => close(/*revert=*/true);
        global.faApply         = apply;
        global.faClearAll      = clearAll;
        global.faToggleChip    = toggleChip;
        global.faRemovePill    = removePill;
        global.faSetActive     = setActive;
        global.faShowAll       = showAll;
        global.faOnSearch      = onSearch;

        // Backwards-compat aliases for the existing leads.html markup
        // (which already uses these names). New pages should use the
        // global.fa* names above.
        global.openFormAnswersModal       = open;
        global.closeFormAnswersModal      = () => close(/*revert=*/true);
        global.applyFormAnswers           = apply;
        global.clearFormAnswersSelection  = clearAll;
        global.toggleFormAnswerChip       = toggleChip;
        global.removeFormAnswerPill       = removePill;
        global.setFormAnswerActiveQuestion = setActive;
        global.showAllAnswerValues        = showAll;
        global.onFormAnswerSearch         = onSearch;
    }

    // Used by the leads-page localStorage restore path on reload. The host
    // page should already have restored the matching Source dropdown (this
    // filter is source-scoped — different sources have different questions)
    // before calling this; we don't re-validate against question metadata
    // here because the questions are loaded lazily on modal open. The badge
    // count + applied snapshot are kept in sync so the next modal open
    // doesn't show stale state. Returns true if anything actually changed.
    function setFilter(filter) {
        if (!filter || typeof filter !== 'object') filter = {};
        // Normalise: drop keys with empty value arrays so JSON-compare works.
        const wanted = {};
        for (const [k, v] of Object.entries(filter)) {
            if (Array.isArray(v) && v.length > 0) wanted[k] = [...v];
        }
        if (JSON.stringify(wanted) === JSON.stringify(_filter)) return false;
        _filter = wanted;
        _applied = JSON.parse(JSON.stringify(wanted));
        refreshButtonState();
        return true;
    }

    global.FormAnswersFilter = {
        init,
        getFilter,
        setFilter,
        activeCount,
        reset,
        refreshButtonState,
        open, close, apply, clearAll
    };

})(window);
