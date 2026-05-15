/**
 * recruit-hud.js — Interview-only floating cockpit for the recruit copilot.
 *
 * Activates ONLY when meeting_mode === 'interview' (or 'recruit'). Sales-mode
 * meetings load this script but it does nothing — initRecruitHud() returns
 * immediately. Sections rendered, each independently visible:
 *
 *   1. Candidate context bar     — InterviewContextLoaded
 *   2. Ask Next stack            — InterviewQuestionsUpdated (max 3 persistent
 *                                  cards, Use/Skip; replaces fire-and-fade)
 *   3. Answer-quality chip       — AnswerQuality (green/amber/red + reason)
 *   4. Jargon tray (collapsible) — JargonDetected (plain-English explainers)
 *   5. Live scorecard (collapsible) — ScorecardUpdate (competency rubric with
 *                                  AI-marked signal + interviewer override)
 *
 * DOM is INJECTED into #copilotHud (between control panel and insight feed)
 * so the existing copilot HUD stays untouched for sales meetings.
 *
 * All CSS uses theme variables — see css/recruit-hud.css.
 */
(function () {
    'use strict';

    let signalR = null;
    let meetingId = null;
    let isInterviewMode = false;
    let initialized = false;

    // Per-session state. Cleared on initRecruitHud (no cross-meeting leak).
    let askNextQueue = [];
    let jargonHistory = [];        // most-recent first, cap 20
    const scorecardState = new Map();   // competency -> { signal, evidenceQuote, overridden }
    let reportDraft = null;         // AI-drafted InterviewReport from session-end (Phase 4)
    let reportInterviewId = null;   // from Phase 1 InterviewContextLoaded
    let reportSubmitted = false;    // recruiter has Submit'd in the modal

    function initRecruitHud(connection, meetingMode, meetingIdParam) {
        const mode = (meetingMode || '').toLowerCase();
        isInterviewMode = mode === 'interview' || mode === 'recruit';
        if (!isInterviewMode) return;
        if (initialized) return;

        signalR = connection;
        meetingId = meetingIdParam;

        injectDom();
        wireSignalR();
        initialized = true;
        console.log('[RecruitHUD] initialized for meeting', meetingId, 'mode=', mode);
    }

    function injectDom() {
        // Inject as a child of #copilotHud (the absolute overlay layer that
        // already sits on top of the video tile). The wrapper is itself
        // absolute-positioned via CSS so it FLOATS in the top-left below the
        // existing COPILOT control panel — never pushes the video container,
        // never breaks the meeting layout. pointer-events:auto on the
        // wrapper so the panels remain interactive even though the parent
        // overlay is pointer-events:none.
        const hud = document.getElementById('copilotHud');
        if (!hud) {
            console.warn('[RecruitHUD] #copilotHud missing — cannot inject');
            return;
        }

        const wrapper = document.createElement('div');
        wrapper.className = 'recruit-hud-sections recruit-hud-floating';
        wrapper.id = 'recruitHudSections';
        wrapper.innerHTML = ''
            + '<div class="recruit-hud-floating-header" id="recruitHudHeader" title="Drag to move">'
            +   '<span class="recruit-hud-floating-grip" aria-hidden="true">⋮⋮</span>'
            +   '<span class="recruit-hud-floating-title">RECRUIT COCKPIT</span>'
            +   '<button type="button" class="recruit-hud-floating-toggle" id="recruitFloatingToggle" onclick="toggleRecruitFloating()" title="Minimize cockpit">'
            +     '<span class="recruit-hud-floating-chevron" id="recruitFloatingChevron">−</span>'
            +   '</button>'
            + '</div>'
            + '<div class="recruit-hud-floating-body" id="recruitHudFloatingBody">'
            +   sectionsHtml()
            + '</div>'
            + '<div class="recruit-hud-floating-resize-handle" id="recruitHudResizeHandle" title="Drag to resize" aria-hidden="true"></div>';
        hud.appendChild(wrapper);

        setupDragAndResize(wrapper);
        restorePosition(wrapper);
    }

    // ── Draggable + resizable cockpit ────────────────────────────────────
    const POS_STORAGE_KEY = 'recruitHud.position.v1';

    function loadSavedPosition() {
        try {
            const raw = localStorage.getItem(POS_STORAGE_KEY);
            if (!raw) return null;
            const p = JSON.parse(raw);
            // Clamp to current viewport so old positions on smaller screens
            // don't push the panel off-screen.
            const maxLeft = window.innerWidth - 80;
            const maxTop = window.innerHeight - 40;
            return {
                left: Math.max(0, Math.min(maxLeft, p.left | 0)),
                top:  Math.max(0, Math.min(maxTop,  p.top  | 0)),
                width:  Math.max(240, Math.min(window.innerWidth - 16,  p.width  | 0)),
                height: Math.max(180, Math.min(window.innerHeight - 16, p.height | 0))
            };
        } catch (_e) { return null; }
    }

    function savePosition(pos) {
        try { localStorage.setItem(POS_STORAGE_KEY, JSON.stringify(pos)); } catch (_e) {}
    }

    function restorePosition(panel) {
        const saved = loadSavedPosition();
        if (!saved) return;
        applyUserPosition(panel, saved);
    }

    function applyUserPosition(panel, pos) {
        panel.classList.add('recruit-hud-floating-user-positioned');
        // Switch to fixed positioning so coords are viewport-relative —
        // simpler drag math, and decouples from the parent #copilotHud
        // overlay which may move when chat sidebar opens/closes.
        panel.style.position = 'fixed';
        panel.style.top = pos.top + 'px';
        panel.style.left = pos.left + 'px';
        panel.style.width = pos.width + 'px';
        panel.style.height = pos.height + 'px';
        panel.style.bottom = 'auto';
        panel.style.right = 'auto';
    }

    function setupDragAndResize(panel) {
        const header = panel.querySelector('#recruitHudHeader');
        const resize = panel.querySelector('#recruitHudResizeHandle');
        if (!header || !resize) return;

        // ── Header drag ────────────────────────────────────────────────
        header.addEventListener('mousedown', (e) => {
            // Don't start drag when clicking the minimize button.
            if (e.target.closest('.recruit-hud-floating-toggle')) return;
            if (e.button !== 0) return;
            e.preventDefault();

            const r = panel.getBoundingClientRect();
            // Anchor the panel where it currently sits so subsequent
            // pointer math is straightforward.
            panel.classList.add('recruit-hud-floating-user-positioned', 'recruit-hud-floating-dragging');
            panel.style.position = 'fixed';
            panel.style.left = r.left + 'px';
            panel.style.top = r.top + 'px';
            panel.style.width = r.width + 'px';
            panel.style.height = r.height + 'px';
            panel.style.bottom = 'auto';
            panel.style.right = 'auto';

            const startX = e.clientX, startY = e.clientY;
            const startLeft = r.left, startTop = r.top;

            const onMove = (ev) => {
                const dx = ev.clientX - startX;
                const dy = ev.clientY - startY;
                const maxLeft = window.innerWidth - panel.offsetWidth;
                // Keep header visible: never let panel.top push past viewport bottom - header height.
                const maxTop = window.innerHeight - 32;
                const newLeft = Math.max(0, Math.min(maxLeft, startLeft + dx));
                const newTop  = Math.max(0, Math.min(maxTop,  startTop + dy));
                panel.style.left = newLeft + 'px';
                panel.style.top = newTop + 'px';
            };
            const onUp = () => {
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
                panel.classList.remove('recruit-hud-floating-dragging');
                savePosition({
                    left: parseInt(panel.style.left, 10) || 0,
                    top:  parseInt(panel.style.top,  10) || 0,
                    width:  panel.offsetWidth,
                    height: panel.offsetHeight
                });
            };
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        });

        // ── Bottom-right corner resize ─────────────────────────────────
        resize.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return;
            e.preventDefault();
            e.stopPropagation();

            // Anchor before resize starts.
            const r = panel.getBoundingClientRect();
            panel.classList.add('recruit-hud-floating-user-positioned', 'recruit-hud-floating-resizing');
            panel.style.position = 'fixed';
            panel.style.left = r.left + 'px';
            panel.style.top = r.top + 'px';
            panel.style.width = r.width + 'px';
            panel.style.height = r.height + 'px';
            panel.style.bottom = 'auto';
            panel.style.right = 'auto';

            const startX = e.clientX, startY = e.clientY;
            const startW = r.width, startH = r.height;
            const left = r.left, top = r.top;

            const onMove = (ev) => {
                const dw = ev.clientX - startX;
                const dh = ev.clientY - startY;
                const maxW = Math.min(720, window.innerWidth - left - 8);
                const maxH = window.innerHeight - top - 8;
                const newW = Math.max(240, Math.min(maxW, startW + dw));
                const newH = Math.max(180, Math.min(maxH, startH + dh));
                panel.style.width = newW + 'px';
                panel.style.height = newH + 'px';
            };
            const onUp = () => {
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
                panel.classList.remove('recruit-hud-floating-resizing');
                savePosition({
                    left: parseInt(panel.style.left, 10) || 0,
                    top:  parseInt(panel.style.top,  10) || 0,
                    width:  panel.offsetWidth,
                    height: panel.offsetHeight
                });
            };
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        });

        // Double-click the header to reset to default top-left anchored position.
        header.addEventListener('dblclick', (e) => {
            if (e.target.closest('.recruit-hud-floating-toggle')) return;
            try { localStorage.removeItem(POS_STORAGE_KEY); } catch (_e) {}
            panel.classList.remove('recruit-hud-floating-user-positioned');
            panel.style.position = '';
            panel.style.top = '';
            panel.style.left = '';
            panel.style.right = '';
            panel.style.bottom = '';
            panel.style.width = '';
            panel.style.height = '';
        });
    }

    function toggleRecruitFloating() {
        const w = document.getElementById('recruitHudSections');
        const chev = document.getElementById('recruitFloatingChevron');
        if (!w) return;
        const collapsed = w.classList.toggle('recruit-hud-floating-collapsed');
        if (chev) chev.textContent = collapsed ? '+' : '−';
        w.querySelector('.recruit-hud-floating-toggle').title = collapsed ? 'Expand cockpit' : 'Minimize cockpit';
    }
    window.toggleRecruitFloating = toggleRecruitFloating;

    function sectionsHtml() {
        return ''
            + '<div class="recruit-candidate-bar" id="recruitCandidateBar" style="display:none;">'
            +   '<span class="recruit-cand-label">CANDIDATE</span>'
            +   '<span class="recruit-cand-name" id="recruitCandName">—</span>'
            +   '<span class="recruit-divider"></span>'
            +   '<span class="recruit-cand-jd" id="recruitCandJd">—</span>'
            +   '<span class="recruit-divider"></span>'
            +   '<span class="recruit-cand-round" id="recruitCandRound">—</span>'
            + '</div>'

            + '<div class="recruit-ask-next" id="recruitAskNext">'
            +   '<div class="recruit-section-header">'
            +     '<span class="recruit-section-label">ASK NEXT</span>'
            +     '<span class="recruit-section-help" title="AI-suggested follow-up questions. They replace each turn — pull from the top.">?</span>'
            +   '</div>'
            +   '<div class="recruit-ask-next-cards" id="recruitAskNextCards">'
            +     '<div class="recruit-empty-state" id="recruitAskEmpty">Listening… follow-up suggestions appear here once the candidate gives a substantive answer.</div>'
            +   '</div>'
            + '</div>'

            + '<div class="recruit-signals-row" id="recruitSignalsRow">'
            +   '<div class="recruit-quality-chip recruit-quality-empty" id="recruitQualityChip" title="Quality of the candidate\'s most recent answer — green / amber / red verdict will appear once the AI has graded an answer">'
            +     '<span class="recruit-quality-dot"></span>'
            +     '<span class="recruit-quality-label">LAST ANSWER</span>'
            +     '<span class="recruit-quality-text" id="recruitQualityText">waiting…</span>'
            +   '</div>'
            +   '<button type="button" class="recruit-jargon-trigger recruit-jargon-trigger-empty" id="recruitJargonTrigger" onclick="toggleRecruitJargonTray()" title="Plain-English definitions for technical terms the candidate uses — populates as jargon is detected">'
            +     '<span class="recruit-jargon-icon" aria-hidden="true">A.B</span>'
            +     '<span class="recruit-jargon-label">JARGON</span>'
            +     '<span class="recruit-jargon-count" id="recruitJargonCount">0</span>'
            +   '</button>'
            + '</div>'

            + '<div class="recruit-jargon-tray" id="recruitJargonTray" style="display:none;">'
            +   '<div class="recruit-jargon-list" id="recruitJargonList">'
            +     '<div class="recruit-empty-state recruit-jargon-empty-state">No technical terms detected yet — plain-English definitions appear here when the candidate uses domain jargon.</div>'
            +   '</div>'
            + '</div>'

            + '<div class="recruit-scorecard" id="recruitScorecard">'
            +   '<button type="button" class="recruit-scorecard-header" onclick="toggleRecruitScorecard()">'
            +     '<span class="recruit-scorecard-chevron">▸</span>'
            +     '<span class="recruit-section-label">SCORECARD</span>'
            +     '<span class="recruit-scorecard-summary" id="recruitScorecardSummary">fills as the candidate covers each competency</span>'
            +   '</button>'
            +   '<div class="recruit-scorecard-body" id="recruitScorecardBody" style="display:none;">'
            +     '<div class="recruit-empty-state recruit-scorecard-empty-state" id="recruitScorecardEmpty">Competency rows appear here as the AI marks signals from the conversation. You can override any AI verdict during or after the call.</div>'
            +   '</div>'
            + '</div>';
    }

    function wireSignalR() {
        if (!signalR) return;
        signalR.on('InterviewContextLoaded', onContextLoaded);
        signalR.on('InterviewContextMissing', onContextMissing);
        signalR.on('InterviewQuestionsUpdated', onQuestionsUpdated);
        signalR.on('AnswerQuality', onAnswerQuality);
        signalR.on('JargonDetected', onJargonDetected);
        signalR.on('ScorecardUpdate', onScorecardUpdate);
        signalR.on('InterviewReportDraft', onReportDraft);
    }

    // ─── SignalR handlers ────────────────────────────────────────────────

    function onContextLoaded(data) {
        const bar = document.getElementById('recruitCandidateBar');
        if (!bar) return;
        setText('recruitCandName', data.candidateName || '—');
        setText('recruitCandJd', data.jdTitle || '—');
        const roundLabel = (data.roundLabel || data.roundType || '').replace(/_/g, ' ');
        const idx = data.roundIndex && data.roundIndex > 0 ? ' · #' + data.roundIndex : '';
        setText('recruitCandRound', roundLabel ? roundLabel.toUpperCase() + idx : '—');
        bar.classList.remove('recruit-candidate-bar-warning');
        bar.style.display = 'flex';
        // Stash the interviewId for the Phase 4 review-modal PUT.
        reportInterviewId = data.interviewId || null;
        console.log('[RecruitHUD] candidate context loaded:', data.candidateName, '-', data.jdTitle, 'interviewId=', reportInterviewId);
    }

    function onContextMissing(_data) {
        const bar = document.getElementById('recruitCandidateBar');
        if (!bar) return;
        setText('recruitCandName', 'No HRMS link');
        setText('recruitCandJd', 'Generic interview coaching');
        setText('recruitCandRound', '—');
        bar.classList.add('recruit-candidate-bar-warning');
        bar.style.display = 'flex';
    }

    function onQuestionsUpdated(data) {
        const root = document.getElementById('recruitAskNext');
        const cards = document.getElementById('recruitAskNextCards');
        if (!root || !cards) return;

        askNextQueue = (data.questions || []).slice(0, 3);
        cards.innerHTML = '';
        if (askNextQueue.length === 0) {
            // Fall back to the empty state instead of hiding the panel —
            // the user should always see the cockpit shape, never a vanishing section.
            const empty = document.createElement('div');
            empty.className = 'recruit-empty-state';
            empty.id = 'recruitAskEmpty';
            empty.textContent = 'Listening… follow-up suggestions appear here once the candidate gives a substantive answer.';
            cards.appendChild(empty);
            return;
        }
        askNextQueue.forEach((q, i) => {
            const diff = (q.difficulty || 'medium').toLowerCase();
            const card = document.createElement('div');
            card.className = 'recruit-ask-card recruit-ask-card-rank-' + i;
            card.innerHTML = ''
                + '<div class="recruit-ask-meta">'
                +   '<span class="recruit-ask-topic">' + escapeHtml(q.topic || 'general') + '</span>'
                +   '<span class="recruit-ask-diff recruit-diff-' + diff + '">' + diff.toUpperCase() + '</span>'
                + '</div>'
                + '<div class="recruit-ask-q">' + escapeHtml(q.question || '') + '</div>'
                + (q.why ? '<div class="recruit-ask-why">' + escapeHtml(q.why) + '</div>' : '')
                + '<div class="recruit-ask-actions">'
                +   '<button type="button" class="recruit-ask-use" data-idx="' + i + '" onclick="useRecruitNextQuestion(' + i + ')" title="Copy to clipboard">USE</button>'
                +   '<button type="button" class="recruit-ask-skip" data-idx="' + i + '" onclick="skipRecruitNextQuestion(' + i + ')" title="Hide this suggestion">SKIP</button>'
                + '</div>';
            cards.appendChild(card);
        });
    }

    function onAnswerQuality(data) {
        const chip = document.getElementById('recruitQualityChip');
        if (!chip) return;

        chip.classList.remove('recruit-quality-empty', 'recruit-quality-green', 'recruit-quality-amber', 'recruit-quality-red');
        chip.classList.add('recruit-quality-' + (data.color || 'empty'));
        setText('recruitQualityText', truncate(data.reason || (data.color || '').toUpperCase(), 80));

        const conf = typeof data.confidence === 'number' ? Math.round(data.confidence * 100) + '%' : '';
        chip.title = 'Last answer · ' + (data.color || '').toUpperCase() + (conf ? ' · ' + conf : '') + '\n' + (data.reason || '');
    }

    // Normalize for map keys / dedup: trim + lowercase + Unicode NFC
    // composition. Avoids treating "Communication" and "communication" as
    // different scorecard rows, and " API " and "API" as different jargon
    // entries. NFC composes combining sequences (e.g. "café" with
    // U+00E9 vs e+U+0301) into the canonical form.
    function normKey(s) {
        if (!s) return '';
        try { return ('' + s).trim().toLowerCase().normalize('NFC'); }
        catch (_e) { return ('' + s).trim().toLowerCase(); }
    }

    function onJargonDetected(data) {
        const list = document.getElementById('recruitJargonList');
        const count = document.getElementById('recruitJargonCount');
        const trigger = document.getElementById('recruitJargonTrigger');
        if (!list || !count) return;

        const incoming = (data.terms || []).filter(t => t && t.term && t.definition);
        if (incoming.length === 0) return;

        // Prepend newest, dedupe by normalized term, cap 20.
        const seen = new Set(incoming.map(t => normKey(t.term)));
        jargonHistory = incoming.concat(jargonHistory.filter(t => !seen.has(normKey(t.term)))).slice(0, 20);
        count.textContent = jargonHistory.length;
        // First detection swaps the trigger out of empty styling.
        if (trigger) trigger.classList.remove('recruit-jargon-trigger-empty');

        list.innerHTML = '';
        jargonHistory.forEach(t => {
            const item = document.createElement('div');
            item.className = 'recruit-jargon-item';
            item.innerHTML = ''
                + '<span class="recruit-jargon-term">' + escapeHtml(t.term) + '</span>'
                + '<span class="recruit-jargon-def">' + escapeHtml(t.definition) + '</span>';
            list.appendChild(item);
        });
    }

    function onScorecardUpdate(data) {
        (data.deltas || []).forEach(d => {
            if (!d || !d.competency || !d.signal) return;
            // Normalize competency name for collision-safe Map keys (audit
            // fix: "Communication" and "communication" were creating two
            // separate scorecard rows). The original casing is preserved
            // in the row's `displayName` for rendering.
            const key = normKey(d.competency);
            if (!key) return;
            const existing = scorecardState.get(key);
            if (existing && existing.overridden) return;
            scorecardState.set(key, {
                signal: d.signal,
                evidenceQuote: d.evidenceQuote || '',
                displayName: (existing && existing.displayName) || d.competency,
                overridden: false,
            });
        });

        renderScorecard();
    }

    function renderScorecard() {
        const body = document.getElementById('recruitScorecardBody');
        const summary = document.getElementById('recruitScorecardSummary');
        if (!body || !summary) return;

        if (scorecardState.size === 0) {
            // Keep the empty-state placeholder visible until the first row arrives.
            body.innerHTML = '<div class="recruit-empty-state recruit-scorecard-empty-state" id="recruitScorecardEmpty">Competency rows appear here as the AI marks signals from the conversation. You can override any AI verdict during or after the call.</div>';
            summary.textContent = 'fills as the candidate covers each competency';
            return;
        }

        body.innerHTML = '';
        let demonstrated = 0, partial = 0, notYet = 0;
        const entries = Array.from(scorecardState.entries());
        // Sort: demonstrated last, not_yet first so the gaps are visible first.
        const rank = { not_yet: 0, partial: 1, demonstrated: 2 };
        entries.sort((a, b) => (rank[a[1].signal] || 0) - (rank[b[1].signal] || 0));

        entries.forEach(([key, d]) => {
            const sig = d.signal || 'not_yet';
            if (sig === 'demonstrated') demonstrated++;
            else if (sig === 'partial') partial++;
            else notYet++;

            // Map keys are normalized; render using the original casing
            // (displayName) so "Communication" doesn't show as "communication".
            const displayName = d.displayName || key;
            const row = document.createElement('div');
            row.className = 'recruit-sc-row recruit-sc-' + sig;
            const keyEsc = escapeAttr(key);
            const evidenceFull = d.evidenceQuote || '';
            const evidencePreview = evidenceFull ? '“' + truncate(evidenceFull, 70) + '”' : '';
            row.innerHTML = ''
                + '<span class="recruit-sc-comp" title="' + escapeAttr(displayName) + '">' + escapeHtml(displayName) + '</span>'
                + '<span class="recruit-sc-signal recruit-sc-signal-' + sig + '">' + sig.replace(/_/g, ' ') + (d.overridden ? ' (you)' : '') + '</span>'
                + (evidencePreview ? '<span class="recruit-sc-evidence" title="' + escapeAttr(evidenceFull) + '">' + escapeHtml(evidencePreview) + '</span>' : '<span class="recruit-sc-evidence"></span>')
                + '<select class="recruit-sc-override" data-comp="' + keyEsc + '" onchange="overrideRecruitScorecard(this.dataset.comp, this.value)">'
                +   '<option value="">override…</option>'
                +   '<option value="demonstrated"' + (sig === 'demonstrated' ? ' selected' : '') + '>demonstrated</option>'
                +   '<option value="partial"'      + (sig === 'partial'      ? ' selected' : '') + '>partial</option>'
                +   '<option value="not_yet"'      + (sig === 'not_yet'      ? ' selected' : '') + '>not yet</option>'
                + '</select>';
            body.appendChild(row);
        });

        summary.textContent = demonstrated + ' demo · ' + partial + ' partial · ' + notYet + ' gap';
    }

    // ─── Phase 4: end-of-call report ─────────────────────────────────────
    function onReportDraft(data) {
        reportDraft = data || null;
        reportSubmitted = false;
        if (reportDraft && reportDraft.interviewId) {
            reportInterviewId = reportDraft.interviewId;
        }
        console.log('[RecruitHUD] InterviewReportDraft received: recommendation=' + (data && data.overallRecommendation),
            'score=' + (data && data.overallScore), 'topics=' + ((data && data.topicsCovered && data.topicsCovered.length) || 0));
    }

    // Called by meeting.js's leaveMeeting() AFTER the backend has been told
    // to leave (so the AI report can be generated). Returns a Promise that
    // resolves when the recruiter has Submitted/Skipped, OR when the draft
    // never arrives within 15s. The draft is generated by AIEngine after the
    // bot tears down — there's a 2-10s delay between user clicking Leave
    // and the draft arriving over SignalR, so the modal first shows a
    // loader, then upgrades to the editable form once the draft arrives.
    async function showRecruitReportModal() {
        if (!isInterviewMode) return { action: 'not_interview_mode' };
        if (reportSubmitted) return { action: 'already_submitted' };

        // If we don't have the draft yet, wait for it (up to 15s) so the
        // backend tear-down → AIEngine session-end → SignalR broadcast chain
        // can complete. Display a non-blocking loader so the user knows we're
        // waiting on the AI rather than the UI being frozen.
        if (!reportDraft) {
            const loader = mountLoader();
            try {
                await waitForReportDraft(15000);
            } catch (_e) { /* timeout — fall through */ }
            if (loader && loader.parentNode) loader.parentNode.removeChild(loader);
            if (!reportDraft) {
                console.warn('[RecruitHUD] InterviewReportDraft did not arrive in 15s — AI version already auto-saved server-side');
                if (typeof Toast !== 'undefined' && Toast && Toast.warning) {
                    Toast.warning('Report still generating — AI version auto-saved. You can edit it later from the recruit panel.', 4000);
                }
                return { action: 'timeout' };
            }
        }

        return showRecruitReportModalCore();
    }

    function mountLoader() {
        const loader = document.createElement('div');
        loader.className = 'recruit-report-modal-overlay';
        loader.id = 'recruitReportLoaderOverlay';
        loader.innerHTML =
            '<div class="recruit-report-modal recruit-report-modal-loader">' +
            '  <div class="recruit-report-loader-spinner"></div>' +
            '  <div class="recruit-report-loader-text">Generating interview report…</div>' +
            '  <div class="recruit-report-loader-sub">The AI is summarizing the call. This usually takes 5-10 seconds.</div>' +
            '</div>';
        document.body.appendChild(loader);
        return loader;
    }

    function waitForReportDraft(timeoutMs) {
        return new Promise((resolve, reject) => {
            const start = Date.now();
            const tick = setInterval(() => {
                if (reportDraft) { clearInterval(tick); resolve(); }
                else if (Date.now() - start >= timeoutMs) { clearInterval(tick); reject(new Error('timeout')); }
            }, 200);
        });
    }

    function showRecruitReportModalCore() {
        return new Promise((resolve) => {
            if (!reportDraft) {
                resolve({ action: 'no_draft' });
                return;
            }

            const draft = reportDraft;
            const overlay = document.createElement('div');
            overlay.className = 'recruit-report-modal-overlay';
            overlay.id = 'recruitReportModalOverlay';

            // Build scorecard summary from the in-memory state — interviewer's
            // overrides during the meeting are preserved.
            const scLines = Array.from(scorecardState.entries()).map(([comp, d]) =>
                '<li><strong>' + escapeHtml(comp) + ':</strong> ' + escapeHtml((d.signal || '').replace(/_/g, ' ')) +
                (d.overridden ? ' <em>(your call)</em>' : '') + '</li>'
            );
            const scorecardHtml = scLines.length === 0
                ? '<p class="recruit-report-empty">No competency signals captured during the call.</p>'
                : '<ul class="recruit-report-scorecard">' + scLines.join('') + '</ul>';

            const topicLines = (draft.topicsCovered || []).map(t =>
                '<li><strong>' + escapeHtml(t.label || '—') + ':</strong> ' +
                'depth ' + (t.depthReached || 0) + '/3, score ' + (t.depthScore15 || 0) + '/5' +
                (t.notes ? ' — <em>' + escapeHtml(t.notes) + '</em>' : '') + '</li>'
            );
            const topicsHtml = topicLines.length === 0
                ? '<p class="recruit-report-empty">No topics covered.</p>'
                : '<ul class="recruit-report-topics">' + topicLines.join('') + '</ul>';

            const recOptions = ['proceed', 'second_round', 'reject', 'inconclusive'];
            const recHtml = recOptions.map(opt =>
                '<label class="recruit-report-rec-opt recruit-report-rec-' + opt + '">' +
                '<input type="radio" name="recruitRec" value="' + opt + '"' + ((draft.overallRecommendation === opt) ? ' checked' : '') + '> ' +
                opt.replace(/_/g, ' ').toUpperCase() +
                '</label>'
            ).join('');

            const score = Math.max(1, Math.min(10, draft.overallScore || 5));
            const strengthsStr = (draft.strengths || []).join('\n');
            const redFlagsStr = (draft.redFlags || []).join('\n');

            overlay.innerHTML = ''
                + '<div class="recruit-report-modal" role="dialog" aria-modal="true">'
                +   '<div class="recruit-report-modal-header">'
                +     '<span class="recruit-report-modal-title">Interview Report — AI Draft</span>'
                +     '<button type="button" class="recruit-report-modal-close" data-action="skip" title="Skip review">×</button>'
                +   '</div>'
                +   '<div class="recruit-report-modal-body">'
                +     '<p class="recruit-report-modal-hint">Review the AI-drafted report. Edit anything before submitting — the AI version is already saved as a draft, so Skip just keeps the AI\'s version.</p>'

                +     '<label class="recruit-report-label">RECOMMENDATION</label>'
                +     '<div class="recruit-report-rec-row" id="recruitReportRecRow">' + recHtml + '</div>'

                +     '<label class="recruit-report-label">OVERALL SCORE <span class="recruit-report-score-val" id="recruitReportScoreVal">' + score + '</span> / 10</label>'
                +     '<input type="range" min="1" max="10" step="1" value="' + score + '" id="recruitReportScore" class="recruit-report-score-slider">'

                +     '<label class="recruit-report-label" for="recruitReportSummary">SUMMARY</label>'
                +     '<textarea id="recruitReportSummary" class="recruit-report-summary" rows="4" placeholder="1-2 paragraph hiring summary…">' + escapeHtml(draft.summaryText || '') + '</textarea>'

                +     '<div class="recruit-report-twocol">'
                +       '<div>'
                +         '<label class="recruit-report-label" for="recruitReportStrengths">STRENGTHS (one per line)</label>'
                +         '<textarea id="recruitReportStrengths" class="recruit-report-list" rows="4" placeholder="e.g. Clear communication">' + escapeHtml(strengthsStr) + '</textarea>'
                +       '</div>'
                +       '<div>'
                +         '<label class="recruit-report-label" for="recruitReportRedFlags">RED FLAGS (one per line)</label>'
                +         '<textarea id="recruitReportRedFlags" class="recruit-report-list" rows="4" placeholder="e.g. Vague on system design">' + escapeHtml(redFlagsStr) + '</textarea>'
                +       '</div>'
                +     '</div>'

                +     '<label class="recruit-report-label">SCORECARD (read-only — set during call)</label>'
                +     scorecardHtml

                +     '<label class="recruit-report-label">TOPICS COVERED (AI-detected, read-only)</label>'
                +     topicsHtml

                +   '</div>'
                +   '<div class="recruit-report-modal-footer">'
                +     '<button type="button" class="recruit-report-btn recruit-report-btn-skip" data-action="skip">Skip</button>'
                +     '<button type="button" class="recruit-report-btn recruit-report-btn-submit" data-action="submit">Submit Report</button>'
                +   '</div>'
                + '</div>';

            document.body.appendChild(overlay);

            const scoreInput = document.getElementById('recruitReportScore');
            const scoreVal = document.getElementById('recruitReportScoreVal');
            if (scoreInput && scoreVal) {
                scoreInput.addEventListener('input', () => { scoreVal.textContent = scoreInput.value; });
            }

            // Double-submit guard: once the user clicks Submit, disable the
            // button and ignore subsequent clicks. Prevents the audit-flagged
            // double-POST scenario (slow network + impatient user).
            let inFlight = false;

            overlay.addEventListener('click', (e) => {
                const action = e.target && e.target.getAttribute && e.target.getAttribute('data-action');
                if (!action) return;
                if (inFlight) return;
                if (action === 'skip') {
                    cleanup();
                    resolve({ action: 'skip' });
                } else if (action === 'submit') {
                    inFlight = true;
                    const submitBtn = overlay.querySelector('.recruit-report-btn-submit');
                    const skipBtn = overlay.querySelector('.recruit-report-btn-skip');
                    if (submitBtn) {
                        submitBtn.disabled = true;
                        submitBtn.classList.add('recruit-report-btn-loading');
                        submitBtn.textContent = 'Submitting…';
                    }
                    if (skipBtn) skipBtn.disabled = true;

                    submitFromModal()
                        .then(() => { reportSubmitted = true; cleanup(); resolve({ action: 'submitted' }); })
                        .catch((err) => {
                            console.warn('[RecruitHUD] report submit failed:', err);
                            if (typeof Toast !== 'undefined' && Toast && Toast.error) {
                                Toast.error('Failed to submit report — the AI draft has been auto-saved.', 4000);
                            }
                            cleanup();
                            resolve({ action: 'submit_failed', error: err && err.message });
                        });
                }
            });

            function cleanup() {
                if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
            }
        });
    }

    async function submitFromModal() {
        if (!reportInterviewId) {
            throw new Error('No interview_id captured — AI draft was already saved automatically.');
        }
        const recRadio = document.querySelector('input[name="recruitRec"]:checked');
        const scoreEl = document.getElementById('recruitReportScore');
        const summaryEl = document.getElementById('recruitReportSummary');
        const strengthsEl = document.getElementById('recruitReportStrengths');
        const redFlagsEl = document.getElementById('recruitReportRedFlags');

        const payload = {
            overall_recommendation: (recRadio && recRadio.value) || (reportDraft && reportDraft.overallRecommendation) || 'inconclusive',
            overall_score: parseInt((scoreEl && scoreEl.value) || (reportDraft && reportDraft.overallScore) || 5, 10),
            summary_text: (summaryEl && summaryEl.value) || '',
            strengths: ((strengthsEl && strengthsEl.value) || '').split('\n').map(s => s.trim()).filter(s => s.length > 0),
            red_flags: ((redFlagsEl && redFlagsEl.value) || '').split('\n').map(s => s.trim()).filter(s => s.length > 0),
            topics_covered: (reportDraft && reportDraft.topicsCovered) || [],
            transcript_url: null,
        };

        // Use the shared api singleton — endpoint prefixed with /hrms/ so
        // api.js routes to CONFIG.hrmsApiBaseUrl (prefix is stripped before
        // hitting the backend route /api/job-applications/...).
        if (typeof api === 'undefined' || !api || typeof api.request !== 'function') {
            throw new Error('api singleton unavailable');
        }
        const endpoint = '/hrms/job-applications/interviews/' + encodeURIComponent(reportInterviewId) + '/report';
        const res = await api.request(endpoint, {
            method: 'PUT',
            body: JSON.stringify(payload),
        });
        console.log('[RecruitHUD] report submitted:', res);
        if (typeof Toast !== 'undefined' && Toast && Toast.success) Toast.success('Report submitted', 2500);
    }

    // ─── UI actions ──────────────────────────────────────────────────────

    function toggleRecruitJargonTray() {
        const tray = document.getElementById('recruitJargonTray');
        const btn = document.getElementById('recruitJargonTrigger');
        if (!tray || !btn) return;
        const open = tray.style.display !== 'none';
        tray.style.display = open ? 'none' : 'block';
        btn.classList.toggle('recruit-jargon-trigger-open', !open);
    }

    function toggleRecruitScorecard() {
        const body = document.getElementById('recruitScorecardBody');
        const chevron = document.querySelector('#recruitScorecard .recruit-scorecard-chevron');
        if (!body) return;
        const open = body.style.display !== 'none';
        body.style.display = open ? 'none' : 'block';
        if (chevron) chevron.textContent = open ? '▸' : '▾';
    }

    function useRecruitNextQuestion(idx) {
        const q = askNextQueue[idx];
        if (!q) return;
        copyToClipboard(q.question);
        const card = document.querySelectorAll('.recruit-ask-card')[idx];
        if (card) {
            card.classList.add('recruit-ask-card-flash');
            setTimeout(() => card.classList.remove('recruit-ask-card-flash'), 600);
        }
        if (typeof Toast !== 'undefined' && Toast && Toast.success) {
            Toast.success('Copied: ' + truncate(q.question, 60), 2000);
        }
    }

    function skipRecruitNextQuestion(idx) {
        askNextQueue.splice(idx, 1);
        // Re-render the remaining cards with their new indices.
        onQuestionsUpdated({ questions: askNextQueue });
    }

    function overrideRecruitScorecard(competency, value) {
        if (!competency) return;
        // Normalize key for collision safety — matches what the renderer
        // wrote into the data-comp attribute.
        const key = normKey(competency);
        if (!key) return;
        const existing = scorecardState.get(key) || { signal: 'not_yet', evidenceQuote: '', displayName: competency, overridden: false };
        if (!value) {
            existing.overridden = false;
            scorecardState.set(key, existing);
        } else {
            existing.signal = value;
            existing.overridden = true;
            scorecardState.set(key, existing);
        }
        renderScorecard();
    }

    // ─── Utilities ───────────────────────────────────────────────────────

    function setText(id, txt) {
        const el = document.getElementById(id);
        if (el) el.textContent = txt;
    }

    function truncate(s, n) {
        if (!s) return '';
        return s.length > n ? s.substring(0, n - 1) + '…' : s;
    }

    function escapeHtml(s) {
        const div = document.createElement('div');
        div.textContent = s == null ? '' : String(s);
        return div.innerHTML;
    }

    function escapeAttr(s) {
        return escapeHtml(s).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function copyToClipboard(text) {
        if (!text) return;
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
        } else {
            fallbackCopy(text);
        }
    }

    function fallbackCopy(text) {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand('copy'); } catch (_e) { /* noop */ }
        document.body.removeChild(ta);
    }

    // ─── Exports ─────────────────────────────────────────────────────────
    window.initRecruitHud = initRecruitHud;
    window.toggleRecruitJargonTray = toggleRecruitJargonTray;
    window.toggleRecruitScorecard = toggleRecruitScorecard;
    window.useRecruitNextQuestion = useRecruitNextQuestion;
    window.skipRecruitNextQuestion = skipRecruitNextQuestion;
    window.overrideRecruitScorecard = overrideRecruitScorecard;
    window.showRecruitReportModal = showRecruitReportModal;
})();
