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
            +   '<label class="recruit-hud-opacity-control" title="Adjust cockpit transparency — see the candidate video behind the HUD">'
            +     '<span class="recruit-hud-opacity-icon" aria-hidden="true">◐</span>'
            +     '<input type="range" id="recruitHudOpacitySlider" min="20" max="100" step="5" value="100" aria-label="Cockpit opacity">'
            +   '</label>'
            +   '<button type="button" class="recruit-hud-floating-toggle" id="recruitMaximizeToggle" onclick="toggleRecruitMaximize()" title="Maximize cockpit to full screen">'
            +     '<span id="recruitMaximizeIcon">⛶</span>'
            +   '</button>'
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
        setupOpacitySlider(wrapper);
    }

    // ── Opacity slider — let the host see the candidate video behind the HUD
    // when maximized, without losing the panel entirely. Range 20–100%
    // (never goes fully invisible or it becomes impossible to grab back).
    const OPACITY_STORAGE_KEY = 'recruitHud.opacity.v1';

    function setupOpacitySlider(panel) {
        const slider = panel.querySelector('#recruitHudOpacitySlider');
        if (!slider) return;

        let initial = 100;
        try {
            const raw = localStorage.getItem(OPACITY_STORAGE_KEY);
            if (raw) {
                const n = parseInt(raw, 10);
                if (Number.isFinite(n) && n >= 20 && n <= 100) initial = n;
            }
        } catch (_e) {}

        slider.value = String(initial);
        applyOpacity(panel, initial);

        const onInput = (e) => {
            e.stopPropagation();
            const v = parseInt(slider.value, 10) || 100;
            applyOpacity(panel, v);
            try { localStorage.setItem(OPACITY_STORAGE_KEY, String(v)); } catch (_e) {}
        };
        slider.addEventListener('input', onInput);
        // Stop the header's drag handler from grabbing slider drags.
        ['mousedown', 'pointerdown', 'touchstart', 'click', 'dblclick'].forEach(evt => {
            slider.addEventListener(evt, (e) => e.stopPropagation());
        });
    }

    function applyOpacity(panel, percent) {
        // Expose as CSS var so all background layers can scale together.
        // Values map 100 → 1.0, 20 → 0.2.
        panel.style.setProperty('--rh-alpha', String(percent / 100));
    }

    // ── Draggable + resizable cockpit ────────────────────────────────────
    const POS_STORAGE_KEY = 'recruitHud.position.v1';

    // Minimum top — keeps the panel header below the page nav bar so the
    // drag grip is always reachable. Without this, the user can drag the
    // header behind a fixed top nav and lose grab-target visibility,
    // requiring localStorage clear or ESC-reset to recover.
    const MIN_TOP = 60;

    function loadSavedPosition() {
        try {
            const raw = localStorage.getItem(POS_STORAGE_KEY);
            if (!raw) return null;
            const p = JSON.parse(raw);
            // Clamp to current viewport so old positions on smaller screens
            // don't push the panel off-screen. Top is clamped to MIN_TOP
            // so the header never lands under the nav.
            const maxLeft = window.innerWidth - 80;
            const maxTop = window.innerHeight - 40;
            return {
                left: Math.max(0, Math.min(maxLeft, p.left | 0)),
                top:  Math.max(MIN_TOP, Math.min(maxTop,  p.top  | 0)),
                // Allow saved widths up to viewport (was capped at 720 in the
                // resize handler, but a maximized cockpit should round-trip
                // through localStorage at full width).
                width:  Math.max(240, Math.min(window.innerWidth - 8,   p.width  | 0)),
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
                // Keep header reachable: never let panel.top go ABOVE the nav
                // (would hide the drag grip behind a fixed nav), and never
                // push BELOW viewport bottom - header height (would clip the
                // panel below the fold with no grab target).
                const maxTop = window.innerHeight - 32;
                const newLeft = Math.max(0, Math.min(maxLeft, startLeft + dx));
                const newTop  = Math.max(MIN_TOP, Math.min(maxTop,  startTop + dy));
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
                // Allow up to viewport width/height — recruiter may want
                // full-screen cockpit when reading long question stacks.
                const maxW = window.innerWidth - left - 8;
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

    // Stash for restore — captures the geometry the user had before
    // clicking Maximize, so the second click puts it back exactly.
    let _preMaximizeGeometry = null;

    function toggleRecruitMaximize() {
        const panel = document.getElementById('recruitHudSections');
        const icon = document.getElementById('recruitMaximizeIcon');
        const btn = document.getElementById('recruitMaximizeToggle');
        if (!panel) return;
        const isMaximized = panel.classList.contains('recruit-hud-floating-maximized');
        if (isMaximized) {
            // Restore previous geometry
            panel.classList.remove('recruit-hud-floating-maximized');
            if (_preMaximizeGeometry) {
                panel.style.position = _preMaximizeGeometry.position || 'fixed';
                panel.style.top = _preMaximizeGeometry.top;
                panel.style.left = _preMaximizeGeometry.left;
                panel.style.right = _preMaximizeGeometry.right || 'auto';
                panel.style.bottom = _preMaximizeGeometry.bottom || 'auto';
                panel.style.width = _preMaximizeGeometry.width;
                panel.style.height = _preMaximizeGeometry.height;
            } else {
                // No prior geometry — reset to default anchored position
                panel.classList.remove('recruit-hud-floating-user-positioned');
                panel.style.position = '';
                panel.style.top = '';
                panel.style.left = '';
                panel.style.right = '';
                panel.style.bottom = '';
                panel.style.width = '';
                panel.style.height = '';
            }
            if (icon) icon.textContent = '⛶';
            if (btn) btn.title = 'Maximize cockpit to full screen';
            // Save the restored position so it round-trips on reload.
            if (panel.classList.contains('recruit-hud-floating-user-positioned')) {
                savePosition({
                    left: parseInt(panel.style.left, 10) || 0,
                    top: parseInt(panel.style.top, 10) || 0,
                    width: panel.offsetWidth,
                    height: panel.offsetHeight
                });
            }
        } else {
            // Snapshot current geometry, then go full-screen
            _preMaximizeGeometry = {
                position: panel.style.position,
                top: panel.style.top,
                left: panel.style.left,
                right: panel.style.right,
                bottom: panel.style.bottom,
                width: panel.style.width,
                height: panel.style.height
            };
            panel.classList.add('recruit-hud-floating-user-positioned', 'recruit-hud-floating-maximized');
            panel.style.position = 'fixed';
            panel.style.top = MIN_TOP + 'px';
            panel.style.left = '8px';
            panel.style.right = 'auto';
            panel.style.bottom = '8px';
            panel.style.width = (window.innerWidth - 16) + 'px';
            panel.style.height = (window.innerHeight - MIN_TOP - 16) + 'px';
            if (icon) icon.textContent = '⊟';
            if (btn) btn.title = 'Restore cockpit to previous size';
        }
    }
    window.toggleRecruitMaximize = toggleRecruitMaximize;

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
            + '<div class="recruit-session-meter" id="recruitSessionMeter" title="Session timer · talk balance · topics covered">'
            +   '<span class="recruit-meter-cell"><span class="recruit-meter-label">ELAPSED</span><span class="recruit-meter-value" id="recruitElapsed">00:00</span></span>'
            +   '<span class="recruit-meter-cell" id="recruitTalkRatio" title="Talk balance — aim for ~30% you, ~70% candidate">'
            +     '<span class="recruit-meter-label">TALK</span>'
            +     '<span class="recruit-meter-bar">'
            +       '<span class="recruit-meter-bar-host" id="recruitTalkBarHost" style="width: 50%;"></span>'
            +       '<span class="recruit-meter-bar-cand" id="recruitTalkBarCand" style="width: 50%;"></span>'
            +     '</span>'
            +     '<span class="recruit-meter-value" id="recruitTalkPct">—</span>'
            +   '</span>'
            +   '<span class="recruit-meter-cell" title="Topics covered · partial · gap (from the scorecard)"><span class="recruit-meter-label">TOPICS</span><span class="recruit-meter-value" id="recruitTopicMini">0/0</span></span>'
            + '</div>'

            + '<div class="recruit-candidate-bar" id="recruitCandidateBar" style="display:none;">'
            +   '<span class="recruit-cand-label">CANDIDATE</span>'
            +   '<span class="recruit-cand-name" id="recruitCandName">—</span>'
            +   '<span class="recruit-divider"></span>'
            +   '<span class="recruit-cand-jd" id="recruitCandJd">—</span>'
            +   '<span class="recruit-divider"></span>'
            +   '<span class="recruit-cand-round" id="recruitCandRound">—</span>'
            + '</div>'

            + '<div class="recruit-answer-assist" id="recruitAnswerAssist" style="display:none;">'
            +   '<div class="recruit-answer-assist-header">'
            +     '<span class="recruit-answer-assist-icon" aria-hidden="true">🎤</span>'
            +     '<span class="recruit-answer-assist-label">ANSWER ASSIST</span>'
            +     '<span class="recruit-answer-assist-clock" id="recruitAnswerAssistClock">—</span>'
            +     '<button type="button" class="recruit-answer-assist-dismiss" id="recruitAnswerAssistDismiss" onclick="dismissRecruitAnswerAssist()" title="Dismiss">×</button>'
            +   '</div>'
            +   '<div class="recruit-answer-assist-question" id="recruitAnswerAssistQuestion"></div>'
            +   '<div class="recruit-answer-assist-body" id="recruitAnswerAssistBody"></div>'
            + '</div>'

            + '<div class="recruit-trust-check" id="recruitTrustCheck" style="display:none;">'
            +   '<div class="recruit-trust-check-header">'
            +     '<span class="recruit-trust-check-icon" aria-hidden="true">🛡️</span>'
            +     '<span class="recruit-trust-check-label">TRUST CHECK</span>'
            +     '<span class="recruit-trust-check-clock" id="recruitTrustCheckClock">—</span>'
            +     '<button type="button" class="recruit-trust-check-dismiss" onclick="dismissRecruitTrustCheck()" title="Dismiss">×</button>'
            +   '</div>'
            +   '<div class="recruit-trust-check-signals" id="recruitTrustCheckSignals"></div>'
            +   '<div class="recruit-trust-check-probe-label">VERBAL COUNTER-PROBE</div>'
            +   '<div class="recruit-trust-check-probe" id="recruitTrustCheckProbe"></div>'
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
            +   '<button type="button" class="recruit-quality-chip recruit-quality-empty" id="recruitQualityChip" onclick="toggleRecruitQualityExpand()" title="Click to expand — full reason + confidence">'
            +     '<span class="recruit-quality-dot"></span>'
            +     '<span class="recruit-quality-label">LAST ANSWER</span>'
            +     '<span class="recruit-quality-text" id="recruitQualityText">waiting…</span>'
            +   '</button>'
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
        signalR.on('CopilotInsight', onCopilotInsightForRecruit);
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

    // Pinned cards survive AI refreshes — the user picks one to anchor on, asks
    // it, and the card STAYS visible until they manually unpin (or skip).
    // Identity is the verbatim question text since AI doesn't emit stable IDs.
    let pinnedQuestions = []; // each: { question, why, topic, difficulty }

    function onQuestionsUpdated(data) {
        const root = document.getElementById('recruitAskNext');
        const cards = document.getElementById('recruitAskNextCards');
        if (!root || !cards) return;

        // Merge: pinned cards always show on top (up to MAX_PINNED), with
        // fresh AI suggestions appended below them (up to MAX_FRESH). The
        // earlier shared-cap of 3 starved fresh questions whenever all 3
        // slots were pinned — the host stopped seeing new AI suggestions
        // entirely and thought the AI had stopped emitting. De-dupe so the
        // AI doesn't re-suggest an already-pinned question.
        const MAX_PINNED = 3;
        const MAX_FRESH = 3;
        const pinnedKeys = new Set(pinnedQuestions.map(p => (p.question || '').trim().toLowerCase()));
        const incoming = (data.questions || [])
            .filter(q => !pinnedKeys.has((q.question || '').trim().toLowerCase()));
        askNextQueue = [
            ...pinnedQuestions.slice(0, MAX_PINNED).map(p => ({ ...p, _pinned: true })),
            ...incoming.slice(0, MAX_FRESH).map(q => ({ ...q, _pinned: false }))
        ];

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
            const isPinned = !!q._pinned;
            const card = document.createElement('div');
            card.className = 'recruit-ask-card recruit-ask-card-rank-' + i + (isPinned ? ' recruit-ask-card-pinned' : '');
            const useLabel = isPinned ? 'UNPIN' : 'USE';
            const useTitle = isPinned ? 'Unpin — let AI replace on next refresh' : 'Copy to clipboard + pin this card so it stays visible across AI refreshes';
            const pinBadge = isPinned ? '<span class="recruit-ask-pinned-badge" title="Pinned — survives AI refresh">📌 PINNED</span>' : '';
            card.innerHTML = ''
                + '<div class="recruit-ask-meta">'
                +   '<span class="recruit-ask-topic">' + escapeHtml(q.topic || 'general') + '</span>'
                +   '<span class="recruit-ask-diff recruit-diff-' + diff + '">' + diff.toUpperCase() + '</span>'
                +   pinBadge
                + '</div>'
                + '<div class="recruit-ask-q">' + escapeHtml(q.question || '') + '</div>'
                + (q.why ? '<div class="recruit-ask-why">' + escapeHtml(q.why) + '</div>' : '')
                + '<div class="recruit-ask-actions">'
                +   '<button type="button" class="recruit-ask-use" data-idx="' + i + '" onclick="useRecruitNextQuestion(' + i + ')" title="' + escapeAttr(useTitle) + '">' + useLabel + '</button>'
                +   '<button type="button" class="recruit-ask-skip" data-idx="' + i + '" onclick="skipRecruitNextQuestion(' + i + ')" title="Hide this suggestion">SKIP</button>'
                + '</div>';
            cards.appendChild(card);
        });
    }

    // Remember the full reason + confidence so the expand handler can show it.
    let _lastAnswerQuality = { reason: '', confidence: null, color: '' };
    function onAnswerQuality(data) {
        const chip = document.getElementById('recruitQualityChip');
        if (!chip) return;

        chip.classList.remove('recruit-quality-empty', 'recruit-quality-green', 'recruit-quality-amber', 'recruit-quality-red');
        chip.classList.add('recruit-quality-' + (data.color || 'empty'));
        _lastAnswerQuality = {
            reason: data.reason || '',
            confidence: typeof data.confidence === 'number' ? data.confidence : null,
            color: data.color || ''
        };
        // If chip is currently expanded, refresh the expanded view; otherwise
        // show the truncated version.
        if (chip.classList.contains('recruit-quality-expanded')) {
            renderQualityExpanded();
        } else {
            setText('recruitQualityText', truncate(data.reason || (data.color || '').toUpperCase(), 80));
        }

        const conf = _lastAnswerQuality.confidence != null ? Math.round(_lastAnswerQuality.confidence * 100) + '%' : '';
        chip.title = 'Click to expand · Last answer · ' + (data.color || '').toUpperCase() + (conf ? ' · ' + conf : '');
    }

    function renderQualityExpanded() {
        const conf = _lastAnswerQuality.confidence != null ? Math.round(_lastAnswerQuality.confidence * 100) + '%' : '';
        const reason = _lastAnswerQuality.reason || '(no reason given)';
        const textEl = document.getElementById('recruitQualityText');
        if (!textEl) return;
        // Keep label visible but swap the truncated reason for a multi-line
        // block that includes confidence.
        textEl.innerHTML = '';
        const reasonDiv = document.createElement('div');
        reasonDiv.className = 'recruit-quality-expanded-reason';
        reasonDiv.textContent = reason;
        textEl.appendChild(reasonDiv);
        if (conf) {
            const confDiv = document.createElement('div');
            confDiv.className = 'recruit-quality-expanded-conf';
            confDiv.textContent = 'Confidence: ' + conf;
            textEl.appendChild(confDiv);
        }
    }

    function toggleRecruitQualityExpand() {
        const chip = document.getElementById('recruitQualityChip');
        if (!chip) return;
        // Empty state: nothing to expand, but provide click feedback so the
        // recruiter knows the chip is interactive once a verdict lands.
        if (chip.classList.contains('recruit-quality-empty')) {
            if (typeof Toast !== 'undefined' && Toast && Toast.info) {
                Toast.info('Waiting on AI — verdict appears here after the candidate finishes a substantive answer.', 3000);
            }
            return;
        }
        const wasExpanded = chip.classList.toggle('recruit-quality-expanded');
        if (wasExpanded) {
            renderQualityExpanded();
        } else {
            // Restore the compact truncated view
            const reason = _lastAnswerQuality.reason || (_lastAnswerQuality.color || '').toUpperCase();
            setText('recruitQualityText', truncate(reason, 80));
        }
    }
    window.toggleRecruitQualityExpand = toggleRecruitQualityExpand;

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
        const key = (q.question || '').trim().toLowerCase();
        const wasPinned = !!q._pinned;

        if (wasPinned) {
            // Toggle off — unpin. Card stays in place until next AI refresh.
            pinnedQuestions = pinnedQuestions.filter(p => (p.question || '').trim().toLowerCase() !== key);
            askNextQueue[idx] = { ...q, _pinned: false };
            if (typeof Toast !== 'undefined' && Toast && Toast.info) {
                Toast.info('Unpinned — card will refresh on next AI suggestion.', 2000);
            }
        } else {
            // Pin + copy to clipboard so the recruiter can paste / read it.
            copyToClipboard(q.question);
            // Keep only stable fields when adding to pinned list — drop _pinned flag.
            const pinnable = { question: q.question, why: q.why, topic: q.topic, difficulty: q.difficulty };
            pinnedQuestions.push(pinnable);
            // Cap at 3 pinned — drop the OLDEST if we'd exceed.
            if (pinnedQuestions.length > 3) pinnedQuestions = pinnedQuestions.slice(-3);
            askNextQueue[idx] = { ...q, _pinned: true };
            if (typeof Toast !== 'undefined' && Toast && Toast.success) {
                Toast.success('📌 Pinned + copied: ' + truncate(q.question, 50), 2200);
            }
        }
        // Re-render in place so the pin badge + button label update without
        // losing the flash effect we trigger below.
        onQuestionsUpdated({ questions: askNextQueue.filter(q => !q._pinned) });
        const card = document.querySelectorAll('.recruit-ask-card')[idx];
        if (card) {
            card.classList.add('recruit-ask-card-flash');
            setTimeout(() => card.classList.remove('recruit-ask-card-flash'), 600);
        }
    }

    function skipRecruitNextQuestion(idx) {
        const q = askNextQueue[idx];
        if (q && q._pinned) {
            // Skipping a pinned card also unpins it.
            const key = (q.question || '').trim().toLowerCase();
            pinnedQuestions = pinnedQuestions.filter(p => (p.question || '').trim().toLowerCase() !== key);
        }
        askNextQueue.splice(idx, 1);
        // Re-render the remaining cards with their new indices.
        onQuestionsUpdated({ questions: askNextQueue.filter(q => !q._pinned) });
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

    // ─── Session meter (Tier 1) ───────────────────────────────────────────
    // Elapsed timer + talk-balance bar + topic-count. Updated every second
    // so the recruiter has constant glanceable awareness of pacing.
    let _sessionStartMs = 0;
    let _talkAccumMs = { host: 0, candidate: 0 };
    let _speakingStarts = new Map();  // identity → ms timestamp
    let _lastSpeakerActivityMs = 0;
    let _hostCurrentRunStartMs = 0;   // for talk-pace warning
    let _paceWarningShownMs = 0;      // debounce
    let _silenceWarningShownMs = 0;   // debounce
    let _timerInterval = null;

    function startSessionMeter() {
        _sessionStartMs = Date.now();
        _lastSpeakerActivityMs = _sessionStartMs;
        if (_timerInterval) clearInterval(_timerInterval);
        _timerInterval = setInterval(updateSessionMeter, 1000);
        updateSessionMeter();
    }

    function updateSessionMeter() {
        if (!_sessionStartMs) return;
        const now = Date.now();
        const elapsedSec = Math.floor((now - _sessionStartMs) / 1000);
        const mm = Math.floor(elapsedSec / 60);
        const ss = elapsedSec % 60;
        setText('recruitElapsed', `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`);

        // Include current in-progress speaking time in the totals
        let hostMs = _talkAccumMs.host;
        let candMs = _talkAccumMs.candidate;
        for (const [id, startMs] of _speakingStarts) {
            const dur = now - startMs;
            if (id === '__host__') hostMs += dur;
            else candMs += dur;
        }
        const total = hostMs + candMs;
        if (total > 0) {
            const hostPct = Math.round((hostMs / total) * 100);
            const candPct = 100 - hostPct;
            const hostBar = document.getElementById('recruitTalkBarHost');
            const candBar = document.getElementById('recruitTalkBarCand');
            if (hostBar) hostBar.style.width = hostPct + '%';
            if (candBar) candBar.style.width = candPct + '%';
            setText('recruitTalkPct', `${hostPct}/${candPct}`);
        }

        // Talk-pace warning — host monologuing >90s straight
        if (_hostCurrentRunStartMs > 0) {
            const runSec = (now - _hostCurrentRunStartMs) / 1000;
            if (runSec > 90 && now - _paceWarningShownMs > 60_000) {
                _paceWarningShownMs = now;
                if (typeof Toast !== 'undefined' && Toast && Toast.warning) {
                    Toast.warning('You\'ve been talking ~90s — pause and let the candidate in.', 5000);
                }
            }
        }

        // Silence detection — nobody spoken in 8s after session warm-up
        if (now - _sessionStartMs > 30_000) {  // give the first 30s grace
            const silenceSec = (now - _lastSpeakerActivityMs) / 1000;
            if (silenceSec > 8 && now - _silenceWarningShownMs > 30_000 && _speakingStarts.size === 0) {
                _silenceWarningShownMs = now;
                if (typeof Toast !== 'undefined' && Toast && Toast.warning) {
                    Toast.warning('Candidate quiet — invite them to think out loud or rephrase.', 4500);
                }
            }
        }

        // Topic mini-counter — derived from scorecard state
        if (scorecardState && scorecardState.size > 0) {
            let demo = 0, partial = 0, gap = 0;
            for (const [, d] of scorecardState) {
                if (d.signal === 'demonstrated') demo++;
                else if (d.signal === 'partial') partial++;
                else gap++;
            }
            setText('recruitTopicMini', `${demo}/${scorecardState.size}`);
        }
    }

    // Public hook called by meeting.js's active-speakers changed handler.
    // identities are LiveKit participant identities; isHost flag is computed
    // by meeting.js (host is the authenticated user, candidates are guests
    // or other authenticated participants).
    window.__recruitOnSpeakerChange = function (currentSpeakingIdentities, hostIdentity) {
        if (!_sessionStartMs) return;
        const now = Date.now();
        _lastSpeakerActivityMs = now;
        const currentSet = new Set(currentSpeakingIdentities || []);

        // For everyone WHO WAS speaking but is no longer → finalize their accum
        for (const [id, startMs] of Array.from(_speakingStarts)) {
            if (!currentSet.has(id === '__host__' ? hostIdentity : id)) {
                const dur = now - startMs;
                if (id === '__host__') {
                    _talkAccumMs.host += dur;
                    _hostCurrentRunStartMs = 0;
                } else {
                    _talkAccumMs.candidate += dur;
                }
                _speakingStarts.delete(id);
            }
        }

        // For everyone newly speaking → start tracking
        for (const id of currentSet) {
            const isHost = id === hostIdentity;
            const key = isHost ? '__host__' : id;
            if (!_speakingStarts.has(key)) {
                _speakingStarts.set(key, now);
                if (isHost) _hostCurrentRunStartMs = now;
            }
        }
    };

    // ─── Drift visual alert + Answer Assist (Tier 2 + MVP) ─────────────
    // The AI emits CopilotInsight with:
    //   - type=move_on            → drift detected, pulse the HUD red.
    //   - type=key_moment with content starting "Candidate asked:"
    //                              → render the Answer Assist card so the
    //                                interviewer has bullet-point answers
    //                                ready when the candidate flips the script.
    let _answerAssistAutoDismissId = null;
    function onCopilotInsightForRecruit(data) {
        if (!isInterviewMode || !data) return;

        if (data.type === 'move_on') {
            const panel = document.getElementById('recruitHudSections');
            if (panel) {
                panel.classList.add('recruit-hud-drift-alert');
                setTimeout(() => panel.classList.remove('recruit-hud-drift-alert'), 5000);
            }
            if (typeof Toast !== 'undefined' && Toast && Toast.info) {
                Toast.info('AI detected drift — top question is a redirect to keep on topic.', 4000);
            }
            return;
        }

        if (data.type === 'key_moment' && data.content) {
            const c = String(data.content).trim();
            if (/^candidate asked:/i.test(c)) {
                showAnswerAssist(data);
                return;
            }
            if (/^ai[- ]?assist suspected:/i.test(c)) {
                showTrustCheck(data);
                return;
            }
        }
    }

    // ─── Trust Check (AI-cheating detection) ──────────────────────────
    let _trustCheckAutoDismissId = null;
    function showTrustCheck(insight) {
        const root = document.getElementById('recruitTrustCheck');
        const sigEl = document.getElementById('recruitTrustCheckSignals');
        const probeEl = document.getElementById('recruitTrustCheckProbe');
        const clk = document.getElementById('recruitTrustCheckClock');
        if (!root || !sigEl || !probeEl) return;

        const raw = String(insight.content || '');
        const signalsText = raw.replace(/^ai[- ]?assist suspected:\s*/i, '').trim();
        const probe = String(insight.suggestedResponse || insight.suggested_response || '').trim();

        sigEl.textContent = signalsText || '(signals not specified)';
        probeEl.textContent = probe || '(no counter-probe suggested)';

        root.style.display = 'flex';
        root.classList.add('recruit-trust-check-flash');
        setTimeout(() => root.classList.remove('recruit-trust-check-flash'), 1500);

        // 60s auto-dismiss — trust checks need more dwell time than answer-assists
        if (_trustCheckAutoDismissId) clearTimeout(_trustCheckAutoDismissId);
        const expiresAtMs = Date.now() + 60_000;
        const tickClock = () => {
            if (root.style.display === 'none') return;
            const left = Math.max(0, Math.ceil((expiresAtMs - Date.now()) / 1000));
            if (clk) clk.textContent = left + 's';
            if (left > 0) setTimeout(tickClock, 1000);
            else dismissTrustCheck();
        };
        tickClock();
        _trustCheckAutoDismissId = setTimeout(dismissTrustCheck, 60_000);

        // Also flash a Toast so the host doesn't miss it even if focused elsewhere
        if (typeof Toast !== 'undefined' && Toast && Toast.warning) {
            Toast.warning('🛡️ Trust check — AI suspects the candidate may be using a tool. See verbal counter-probe.', 5000);
        }
    }

    function dismissTrustCheck() {
        const root = document.getElementById('recruitTrustCheck');
        if (root) root.style.display = 'none';
        if (_trustCheckAutoDismissId) { clearTimeout(_trustCheckAutoDismissId); _trustCheckAutoDismissId = null; }
    }
    window.dismissRecruitTrustCheck = dismissTrustCheck;

    function showAnswerAssist(insight) {
        const root = document.getElementById('recruitAnswerAssist');
        const qEl  = document.getElementById('recruitAnswerAssistQuestion');
        const bEl  = document.getElementById('recruitAnswerAssistBody');
        const clk  = document.getElementById('recruitAnswerAssistClock');
        if (!root || !qEl || !bEl) return;

        const raw = String(insight.content || '');
        const question = raw.replace(/^candidate asked:\s*/i, '').trim();
        const answer = String(insight.suggestedResponse || insight.suggested_response || '').trim();

        qEl.textContent = question || '(question not captured)';
        // Multi-line bullet answers come back as "• Point 1\n• Point 2" — render
        // each line as its own row. Plain prose renders as one paragraph.
        const lines = answer ? answer.split(/\n+/).map(s => s.trim()).filter(Boolean) : [];
        bEl.innerHTML = '';
        if (lines.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'recruit-answer-assist-empty';
            empty.textContent = '(AI did not provide an answer — defer to the hiring manager.)';
            bEl.appendChild(empty);
        } else {
            const list = document.createElement('div');
            list.className = 'recruit-answer-assist-bullets';
            lines.forEach(l => {
                const row = document.createElement('div');
                row.className = 'recruit-answer-assist-line';
                row.textContent = l.replace(/^[•\-\*]\s*/, '');
                list.appendChild(row);
            });
            bEl.appendChild(list);
        }

        root.style.display = 'flex';
        root.classList.add('recruit-answer-assist-flash');
        setTimeout(() => root.classList.remove('recruit-answer-assist-flash'), 1200);

        // Auto-dismiss after 45s — by then the interviewer has either used it
        // or moved on. Reset the countdown if a new answer-assist arrives.
        if (_answerAssistAutoDismissId) clearTimeout(_answerAssistAutoDismissId);
        const expiresAtMs = Date.now() + 45_000;
        const tickClock = () => {
            if (root.style.display === 'none') return;
            const left = Math.max(0, Math.ceil((expiresAtMs - Date.now()) / 1000));
            if (clk) clk.textContent = left + 's';
            if (left > 0) setTimeout(tickClock, 1000);
            else dismissAnswerAssist();
        };
        tickClock();
        _answerAssistAutoDismissId = setTimeout(dismissAnswerAssist, 45_000);
    }

    function dismissAnswerAssist() {
        const root = document.getElementById('recruitAnswerAssist');
        if (root) root.style.display = 'none';
        if (_answerAssistAutoDismissId) { clearTimeout(_answerAssistAutoDismissId); _answerAssistAutoDismissId = null; }
    }
    window.dismissRecruitAnswerAssist = dismissAnswerAssist;

    // ─── Pre-leave checklist (Tier 1) ─────────────────────────────────────
    // meeting.js's leaveMeeting should call window.recruitPreLeaveCheck()
    // before its Confirm.show. If it returns false, the leave is cancelled
    // so the recruiter can finish the must-asks first.
    window.recruitPreLeaveCheck = async function () {
        if (!isInterviewMode) return true;
        // Skip the checklist on early leaves (under 5 min) — likely an
        // accidental click or test session.
        if (_sessionStartMs && Date.now() - _sessionStartMs < 5 * 60_000) return true;

        return new Promise((resolve) => {
            const items = [
                { id: 'comp',     label: 'Asked about salary / comp expectations' },
                { id: 'notice',   label: 'Asked about notice period / availability' },
                { id: 'cand_qs',  label: 'Gave candidate time to ask their questions' },
                { id: 'nextStep', label: 'Told candidate the next step / timeline' }
            ];
            const overlay = document.createElement('div');
            overlay.className = 'recruit-preleave-overlay';
            overlay.innerHTML = ''
                + '<div class="recruit-preleave-modal" role="dialog" aria-modal="true">'
                +   '<div class="recruit-preleave-header">Before you leave the interview</div>'
                +   '<div class="recruit-preleave-hint">Quick sanity check — confirm you covered the mandatory wrap-up items. Skip if you genuinely don\'t need them.</div>'
                +   '<div class="recruit-preleave-list">'
                +     items.map(i => `
                        <label class="recruit-preleave-row">
                            <input type="checkbox" data-pre-id="${i.id}">
                            <span>${escapeHtml(i.label)}</span>
                        </label>
                      `).join('')
                +   '</div>'
                +   '<div class="recruit-preleave-actions">'
                +     '<button type="button" class="rec-btn rec-btn-sm" data-pre-action="cancel">Stay in meeting</button>'
                +     '<button type="button" class="rec-btn rec-btn-sm" data-pre-action="skip">Skip and leave</button>'
                +     '<button type="button" class="rec-btn rec-btn-sm rec-btn-primary" data-pre-action="confirm" disabled>Confirm + leave</button>'
                +   '</div>'
                + '</div>';
            document.body.appendChild(overlay);

            const allCheckboxes = overlay.querySelectorAll('input[type="checkbox"]');
            const confirmBtn = overlay.querySelector('[data-pre-action="confirm"]');
            allCheckboxes.forEach(cb => cb.addEventListener('change', () => {
                const allChecked = Array.from(allCheckboxes).every(c => c.checked);
                confirmBtn.disabled = !allChecked;
            }));

            overlay.addEventListener('click', (e) => {
                const action = e.target?.getAttribute?.('data-pre-action');
                if (!action) return;
                if (action === 'cancel')        { cleanup(); resolve(false); }
                else if (action === 'skip')     { cleanup(); resolve(true); }
                else if (action === 'confirm')  { cleanup(); resolve(true); }
            });

            function cleanup() {
                if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
            }
        });
    };

    // ─── Keyboard shortcuts (Tier 1) ──────────────────────────────────────
    // U = copy + flash top question (USE), S = skip top question,
    // 1/2/3 = focus card N, ? = show help.
    document.addEventListener('keydown', function (e) {
        if (!isInterviewMode) return;
        // Don't hijack typing in inputs/textareas/contenteditable
        const t = e.target;
        if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
        // Don't fire if modifier is held — those are app/OS shortcuts
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        const key = e.key.toLowerCase();
        if (key === 'u') {
            e.preventDefault();
            if (askNextQueue.length > 0) useRecruitNextQuestion(0);
        } else if (key === 's') {
            e.preventDefault();
            if (askNextQueue.length > 0) skipRecruitNextQuestion(0);
        } else if (key === '1' || key === '2' || key === '3') {
            const idx = parseInt(key, 10) - 1;
            if (askNextQueue[idx]) { e.preventDefault(); useRecruitNextQuestion(idx); }
        } else if (key === '?' || (e.shiftKey && key === '/')) {
            e.preventDefault();
            showShortcutHelp();
        } else if (key === 'escape') {
            // Escape hatch: if the panel got dragged into an unreachable
            // corner (behind a nav bar, off-screen on a resized window, etc.)
            // ESC resets it to the default top-left anchored position. Same
            // effect as double-clicking the header, but works even when the
            // header itself is hidden.
            const panel = document.getElementById('recruitHudSections');
            if (panel && panel.classList.contains('recruit-hud-floating-user-positioned')) {
                e.preventDefault();
                try { localStorage.removeItem(POS_STORAGE_KEY); } catch (_e) {}
                panel.classList.remove('recruit-hud-floating-user-positioned');
                panel.style.position = '';
                panel.style.top = '';
                panel.style.left = '';
                panel.style.right = '';
                panel.style.bottom = '';
                panel.style.width = '';
                panel.style.height = '';
                if (typeof Toast !== 'undefined' && Toast && Toast.info) {
                    Toast.info('Cockpit position reset to top-left.', 3000);
                }
            }
        }
    });

    function showShortcutHelp() {
        const existing = document.getElementById('recruitShortcutHelp');
        if (existing) { existing.remove(); return; }
        const ov = document.createElement('div');
        ov.id = 'recruitShortcutHelp';
        ov.className = 'recruit-shortcut-help';
        ov.innerHTML = ''
            + '<div class="recruit-shortcut-help-card">'
            +   '<div class="recruit-shortcut-help-title">Recruit cockpit shortcuts</div>'
            +   '<div class="recruit-shortcut-help-grid">'
            +     '<kbd>U</kbd><span>Copy top question to clipboard</span>'
            +     '<kbd>S</kbd><span>Skip top question</span>'
            +     '<kbd>1</kbd><kbd>2</kbd><kbd>3</kbd><span>Copy question 1 / 2 / 3</span>'
            +     '<kbd>Esc</kbd><span>Reset cockpit position (rescue from off-screen drag)</span>'
            +     '<kbd>?</kbd><span>Toggle this help</span>'
            +   '</div>'
            +   '<button type="button" class="rec-btn rec-btn-sm" onclick="document.getElementById(\'recruitShortcutHelp\').remove();">Close</button>'
            + '</div>';
        document.body.appendChild(ov);
    }

    // Boot session meter the first time the HUD is initialised in interview mode
    const _originalInit = initRecruitHud;
    initRecruitHud = function (connection, meetingMode, meetingIdParam) {
        _originalInit(connection, meetingMode, meetingIdParam);
        if ((meetingMode || '').toLowerCase() === 'interview' || (meetingMode || '').toLowerCase() === 'recruit') {
            startSessionMeter();
        }
    };

    // ─── Exports ─────────────────────────────────────────────────────────
    window.initRecruitHud = initRecruitHud;
    window.toggleRecruitJargonTray = toggleRecruitJargonTray;
    window.toggleRecruitScorecard = toggleRecruitScorecard;
    window.useRecruitNextQuestion = useRecruitNextQuestion;
    window.skipRecruitNextQuestion = skipRecruitNextQuestion;
    window.overrideRecruitScorecard = overrideRecruitScorecard;
    window.showRecruitReportModal = showRecruitReportModal;
})();
