/* ============================================================
 * recruit-thread.js — v7 interview cockpit (Q-Block thread)
 *
 * Replaces the v6 ASK NEXT / LAST ANSWER / JARGON / SCORECARD
 * sections with a conversation-thread layout: one host-pinned
 * question = one Q-Block; the candidate's answer + grade + jargon
 * + scorecard signals nest UNDER the block. Click "Done" to
 * close the block; AI emits 3 next-question candidates (easy /
 * medium / hard); host picks one to open the next block.
 *
 * Initialized by recruit-hud.js after its own DOM injection.
 * Takes over #recruitHudFloatingBody contents — the cockpit
 * chrome (drag, resize, maximize, opacity) stays unchanged.
 * ============================================================ */
(function () {
    'use strict';

    if (window.__recruitThreadLoaded) return;
    window.__recruitThreadLoaded = true;

    // ─── State ────────────────────────────────────────────────
    let signalR = null;
    let meetingId = null;
    let initialized = false;

    // One Q-Block per host-pinned (or auto-detected) question.
    // Order is newest-at-bottom — completed blocks scroll up, the
    // active block is always at the bottom of the thread (with
    // optional follow-up nested under it).
    const blocks = [];                  // each: { id, parentId, questionText, topic, difficulty, askedAtMs, status, quality, jargon, deltas, answerSummary, autoDetected }
    let activeBlockId = null;
    let pendingHostDetections = [];     // host-detected blocks waiting for Confirm/Dismiss

    // Picker state — populated when AI sends V7NextQuestionOptions.
    let pickerOptions = null;           // { topicHint, options: [{question, why, topic, difficulty}] }
    let pickerVisible = false;
    let pickerPending = false;          // true after Done clicked, until options arrive — drives "asking AI for next…" placeholder

    // Topic state machine — driven by CopilotInsight.topicLabel /
    // topicExhausted / followUpDepth. Used to enforce the 3-follow-up cap
    // (picker filters out exhausted topics) and to render an accurate
    // topics-done counter (distinct topic labels touched, not scorecard
    // deltas which can be ~3 per turn).
    const exhaustedTopics = new Set();   // lowercase topic labels marked exhausted
    const touchedTopics = new Set();     // lowercase topic labels with any engagement

    // Trust check state — populated on V7TrustCheck. Floating banner.
    let trustCheck = null;              // { reason, coaching, confidence, dismissedAtMs }

    // Drift / coaching alert state — populated when AIEngine emits a key_moment
    // CopilotInsight whose content starts with "DRIFT ALERT" or similar
    // coaching prefixes. Surfaces as a dismissable banner above the picker.
    let coachAlert = null;              // { kind, content, at, dismissedAt }

    // Round metadata for the budget header.
    let roundMeta = {
        roundType: '',
        roundLabel: '',
        budgetMins: 15,
        startedAtMs: 0
    };

    // Talk balance — wire later (existing recruit-hud talkBalance signals).
    let talkSplit = { you: 0, candidate: 0 };

    // Scorecard rollup — competency -> { signal, evidenceQuote }
    const scorecard = new Map();

    // ─── Init (called by recruit-hud.js) ──────────────────────
    function initRecruitThread(connection, meetingIdParam) {
        // Re-init on every call: the harness (and a real End → Start in
        // Vision) tears down + rebuilds the cockpit mount DOM, so the
        // previous rtThread/rtPicker/rtTrust elements are gone. If we
        // early-return here the new mount is left empty.
        const isReinit = initialized;
        signalR = connection;
        meetingId = meetingIdParam;
        // Reset state — same module, fresh session.
        if (isReinit) {
            blocks.length = 0;
            pendingHostDetections = [];
            activeBlockId = null;
            pickerOptions = null;
            pickerPending = false;
            trustCheck = null;
            coachAlert = null;
            scorecard.clear();
            exhaustedTopics.clear();
            touchedTopics.clear();
        }
        document.body.classList.add('recruit-v7-mode');
        replaceBody();
        wireSignalR();
        initialized = true;
        console.log('[RecruitThread] v7 initialized for meeting', meetingId, isReinit ? '(re-init)' : '');
    }
    window.initRecruitThread = initRecruitThread;

    // Called by the harness (and in prod by the STT end-of-utterance detector)
    // when the candidate has just finished answering. Stamps the active Q-Block
    // with the candidate-done timestamp so the grade-latency badge can show
    // "⚡ graded 3.4s after candidate finished" when the V7QuestionGrade
    // event lands. No-op if no active block.
    window.recruitMarkCandidateAnswered = function () {
        const block = blocks.find(b => b.id === activeBlockId);
        if (!block) return;
        block.candidateSentMs = Date.now();
        // Reset any prior grade-latency so a re-graded turn shows fresh timing.
        delete block.gradeArrivedMs;
        delete block.gradeLatencyMs;
    };

    // ─── DOM ──────────────────────────────────────────────────
    function replaceBody() {
        const body = document.getElementById('recruitHudFloatingBody');
        if (!body) {
            console.warn('[RecruitThread] #recruitHudFloatingBody missing — cannot mount');
            return;
        }
        body.classList.add('rt-body');
        body.innerHTML =
            '<div class="rt-budget" id="rtBudget">' +
            '  <span class="rt-budget-pill" id="rtBudgetRound">—</span>' +
            '  <span class="rt-budget-pill"><span class="rt-lbl">⏱</span> <strong id="rtElapsed">0:00</strong>/<span id="rtTotal">15:00</span></span>' +
            '  <span class="rt-budget-pill"><span class="rt-lbl">📚</span> TOPICS <strong id="rtTopicsDone">0</strong>/<span id="rtTopicsTotal">0</span></span>' +
            '  <span class="rt-budget-pill"><span class="rt-lbl">🗣</span> TALK <span class="rt-talkbar" id="rtTalkBar"><span class="you"></span><span class="cand"></span></span> <span id="rtTalkText" class="rt-talk-text">—</span></span>' +
            '</div>' +
            // Chip groups share .copilot-mode-btn / .copilot-freq-btn /
            // .copilot-model-btn class names so the existing
            // updateModeToggleUI / updateFreqToggleUI / updateModelToggleUI
            // functions in copilot.js auto-sync the active state on both
            // the legacy panel (now hidden) and these v7 chips. Inline
            // onclick targets the same global handlers — no new wiring.
            '<div class="rt-controls" id="rtControls">' +
            '  <div class="rt-ctrl-group">' +
            '    <span class="rt-ctrl-lbl">MODE</span>' +
            '    <button class="copilot-mode-btn active" data-mode="manual" onclick="setCopilotMode(\'manual\')" title="Read insights only">MANUAL</button>' +
            '    <button class="copilot-mode-btn" data-mode="earpiece" onclick="setCopilotMode(\'earpiece\')" title="TTS whisper of suggestions">EARPIECE</button>' +
            '    <button class="copilot-mode-btn" data-mode="autonomous" onclick="setCopilotMode(\'autonomous\')" title="AI speaks to candidate">AUTO</button>' +
            '  </div>' +
            '  <div class="rt-ctrl-group">' +
            '    <span class="rt-ctrl-lbl">SPEED</span>' +
            '    <button class="copilot-freq-btn" data-freq="fast" onclick="setCopilotFrequency(\'fast\')" title="2s cooldown — more insights">FAST</button>' +
            '    <button class="copilot-freq-btn active" data-freq="normal" onclick="setCopilotFrequency(\'normal\')" title="4s cooldown — balanced">NORMAL</button>' +
            '    <button class="copilot-freq-btn" data-freq="chill" onclick="setCopilotFrequency(\'chill\')" title="8s cooldown — minimal">CHILL</button>' +
            '  </div>' +
            '  <div class="rt-ctrl-group">' +
            '    <span class="rt-ctrl-lbl">MODEL</span>' +
            '    <button class="copilot-model-btn" data-model="haiku" onclick="setCopilotModel(\'haiku\')" title="Haiku — fast, cheap (may miss nuance on detailed prompts)">HAIKU</button>' +
            '    <button class="copilot-model-btn active" data-model="sonnet" onclick="setCopilotModel(\'sonnet\')" title="Sonnet — default, recommended for interviews (better follow-up + drift detection)">SONNET</button>' +
            '  </div>' +
            '</div>' +
            '<div class="rt-trust" id="rtTrust" style="display:none;"></div>' +
            '<div class="rt-thread" id="rtThread">' +
            '  <div class="rt-empty" id="rtEmpty">Waiting for the first question. The AI will suggest 3 options when ready — pick one and ask the candidate.</div>' +
            '</div>' +
            // Scorecard is COLLAPSED by default (▸) — host opens it
            // when they want to check competency coverage. Reduces vertical
            // weight in the cockpit so picker + active block stay above
            // the fold.
            '<div class="rt-scorecard" id="rtScorecard" style="display:none;">' +
            '  <div class="rt-lbl-bar">SCORECARD <span class="rt-toggle" id="rtScToggle">▸</span></div>' +
            '  <div class="rt-sc-list" id="rtScList" style="display:none;"></div>' +
            '</div>' +
            '<div class="rt-picker" id="rtPicker" style="display:none;"></div>';
        const scToggle = document.getElementById('rtScToggle');
        if (scToggle) scToggle.addEventListener('click', () => {
            const list = document.getElementById('rtScList');
            const open = list.style.display !== 'none';
            list.style.display = open ? 'none' : '';
            scToggle.textContent = open ? '▸' : '▾';
        });

        startElapsedTicker();
    }

    function startElapsedTicker() {
        roundMeta.startedAtMs = Date.now();
        setInterval(() => {
            const el = document.getElementById('rtElapsed');
            if (!el) return;
            const sec = Math.floor((Date.now() - roundMeta.startedAtMs) / 1000);
            const m = Math.floor(sec / 60);
            const s = sec % 60;
            el.textContent = `${m}:${s.toString().padStart(2, '0')}`;
        }, 1000);
    }

    // ─── SignalR wiring ───────────────────────────────────────
    function wireSignalR() {
        if (!signalR) return;

        // v7 events from Phase 0+1 backend
        signalR.on('V7NextQuestionOptions', onNextQuestionOptions);
        signalR.on('V7HostQuestionDetected', onHostQuestionDetected);
        signalR.on('V7TrustCheck', onTrustCheck);
        signalR.on('V7QuestionGrade', onQuestionGrade);
        signalR.on('V7FollowupSuggested', onFollowupSuggested);
        signalR.on('V7TopicState', onTopicState);

        // Existing v6 signals — still fire for question-scoped grading
        // until the backend starts emitting V7QuestionGrade. We treat the
        // single-payload CopilotInsight HUD signals as updates to the
        // currently-active block.
        signalR.on('InterviewQuestionsUpdated', onLegacyQuestionsUpdated);
        signalR.on('AnswerQuality', onLegacyAnswerQuality);
        signalR.on('JargonDetected', onLegacyJargon);
        signalR.on('ScorecardUpdate', onLegacyScorecard);
        signalR.on('InterviewContextLoaded', onContextLoaded);
        // Drift / coaching key_moments arrive in the generic CopilotInsight
        // stream — recruit-thread surfaces only the ones whose content reads
        // as a coaching alert (DRIFT, OFF-TOPIC, PACE, ROUND MISMATCH, etc.).
        signalR.on('CopilotInsight', onCopilotInsight);

        // Re-sync active Q-Block on SignalR reconnect. AIEngine keeps a
        // session-scoped activeQuestionId; if the connection drops while a
        // question is pinned, the AIEngine session retains the OLD id but
        // a NEW gRPC session may be spun up on the next call — either way
        // re-emitting ActiveQuestionChanged on every reconnect keeps the
        // backend in sync with what the host actually has pinned in the UI.
        if (typeof signalR.onreconnected === 'function') {
            signalR.onreconnected(() => {
                console.log('[RecruitThread] SignalR reconnected — re-syncing active Q-Block + context');
                // Ask the bot to re-emit InterviewContextLoaded. The context is
                // broadcast only once at bot startup, so without this the candidate
                // bar + cached rubric stay blank for the rest of the interview after
                // a tab refresh / reconnect. Host-verified server-side.
                try { if (meetingId) signalR.invoke('RequestInterviewContext', String(meetingId)); } catch (e) {}
                const cur = blocks.find(b => b.id === activeBlockId);
                if (cur && cur.status !== 'done') {
                    emitActiveQuestion(cur);
                }
            });
        }
    }

    function onTopicState(data) {
        // V7 dedicated event — Vision fans out topic_state independently
        // because the CopilotInsight carrier is dropped when type=no_action_needed
        // (the common quiet-turn case after the speed-pass gating).
        if (!data) return;
        const tlRaw = (data.topicLabel || '').trim();
        if (!tlRaw) return;
        const tl = tlRaw.toLowerCase();
        touchedTopics.add(tl);
        if (data.topicExhausted === true || data.topicExhausted === 'true') {
            exhaustedTopics.add(tl);
        }
        renderScorecard();
        renderPicker();
    }

    function onCopilotInsight(data) {
        if (!data) return;
        if (data.type !== 'key_moment') return;
        const content = String(data.content || '');
        // Match coaching prefixes the AI emits at the start of a key_moment.
        // Narrow enough that ordinary key_moments don't trigger a banner.
        //
        // NOTE: round-type mismatch alerts are intentionally NOT surfaced.
        // A single Ragenaizer interview compresses multiple phases (HR +
        // technical + CEO + negotiation) into one call, so a "you're asking
        // a technical Q in an HR round" warning is noise. The AI prompt
        // tells the model not to emit these, but we filter here as belt+
        // suspenders.
        //
        // AI-ASSIST SUSPECTED and CANDIDATE ASKED are also surfaced — these
        // are the trust-check and answer-assist signals the AI emits as
        // `key_moment` insights. They need a banner so the host doesn't
        // miss them while looking at the active Q-Block.
        const m = content.match(/^(DRIFT(?:\s+ALERT)?|OFF[-\s]TOPIC|PACE\s+ALERT|TIME\s+ALERT|AI[-\s]ASSIST\s+SUSPECTED|CANDIDATE\s+ASKED|FORM[_\s]VS[_\s]REALITY|UNREALISTIC[_\s]COMP)/i);
        if (!m) return;
        coachAlert = {
            kind: m[1].toUpperCase().replace(/\s+/g, '_'),
            content: content,
            at: Date.now(),
            dismissedAt: 0
        };
        renderCoachAlert();
    }

    function dismissCoachAlert() {
        if (coachAlert) coachAlert.dismissedAt = Date.now();
        renderCoachAlert();
    }

    function renderCoachAlert() {
        let el = document.getElementById('rtCoachAlert');
        const mount = document.getElementById('rtThread')?.parentElement;
        if (!mount) return;
        if (!coachAlert || coachAlert.dismissedAt) {
            if (el) el.remove();
            return;
        }
        if (!el) {
            el = document.createElement('div');
            el.id = 'rtCoachAlert';
            el.className = 'rt-coach-alert';
            const thread = document.getElementById('rtThread');
            mount.insertBefore(el, thread);
        }
        // Strip the redundant prefix from the message body — the kind chip
        // already shows it. E.g. content "DRIFT ALERT: candidate ignored..."
        // → message "candidate ignored...". Matches the same regex used in
        // onCopilotInsight so any newly-added prefix stays in sync.
        const msgBody = String(coachAlert.content || '')
            .replace(/^(DRIFT(?:\s+ALERT)?|OFF[-\s]TOPIC|PACE\s+ALERT|TIME\s+ALERT|AI[-\s]ASSIST\s+SUSPECTED|CANDIDATE\s+ASKED|FORM[_\s]VS[_\s]REALITY|UNREALISTIC[_\s]COMP)\s*[:\-—]\s*/i, '')
            .trim();
        el.innerHTML =
            '<span class="rt-coach-kind">' + escape(coachAlert.kind.replace(/_/g, ' ')) + '</span>' +
            '<span class="rt-coach-msg">' + escape(msgBody) + '</span>' +
            '<button class="rt-coach-x" data-action="dismiss-coach" title="Dismiss">×</button>';
    }

    function onContextLoaded(data) {
        // Round type + budget come from HRMS via Phase 1 InterviewContextLoaded.
        if (!data) return;
        // Ignore context for a DIFFERENT meeting — InterviewContextLoaded arrives
        // via Clients.User(hostUserId) (all of this user's connections), so a
        // second concurrent interview tab would otherwise overwrite this thread's
        // round metadata with the other candidate's.
        if (data.meetingId && String(data.meetingId) !== String(meetingId)) return;
        roundMeta.roundType = data.roundType || '';
        roundMeta.roundLabel = data.roundLabel || data.roundType || '';
        const total = roundBudgetMins(data.roundType);
        roundMeta.budgetMins = total;
        const tEl = document.getElementById('rtTotal');
        if (tEl) tEl.textContent = total + ':00';
        const rEl = document.getElementById('rtBudgetRound');
        if (rEl) rEl.textContent = (data.roundLabel || data.roundType || 'INTERVIEW').toUpperCase();
        const tdEl = document.getElementById('rtTopicsTotal');
        // Vision sends `topicsSeededJson` as a serialized JSON string, NOT
        // an array. Earlier code expected `topicsSeeded` (array) so the
        // counter stuck at 0. Try both: direct array first (in case any
        // path supplies it), then parse the JSON string. Fall back to 0.
        let topics = 0;
        if (Array.isArray(data.topicsSeeded)) {
            topics = data.topicsSeeded.length;
        } else if (typeof data.topicsSeededJson === 'string' && data.topicsSeededJson.trim()) {
            try {
                const parsed = JSON.parse(data.topicsSeededJson);
                if (Array.isArray(parsed)) topics = parsed.length;
            } catch (_e) {
                // Ignore parse errors — counter just stays at 0.
            }
        }
        if (tdEl) tdEl.textContent = topics;
    }

    function roundBudgetMins(roundType) {
        switch ((roundType || '').toLowerCase()) {
            case 'hr_screen':       return 15;
            case 'technical_round': return 45;
            case 'technical_panel': return 60;
            case 'hiring_manager':  return 30;
            case 'ceo':             return 20;
            case 'final':           return 30;
            default:                return 30;
        }
    }

    // ─── v7 signal handlers ───────────────────────────────────
    function onNextQuestionOptions(data) {
        if (!data) return;
        pickerOptions = {
            topicHint: data.topicHint || '',
            options: Array.isArray(data.options) ? data.options : []
        };
        pickerPending = false;
        renderPicker();
        renderThread();
    }

    function onHostQuestionDetected(data) {
        if (!data) return;
        // Whitespace-only counts as empty — a 3-space "question" is not
        // host-actionable and would render a blank Q-Block.
        const trimmed = (data.questionText || '').trim();
        if (!trimmed) return;
        // Suppress entirely when classification is "follow_up" or "clarification"
        // AND there's an active Q-Block. Those classifications mean the host is
        // RE-STATING the active question (e.g. they pinned the AI-suggested
        // follow-up then spoke it out loud). Creating a new block would create
        // a confusing Q1.1.1 duplicate of Q1.1. The exact-text dedup below also
        // covers identical text, but follow_up classification often comes with
        // paraphrased text that still semantically maps to the active block.
        const cls = (data.classification || '').toLowerCase();
        if ((cls === 'follow_up' || cls === 'clarification') && activeBlockId) {
            return;
        }
        // Dedup against pending detections AND against existing blocks — if the
        // host re-says a question that was already pinned (via picker or earlier
        // detection), don't re-prompt for confirmation.
        const dupePending = pendingHostDetections.find(d => d.questionText.trim().toLowerCase() === trimmed.toLowerCase());
        if (dupePending) return;
        const dupeBlock = blocks.find(b => (b.questionText || '').trim().toLowerCase() === trimmed.toLowerCase());
        if (dupeBlock) return;
        // Fuzzy dedup against ALL existing blocks (not just active). The AI
        // sees the host's prior question in every subsequent transcript
        // window, so it can re-emit host_question_detected for the SAME
        // question on each turn — leading to Q2, Q3, Q4 all duplicating
        // each other. Exact-text dedup above misses contractions ("What's"
        // vs "What is") and minor STT rewording. 0.7 Jaccard threshold is
        // tight enough that genuinely-new questions still create new blocks.
        const wordsHost = new Set(trimmed.toLowerCase().match(/\b[a-z]{3,}\b/g) || []);
        if (wordsHost.size > 0) {
            const dupeFuzzy = blocks.find(b => {
                const wordsB = new Set((b.questionText || '').toLowerCase().match(/\b[a-z]{3,}\b/g) || []);
                if (wordsB.size === 0) return false;
                let intersect = 0;
                wordsHost.forEach(w => { if (wordsB.has(w)) intersect++; });
                const union = wordsHost.size + wordsB.size - intersect;
                return union > 0 && (intersect / union) >= 0.7;
            });
            if (dupeFuzzy) return;
        }
        // Real-world flow: host READS OUT a picker suggestion (no click). If
        // the spoken text matches any current picker option closely, silently
        // pin THAT picker option (preserving topic + difficulty metadata)
        // instead of creating a generic auto-detected block with classification
        // metadata only. Threshold 0.55 — picker text is conversational so word
        // overlap can be 50-60% even on a verbatim read after STT noise.
        if (pickerOptions && Array.isArray(pickerOptions.options) && pickerOptions.options.length > 0) {
            const wordsA = new Set(trimmed.toLowerCase().match(/\b[a-z]{3,}\b/g) || []);
            let bestIdx = -1, bestScore = 0;
            pickerOptions.options.forEach((o, i) => {
                const wordsB = new Set(((o && o.question) || '').toLowerCase().match(/\b[a-z]{3,}\b/g) || []);
                let intersect = 0;
                wordsA.forEach(w => { if (wordsB.has(w)) intersect++; });
                const union = wordsA.size + wordsB.size - intersect;
                const jaccard = union > 0 ? intersect / union : 0;
                if (jaccard > bestScore) { bestScore = jaccard; bestIdx = i; }
            });
            if (bestIdx >= 0 && bestScore >= 0.55) {
                // Silent pin — use the picker option's metadata (topic,
                // difficulty) instead of the AI's auto-detect guesses, and
                // replace its questionText with what the host actually said
                // so the Q-Block reflects the recruiter's wording.
                const picked = pickerOptions.options[bestIdx];
                const opt = { ...picked, question: trimmed };
                pickerOptions.options[bestIdx] = opt;
                pickOption(bestIdx);
                return;
            }
        }
        // Fuzzy dedup: if the host's spoken text is ≥50% word-overlap with the
        // currently-active pinned block AND that block hasn't been graded yet,
        // assume the host is re-speaking the pinned question in their own words
        // (e.g. picker said "what drew you to apply" → host said "what attracted
        // you to"). Don't create a duplicate Q-Block. Replace the block's text
        // with the host's actual phrasing so the answer summary uses the real
        // question wording.
        if (activeBlockId) {
            const active = blocks.find(b => b.id === activeBlockId);
            if (active && !active.quality && !active.answerSummary) {
                const wordsA = new Set(trimmed.toLowerCase().match(/\b[a-z]{3,}\b/g) || []);
                const wordsB = new Set((active.questionText || '').toLowerCase().match(/\b[a-z]{3,}\b/g) || []);
                let intersect = 0;
                wordsA.forEach(w => { if (wordsB.has(w)) intersect++; });
                const union = wordsA.size + wordsB.size - intersect;
                const jaccard = union > 0 ? intersect / union : 0;
                if (jaccard >= 0.5) {
                    active.questionText = trimmed;
                    renderThread();
                    return;
                }
            }
        }
        const detection = {
            id: 'host-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
            questionText: trimmed,
            classification: data.classification || 'new_topic',
            parentQuestionIdHint: data.parentQuestionIdHint || '',
            topic: data.topic || 'auto-detected',
            confidence: data.confidence || 0.7,
            timestamp: data.timestamp || Date.now()
        };
        pendingHostDetections.push(detection);
        renderThread();

        // Auto-confirm high-confidence detections (≥ 0.9). The CONFIRM & ASK
        // card was a safety prompt for low/medium-confidence picks; at 0.9+
        // the AI is reliably picking up real host questions and waiting for
        // a manual click introduces a race where the candidate's reply gets
        // graded against the now-stale active Q-Block. Auto-confirm flips
        // the active block immediately so downstream grading attaches to
        // the right question.
        if (detection.confidence >= 0.9) {
            confirmDetected(detection.id);
        }
    }

    function onTrustCheck(data) {
        if (!data) return;
        trustCheck = {
            reason: data.reason || '',
            coaching: data.coaching || '',
            confidence: data.confidence || 0,
            timestamp: data.timestamp || Date.now()
        };
        renderTrustCheck();
    }

    function onQuestionGrade(data) {
        // v7 explicit question_id tagging. AIEngine snapshots the active
        // question id at the start of each insights call, so this grade
        // is always tagged with the question the candidate was answering
        // when grading STARTED — even if the host has since pivoted.
        if (!data || !data.questionId) return;
        const block = blocks.find(b => b.id === data.questionId);
        if (!block) return;
        // Stale-grade guard: if the block was marked DONE >30s ago, drop the
        // grade — the host has moved on and a late grade on a closed Q-Block
        // confuses the thread. Measure from doneAtMs (when DONE was clicked), NOT
        // askedAtMs: askedAtMs is stamped once at block creation, so a candidate
        // whose answer ran >30s before DONE would have their in-flight grade
        // wrongly dropped — the block would stay permanently ungraded, exactly for
        // the long deep-dive answers that matter most. If doneAtMs is somehow
        // absent, do NOT drop (better a slightly-late grade than a lost one).
        if (block.status === 'done' && block.doneAtMs && (Date.now() - block.doneAtMs) > 30000) {
            console.warn('[RecruitThread] Dropping stale grade for done block', data.questionId,
                'age=', Date.now() - block.doneAtMs, 'ms');
            return;
        }
        if (data.qualityColor) block.quality = { color: data.qualityColor, reason: data.qualityReason || '', confidence: data.qualityConfidence || 0 };
        if (data.answerSummary) block.answerSummary = data.answerSummary;
        (data.jargon || []).forEach(j => addJargonToBlock(block, j));
        (data.deltas || []).forEach(d => {
            addDeltaToBlock(block, d);  // per-block visibility
            applyScorecardDelta(d);     // also bubble up to aggregate rollup
        });
        // Latency badge: only stamp when this is a real grade (green/amber/red),
        // not a "skip" verdict (which means AI declined to grade — badge would
        // be misleading). Cap at 90s to suppress badges when the host actually
        // left the mic dead for over a minute — Sonnet taking ~25s plus in-flight
        // queueing under rapid candidate turns can push real latency past 30s,
        // so the prior 25s cap was hiding legitimate measurements.
        const isRealGrade = data.qualityColor && data.qualityColor !== 'skip';
        if (block.candidateSentMs && !block.gradeLatencyMs && isRealGrade) {
            const ageMs = Date.now() - block.candidateSentMs;
            if (ageMs <= 90000) {
                block.gradeArrivedMs = Date.now();
                block.gradeLatencyMs = ageMs;
            }
        }
        // If a corrective "skip" arrives, mark the block as skipped (not
        // nulled). Nulling destroys state the picker depends on — when the
        // candidate deflects ('skip'), the host needs the picker MORE than
        // ever to redirect, and renderPicker's hasResolution check reads
        // block.quality.color. Renderers that show a colored chip should
        // already treat 'skip' as "no colored chip" (it's not green/amber/red).
        if (data.qualityColor === 'skip') {
            block.quality = { color: 'skip', reason: data.qualityReason || '', confidence: 0 };
            delete block.gradeLatencyMs;
            delete block.gradeArrivedMs;
        }
        renderThread();
        renderScorecard();
    }

    function onFollowupSuggested(data) {
        if (!data || !data.parentQuestionId) return;
        const parent = blocks.find(b => b.id === data.parentQuestionId);
        if (!parent) return;
        // Clear any pending "manual follow-up" spinner — the response
        // is here. Empty question means AI returned null (rare); show
        // a toast-style hint instead of an empty card.
        parent.manualFollowupPending = false;
        if (!data.question) {
            renderThread();
            if (window.Toast && data.reason) {
                try { Toast.info(data.reason); } catch (_e) {}
            }
            return;
        }
        // Stamp how long the suggestion took. Two clocks: from candidate-done
        // (matches the grade-latency badge's anchor for natural reading) and
        // from manual-trigger if the host clicked "Ask AI for follow-up". The
        // manual path resets candidateSentMs to the click time elsewhere, so
        // we can reuse the same field.
        let suggestLatencyMs = null;
        if (parent.candidateSentMs) {
            const ageMs = Date.now() - parent.candidateSentMs;
            if (ageMs > 0 && ageMs <= 90000) suggestLatencyMs = ageMs;
        }
        parent.followupSuggestion = {
            question: data.question,
            why: data.why || '',
            topic: data.topic || parent.topic,
            difficulty: data.difficulty || 'medium',
            reason: data.reason || '',
            latencyMs: suggestLatencyMs
        };
        renderThread();
    }

    // ─── Legacy CopilotInsight signal handlers ────────────────
    // These fire on every per-turn Claude call today. They carry HUD
    // signals (next_questions / answer_quality / jargon / scorecard
    // deltas) but DON'T tag with question_id — so we attribute them
    // to whichever Q-Block is currently active.
    function onLegacyQuestionsUpdated(data) {
        // If we don't have explicit picker options yet AND there's no
        // active question, treat the next_questions stack as our picker.
        if (pickerOptions) return; // v7 explicit options take precedence
        if (activeBlockId) return; // mid-question — don't pop picker
        if (!data || !Array.isArray(data.questions) || data.questions.length === 0) return;
        // Normalize: ensure each option has a difficulty hint. The v6 schema
        // emits difficulty per question but rarely all three tiers — best
        // effort: pad with medium.
        const opts = data.questions.slice(0, 3).map(q => ({
            question: q.question,
            why: q.why || '',
            topic: q.topic || '',
            difficulty: (q.difficulty || 'medium').toLowerCase()
        }));
        pickerOptions = { topicHint: '', options: opts };
        renderPicker();
        // Picker now has content — empty-state placeholder should hide.
        renderThread();
    }

    function onLegacyAnswerQuality(data) {
        if (!activeBlockId || !data) return;
        const block = blocks.find(b => b.id === activeBlockId);
        if (!block) return;
        if (data.color && data.color !== 'skip') {
            block.quality = {
                color: data.color,
                reason: data.reason || '',
                confidence: data.confidence || 0
            };
            renderThread();
        }
    }

    function onLegacyJargon(data) {
        if (!activeBlockId || !data || !Array.isArray(data.terms)) return;
        const block = blocks.find(b => b.id === activeBlockId);
        if (!block) return;
        data.terms.forEach(t => addJargonToBlock(block, t));
        renderThread();
    }

    function onLegacyScorecard(data) {
        if (!data || !Array.isArray(data.deltas)) return;
        // Per-block attribution: when there's an active question, attach
        // these deltas to it so the host sees "this answer scored X" in
        // the block itself, not just in the rollup. When no active block
        // (between questions), the rollup still updates.
        const active = activeBlockId ? blocks.find(b => b.id === activeBlockId) : null;
        data.deltas.forEach(d => {
            if (active) addDeltaToBlock(active, d);
            applyScorecardDelta(d);
        });
        renderThread();
        renderScorecard();
    }

    // ─── Mutators ─────────────────────────────────────────────
    function addJargonToBlock(block, j) {
        if (!j || !j.term) return;
        block.jargon = block.jargon || [];
        const key = j.term.trim().toLowerCase();
        if (block.jargon.some(x => (x.term || '').trim().toLowerCase() === key)) return;
        block.jargon.push({ term: j.term, definition: j.definition || '' });
    }

    function addDeltaToBlock(block, d) {
        if (!d || !d.competency || !d.signal) return;
        const validSignals = { not_yet: 0, partial: 1, demonstrated: 2 };
        if (!(d.signal in validSignals)) return;
        block.deltas = block.deltas || [];
        const key = d.competency.trim().toLowerCase();
        // Same-block dedup with promotion-only semantics: a delta arriving
        // later in the same answer can promote (partial → demonstrated)
        // but never demote.
        const existing = block.deltas.find(x => (x.competency || '').trim().toLowerCase() === key);
        if (existing) {
            const prevRank = validSignals[existing.signal] ?? -1;
            const newRank = validSignals[d.signal];
            if (newRank > prevRank) {
                existing.signal = d.signal;
                existing.evidenceQuote = d.evidenceQuote || existing.evidenceQuote || '';
                if (typeof d.score === 'number') existing.score = d.score;
                if (d.reason) existing.reason = d.reason;
            } else if (newRank === prevRank) {
                // Same band — keep the higher score / fresher reason.
                if (typeof d.score === 'number' && d.score > (existing.score ?? -1)) existing.score = d.score;
                if (d.reason && d.reason.length > (existing.reason || '').length) existing.reason = d.reason;
            }
        } else {
            block.deltas.push({
                competency: d.competency,
                signal: d.signal,
                evidenceQuote: d.evidenceQuote || '',
                score: typeof d.score === 'number' ? d.score : null,
                reason: d.reason || ''
            });
        }
    }

    function applyScorecardDelta(d) {
        if (!d || !d.competency || !d.signal) return;
        // Signal enum guard: AIEngine clamps to this set but a buggy
        // upstream emitter or a v6→v7 schema drift could send junk.
        // Drop instead of rendering a row with an unknown signal that
        // has no dot icon.
        const validSignals = { not_yet: 0, partial: 1, demonstrated: 2 };
        if (!(d.signal in validSignals)) return;
        const key = d.competency.trim();
        if (!key) return;
        const prev = scorecard.get(key) || {};
        // Allow signal promotion: not_yet → partial → demonstrated. Never demote.
        const prevRank = validSignals[prev.signal] ?? -1;
        const newRank = validSignals[d.signal];
        if (newRank >= prevRank) {
            scorecard.set(key, {
                signal: d.signal,
                evidenceQuote: d.evidenceQuote || prev.evidenceQuote || ''
            });
        }
    }

    // ─── Render: thread ──────────────────────────────────────
    // Compute hierarchical display numbers: top-level blocks become Q1,
    // Q2, Q3… Follow-ups become Q{parent}.{childIdx} — e.g. Q1.1, Q1.2.
    // Makes the parent reference obvious at a glance.
    function computeBlockNumbers() {
        const nums = new Map();
        let topCount = 0;
        const childCounts = new Map();
        for (const b of blocks) {
            if (!b.isFollowup || !b.parentId) {
                topCount++;
                nums.set(b.id, `Q${topCount}`);
            } else {
                const parentNum = nums.get(b.parentId) || `Q?`;
                const idx = (childCounts.get(b.parentId) || 0) + 1;
                childCounts.set(b.parentId, idx);
                nums.set(b.id, `${parentNum}.${idx}`);
            }
        }
        return nums;
    }

    function renderThread() {
        const thread = document.getElementById('rtThread');
        if (!thread) return;
        const empty = document.getElementById('rtEmpty');

        // Hide empty state when we have any block, detection, OR a picker
        // showing (because the picker IS the "what to do next" UI).
        // Also hide when picker is pending (loading next options).
        const hasContent =
            blocks.length > 0 ||
            pendingHostDetections.length > 0 ||
            (pickerOptions && pickerOptions.options.length > 0) ||
            pickerPending;
        if (empty) empty.style.display = hasContent ? 'none' : '';

        // Remove existing block / detection nodes, keep the empty placeholder.
        Array.from(thread.querySelectorAll('.rt-block, .rt-detected, .rt-idle-cta')).forEach(n => n.remove());

        const numbers = computeBlockNumbers();
        blocks.forEach((b) => {
            const displayNum = numbers.get(b.id) || '?';
            const parentNum = b.isFollowup && b.parentId ? (numbers.get(b.parentId) || '') : '';
            thread.appendChild(buildBlockNode(b, displayNum, parentNum));
        });
        const detStart = (numbers.size || 0);
        pendingHostDetections.forEach((d, idx) => {
            thread.appendChild(buildDetectedNode(d, `Q${detStart + idx + 1}`));
        });

        // Idle-state CTA — when no active block, no pending detections,
        // no picker shown or pending → at least one block exists →
        // surface a "Get next question from AI" CTA so the host isn't
        // stuck after Skipping a picker.
        const idle =
            !activeBlockId &&
            pendingHostDetections.length === 0 &&
            !pickerOptions &&
            !pickerPending &&
            blocks.length > 0;
        if (idle) {
            const cta = document.createElement('div');
            cta.className = 'rt-idle-cta';
            cta.innerHTML =
                '<div class="rt-idle-text">No active question. Want AI to suggest 3 options for the next topic?</div>' +
                '<button class="rt-btn-done" data-action="request-next">Ask AI for next options</button>' +
                '<button class="rt-btn-ghost" data-action="custom-question">+ Ask my own</button>';
            cta.querySelectorAll('[data-action]').forEach(btn => {
                btn.addEventListener('click', () => handleAction(btn.dataset.action));
            });
            thread.appendChild(cta);
        }

        // Scroll active to view.
        if (activeBlockId) {
            const node = thread.querySelector(`[data-bid="${activeBlockId}"]`);
            if (node) node.scrollIntoView({ behavior: 'smooth', block: 'end' });
        }
    }

    function buildBlockNode(b, displayNum, parentNum) {
        const wrap = document.createElement('div');
        wrap.className = 'rt-block' +
            (b.status === 'done' ? ' rt-done' : ' rt-active') +
            (b.autoDetected ? ' rt-host' : '') +
            (b.isFollowup ? ' rt-is-followup' : '');
        wrap.dataset.bid = b.id;

        // Sanitize to a safe token — difficulty is normally an enum, but it goes
        // raw into a class attribute, so strip anything non-alphabetic rather than
        // trust the wire value (the sibling text is escaped; this closes the gap).
        const diffClass = 'rt-diff-' + (b.difficulty || 'medium').toLowerCase().replace(/[^a-z]/g, '');
        // Three pill states: DONE (host picked next topic), ANSWERED (grade
        // arrived — candidate has spoken), LISTENING (active, no grade yet).
        // Without ANSWERED, the pill stays at LISTENING after grading lands,
        // which contradicts the green grade card right below it.
        const graded = b.quality && b.quality.color && b.quality.color !== 'skip';
        let statusLbl, statusCls;
        if (b.status === 'done') { statusLbl = '✓ DONE'; statusCls = ''; }
        else if (graded) { statusLbl = 'ANSWERED'; statusCls = 'rt-graded-dot'; }
        else { statusLbl = 'LISTENING'; statusCls = 'rt-active-dot'; }

        // Follow-up chip references the parent so the host can see at a
        // glance "this is a drill-down of Q1" — combined with the Q1.1
        // numbering, the relationship is unmissable.
        const fuChip = b.isFollowup
            ? `<span class="rt-fu-chip" title="Follow-up question drilling into ${escape(parentNum || 'parent')}">↳ FOLLOW-UP OF ${escape(parentNum || '?')}</span>`
            : '';

        // Latency badge — only render when we actually measured the round-trip
        // (candidate-done → grade-arrival). Shows "⚡ 3.4s" with full title
        // breakdown on hover. Hidden until the grade lands.
        const latChip = (typeof b.gradeLatencyMs === 'number')
            ? `<span class="rt-lat-chip" title="Time from candidate finishing to grade arrival">⚡ ${(b.gradeLatencyMs / 1000).toFixed(1)}s</span>`
            : '';

        let html = '<div class="rt-qhead">' +
            `<span class="rt-qnum">${escape(displayNum)}</span>` +
            `<span class="rt-qdiff ${diffClass}">${escape(b.difficulty || 'medium').toUpperCase()}</span>` +
            `<span class="rt-qtopic">${escape(b.topic || '')}</span>` +
            fuChip +
            latChip +
            `<span class="rt-qstatus ${statusCls}">${statusLbl}</span>` +
            '</div>';

        html += '<div class="rt-qbody">';
        html += `<div class="rt-qtext">${escape(b.questionText)}</div>`;

        if (b.answerSummary) {
            html += `<div class="rt-answer"><span class="rt-tag">A:</span> ${escape(b.answerSummary)}</div>`;
        } else if (b.status !== 'done' && !graded) {
            // Only show "waiting for answer" while truly waiting. Once the
            // grade lands the candidate has clearly spoken, even if we don't
            // yet have a full answer summary.
            html += '<div class="rt-transcript"><span class="rt-tag">LIVE</span> waiting for candidate to answer…</div>';
        }

        // Signals row
        let signals = '';
        if (b.quality && b.quality.color && b.quality.color !== 'skip') {
            signals += `<span class="rt-signal"><span class="rt-dot rt-dot-${b.quality.color}"></span> ${b.quality.color}${b.quality.reason ? ' — ' + escape(b.quality.reason) : ''}</span>`;
        } else if (b.status !== 'done') {
            signals += '<span class="rt-signal"><span class="rt-dot rt-dot-pending"></span> <em>grading…</em></span>';
        }
        if (b.jargon && b.jargon.length) {
            const terms = b.jargon.slice(0, 5).map(j => escape(j.term)).join(', ');
            signals += `<span class="rt-signal">📚 <span class="rt-jargon">${terms}</span></span>`;
        }
        if (signals) html += `<div class="rt-signals">${signals}</div>`;

        // Per-block scorecard deltas — competency signals attributed to
        // THIS specific answer. Renders as a stacked list inside the
        // block so the host sees per-question coverage at a glance.
        if (b.deltas && b.deltas.length) {
            html += '<div class="rt-block-scorecard"><div class="rt-bsc-lbl">SCORED</div>';
            b.deltas.slice(0, 5).forEach(d => {
                const dot = d.signal === 'demonstrated' ? '●' : d.signal === 'partial' ? '◐' : '○';
                const cls = d.signal === 'demonstrated' ? 'rt-sig-done' : d.signal === 'partial' ? 'rt-sig-part' : 'rt-sig-not';
                const hasScore = typeof d.score === 'number';
                // Score band drives the chip color so the host can scan
                // dense rows at a glance (red 0-3 / amber 4-6 / green 7-10).
                const scoreCls = !hasScore ? '' : (d.score >= 7 ? 'rt-score-hi' : d.score >= 4 ? 'rt-score-mid' : 'rt-score-lo');
                const scoreChip = hasScore ? `<span class="rt-bsc-score ${scoreCls}">${d.score}/10</span>` : '';
                const reasonBlock = d.reason ? `<span class="rt-bsc-reason">${escape(d.reason)}</span>` : '';
                const evidenceBlock = d.evidenceQuote ? `<span class="rt-bsc-evidence">"${escape(d.evidenceQuote)}"</span>` : '';
                html += '<div class="rt-bsc-row">' +
                    `<span class="rt-sig ${cls}">${dot}</span>` +
                    `<span class="rt-bsc-comp">${escape(d.competency)}</span>` +
                    scoreChip +
                    reasonBlock +
                    evidenceBlock +
                    '</div>';
            });
            html += '</div>';
        }

        html += '</div>'; // qbody

        // Follow-up suggestion card (only on active blocks)
        if (b.status !== 'done' && b.followupSuggestion) {
            const fs = b.followupSuggestion;
            const fuLatChip = (typeof fs.latencyMs === 'number')
                ? `<span class="rt-lat-chip" title="Time from candidate finishing to AI follow-up suggestion">⚡ ${(fs.latencyMs / 1000).toFixed(1)}s</span>`
                : '';
            html += '<div class="rt-fu-suggest">' +
                '<span class="rt-fu-icon">↳</span>' +
                '<div class="rt-fu-body">' +
                `<strong>${escape(fs.question)}</strong>` +
                (fs.why ? `<div class="rt-fu-why">${escape(fs.why)}</div>` : '') +
                (fuLatChip ? `<div class="rt-fu-meta">${fuLatChip}</div>` : '') +
                '</div>' +
                '<div class="rt-fu-actions">' +
                `<button class="rt-btn-primary" data-action="add-followup" data-bid="${b.id}">ADD AS FOLLOW-UP</button>` +
                `<button class="rt-btn-ghost" data-action="skip-followup" data-bid="${b.id}">SKIP</button>` +
                '</div>' +
                '</div>';
        }

        // Footer actions (active only). The "💡 Ask AI for follow-up"
        // button is always visible — covers the case where the host
        // wants a drill-down but AI didn't proactively suggest one. While
        // a manual follow-up is in flight we show a spinner state so
        // double-clicks don't fire multiple Claude calls.
        if (b.status !== 'done') {
            const fuPending = !!b.manualFollowupPending;
            const fuLabel = fuPending
                ? '<span class="rt-spinner-small"></span> asking AI…'
                : '💡 ASK AI FOR FOLLOW-UP';
            const fuDisabled = fuPending ? 'disabled' : '';
            html += '<div class="rt-qfooter">' +
                `<button class="rt-btn-done" data-action="done-block" data-bid="${b.id}">✓ DONE — PICK NEXT TOPIC</button>` +
                `<button class="rt-btn-fu-manual" data-action="request-followup" data-bid="${b.id}" ${fuDisabled}>${fuLabel}</button>` +
                '</div>';
        }

        wrap.innerHTML = html;
        wrap.querySelectorAll('[data-action]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                handleAction(btn.dataset.action, btn.dataset.bid);
            });
        });
        return wrap;
    }

    function buildDetectedNode(d, displayNum) {
        const wrap = document.createElement('div');
        wrap.className = 'rt-detected';
        wrap.dataset.did = d.id;
        const confPct = Math.round(d.confidence * 100);
        wrap.innerHTML =
            '<div class="rt-qhead">' +
            `<span class="rt-qnum">${escape(displayNum)}</span>` +
            `<span class="rt-qdiff rt-diff-medium">DETECTED</span>` +
            `<span class="rt-qtopic">${escape(d.topic)}</span>` +
            `<span class="rt-qstatus rt-host-dot">FROM YOUR SPEECH · ${confPct}%</span>` +
            '</div>' +
            '<div class="rt-qbody">' +
            `<div class="rt-qtext">${escape(d.questionText)}</div>` +
            '<div class="rt-detected-note">↑ AI detected this question from your speech. Confirm to make it the active question, or dismiss if it was an aside.</div>' +
            '</div>' +
            '<div class="rt-qfooter">' +
            `<button class="rt-btn-done" data-action="confirm-detected" data-did="${d.id}">CONFIRM &amp; ASK</button>` +
            `<button class="rt-btn-ghost" data-action="dismiss-detected" data-did="${d.id}">DISMISS</button>` +
            '</div>';
        wrap.querySelectorAll('[data-action]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                handleAction(btn.dataset.action, btn.dataset.did);
            });
        });
        return wrap;
    }

    // ─── Render: picker ──────────────────────────────────────
    function renderPicker() {
        const pick = document.getElementById('rtPicker');
        if (!pick) return;

        // Hide the picker while the active block is still un-graded — the
        // host is mid-question and doesn't need next-question noise yet. But
        // ONCE the active block has any grade resolution (green/amber/red OR
        // 'skip' — meaning the candidate deflected and no grade is coming),
        // surface the picker below it so the host can move on. They can still
        // click DONE explicitly to mark the block complete; picking a new
        // card also closes the active one. Skip is critical here: when the
        // candidate flips a question back at the host, the host needs the
        // picker MORE than ever to redirect — hiding it on skip stranded the
        // host with no visual next-step UI.
        if (activeBlockId) {
            const active = blocks.find(b => b.id === activeBlockId);
            const hasResolution = active && active.quality && active.quality.color;
            if (!hasResolution) {
                pick.style.display = 'none';
                return;
            }
        }

        // Loading placeholder: shown after Done click while waiting for
        // the picker payload to arrive from AIEngine.
        if (pickerPending && !pickerOptions) {
            pick.style.display = '';
            pick.innerHTML =
                '<div class="rt-lbl-bar">PICK NEXT QUESTION</div>' +
                '<div class="rt-picker-loading">' +
                '  <span class="rt-spinner"></span>' +
                '  AI is picking 3 next-question candidates from the gaps in your scorecard…' +
                '</div>' +
                '<div class="rt-picker-actions">' +
                '  <button class="rt-btn-ghost" data-action="custom-question">+ ASK MY OWN</button>' +
                '</div>';
            pick.querySelectorAll('[data-action]').forEach(btn => {
                btn.addEventListener('click', () => handleAction(btn.dataset.action));
            });
            return;
        }

        if (!pickerOptions) {
            pick.style.display = 'none';
            return;
        }

        pick.style.display = '';
        let html = '<div class="rt-lbl-bar">PICK NEXT QUESTION</div>';
        if (pickerOptions.topicHint)
            html += `<div class="rt-picker-hint">${escape(pickerOptions.topicHint)}</div>`;
        if (pickerOptions.options.length === 0) {
            html += '<div class="rt-picker-loading rt-picker-fallback">AI couldn\'t suggest 3 options this turn. Type your own:</div>';
        }
        // Filter out malformed entries — null, missing question, etc.
        // A `null` in the array would crash the next access. Empty
        // question strings are useless to the host so drop them too.
        // ALSO drop options whose topic is in the exhaustedTopics set —
        // the state machine has marked it done, so we shouldn't push the
        // host to drill it further. If filtering empties the list we keep
        // the original (better something than nothing); host can still
        // SKIP or ASK MY OWN.
        let safeOpts = pickerOptions.options.filter(o => o && typeof o === 'object' && o.question && o.question.trim());
        if (exhaustedTopics.size > 0) {
            const beforeCount = safeOpts.length;
            const filtered = safeOpts.filter(o => {
                const t = (o.topic || '').trim().toLowerCase();
                return !t || !exhaustedTopics.has(t);
            });
            if (filtered.length > 0) safeOpts = filtered;
            // else: AI didn't suggest any non-exhausted topics — keep original
            // so the host has something. Add a small banner so they know.
            if (filtered.length === 0 && beforeCount > 0) {
                html += '<div class="rt-picker-hint rt-picker-warn">⚠ All suggestions still on exhausted topics — use ASK MY OWN to switch topics</div>';
            }
        }
        safeOpts.forEach((o, idx) => {
            html += `<div class="rt-picker-option" data-idx="${idx}">` +
                '<div class="rt-po-hdr">' +
                `<span class="rt-qdiff rt-diff-${(o.difficulty || 'medium').toLowerCase().replace(/[^a-z]/g, '')}">${escape(o.difficulty || 'medium').toUpperCase()}</span>` +
                `<span class="rt-qtopic">${escape(o.topic || '')}</span>` +
                '</div>' +
                `<div class="rt-po-q">${escape(o.question)}</div>` +
                (o.why ? `<div class="rt-po-why">${escape(o.why)}</div>` : '') +
                '</div>';
        });
        // Reassign so pickOption(idx) doesn't reference the original
        // (possibly null-containing) array.
        pickerOptions.options = safeOpts;
        html += '<div class="rt-picker-actions">' +
            '<button class="rt-btn-ghost" data-action="custom-question">+ ASK MY OWN</button>' +
            '<button class="rt-btn-ghost" data-action="skip-round">SKIP</button>' +
            '</div>';
        pick.innerHTML = html;
        pick.querySelectorAll('.rt-picker-option').forEach(opt => {
            opt.addEventListener('click', () => {
                const idx = parseInt(opt.dataset.idx, 10);
                pickOption(idx);
            });
        });
        pick.querySelectorAll('[data-action]').forEach(btn => {
            btn.addEventListener('click', () => handleAction(btn.dataset.action));
        });
    }

    // ─── Render: scorecard ────────────────────────────────────
    function renderScorecard() {
        const sc = document.getElementById('rtScorecard');
        const list = document.getElementById('rtScList');
        if (!sc || !list) return;
        if (scorecard.size === 0) {
            sc.style.display = 'none';
            return;
        }
        sc.style.display = '';
        const rows = Array.from(scorecard.entries()).map(([comp, v]) => {
            const sig = v.signal;
            const dot = sig === 'demonstrated' ? '●' : sig === 'partial' ? '◐' : '○';
            const cls = sig === 'demonstrated' ? 'rt-sig-done' : sig === 'partial' ? 'rt-sig-part' : 'rt-sig-not';
            return `<div class="rt-sc-row"><span class="rt-sig ${cls}">${dot}</span> ${escape(comp)}</div>`;
        });
        list.innerHTML = rows.join('');

        // Topics-done counter on the budget bar — counts DISTINCT topics
        // marked exhausted by the AI's topic_state signal. Falls back to
        // the count of distinct topics touched (engaged with) if no topic
        // has been exhausted yet, so the bar reflects breadth not the
        // misleading "demonstrated scorecard deltas" count we used before
        // (which double-counted multiple competencies per turn).
        const done = exhaustedTopics.size > 0 ? exhaustedTopics.size : touchedTopics.size;
        const td = document.getElementById('rtTopicsDone');
        if (td) td.textContent = done;
    }

    // ─── Render: trust check ──────────────────────────────────
    function renderTrustCheck() {
        const t = document.getElementById('rtTrust');
        if (!t) return;
        if (!trustCheck || trustCheck.dismissedAtMs) {
            t.style.display = 'none';
            return;
        }
        const conf = trustCheck.confidence ? ` · ${trustCheck.confidence.toFixed(2)}` : '';
        t.style.display = '';
        t.innerHTML =
            '<span class="rt-trust-icon">⚠</span>' +
            '<div class="rt-trust-body">' +
            `<strong>TRUST CHECK${conf}</strong>` +
            (trustCheck.reason ? `<div>${escape(trustCheck.reason)}</div>` : '') +
            (trustCheck.coaching ? `<div class="rt-trust-coach"><strong>Coach:</strong> ${escape(trustCheck.coaching)}</div>` : '') +
            '</div>' +
            '<button class="rt-trust-dismiss" data-action="dismiss-trust">✕</button>';
        t.querySelectorAll('[data-action]').forEach(btn => {
            btn.addEventListener('click', () => handleAction(btn.dataset.action));
        });
    }

    // ─── Actions ──────────────────────────────────────────────
    function handleAction(action, ref) {
        switch (action) {
            case 'done-block':       return doneActiveBlock();
            case 'add-followup':     return addFollowupFromSuggestion(ref);
            case 'skip-followup':    return skipFollowupSuggestion(ref);
            case 'confirm-detected': return confirmDetected(ref);
            case 'dismiss-detected': return dismissDetected(ref);
            case 'custom-question':  return openCustomQuestion();
            case 'skip-round':       return skipRound();
            case 'dismiss-trust':    return dismissTrust();
            case 'dismiss-coach':    return dismissCoachAlert();
            case 'request-next':     return (() => { pickerPending = true; renderThread(); renderPicker(); requestNextTopic(); })();
            case 'request-followup': return requestManualFollowup(ref);
            case 'custom-submit':    return submitCustomQuestion();
            case 'custom-cancel':    return cancelCustomQuestion();
        }
    }

    function pickOption(idx) {
        if (!pickerOptions || !pickerOptions.options[idx]) return;
        const opt = pickerOptions.options[idx];
        // Close the previously-active block. If it never got real engagement
        // (no grade, no answer summary, no scorecard deltas — host pinned but
        // skipped without asking), DELETE it so we don't leave an empty husk.
        // Otherwise mark DONE. Mirrors the confirmDetected transition logic.
        const curIdx = blocks.findIndex(b => b.id === activeBlockId);
        if (curIdx >= 0) {
            const cur = blocks[curIdx];
            const hadEngagement = (cur.quality && cur.quality.color && cur.quality.color !== 'skip')
                || !!cur.answerSummary
                || (cur.deltas && cur.deltas.length > 0);
            if (hadEngagement) {
                cur.status = 'done';
                cur.doneAtMs = Date.now();
                cur.followupSuggestion = null;
            } else {
                blocks.splice(curIdx, 1);
            }
        }
        const block = createBlock({
            questionText: opt.question,
            topic: opt.topic,
            difficulty: opt.difficulty || 'medium',
            isFollowup: false,
            parentId: ''
        });
        // Clear picker
        pickerOptions = null;
        renderPicker();
        // Tell AIEngine
        emitActiveQuestion(block);
        renderThread();
    }

    function createBlock(opts) {
        const block = {
            id: opts.id || ('q-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8)),
            parentId: opts.parentId || '',
            questionText: opts.questionText,
            topic: opts.topic || '',
            difficulty: opts.difficulty || 'medium',
            isFollowup: !!opts.isFollowup,
            autoDetected: !!opts.autoDetected,
            status: 'active',
            askedAtMs: Date.now(),
            quality: null,
            jargon: [],
            // Per-block scorecard deltas — competency signals attributed
            // to THIS specific answer. Renders inline inside the block so
            // the host sees "this answer demonstrated/partial-ed/missed
            // X" rather than just an aggregate at the bottom.
            deltas: [],
            answerSummary: '',
            followupSuggestion: null
        };
        blocks.push(block);
        activeBlockId = block.id;
        return block;
    }

    function emitActiveQuestion(block) {
        if (!signalR || !meetingId) return;
        try {
            signalR.invoke('SetActiveQuestion',
                String(meetingId),
                block.id,
                block.questionText,
                block.topic || '',
                block.difficulty || 'medium',
                !!block.isFollowup,
                block.parentId || ''
            ).catch(err => console.warn('[RecruitThread] SetActiveQuestion failed:', err));
        } catch (e) {
            console.warn('[RecruitThread] SetActiveQuestion threw:', e);
        }
    }

    function doneActiveBlock() {
        const block = blocks.find(b => b.id === activeBlockId);
        if (!block) return;
        block.status = 'done';
        block.doneAtMs = Date.now();
        activeBlockId = null;
        // Mark picker as pending so the next render shows "asking AI…"
        // until V7NextQuestionOptions arrives. Clear any stale options
        // from before this Done click.
        pickerOptions = null;
        pickerPending = true;
        renderThread();
        renderPicker();
        // Ask AIEngine for next 3 options
        requestNextTopic();
    }

    function onNextQuestionOptions_clearPending() {
        // Called from onNextQuestionOptions implicitly via state reset.
        pickerPending = false;
    }

    function requestNextTopic() {
        if (!signalR || !meetingId) return;
        try {
            signalR.invoke('RequestNextTopic', String(meetingId))
                .catch(err => console.warn('[RecruitThread] RequestNextTopic failed:', err));
        } catch (e) {
            console.warn('[RecruitThread] RequestNextTopic threw:', e);
        }
    }

    function requestManualFollowup(bid) {
        if (!signalR || !meetingId) return;
        const block = blocks.find(b => b.id === bid);
        if (!block) return;
        if (block.manualFollowupPending) return; // debounce
        block.manualFollowupPending = true;
        renderThread();
        try {
            signalR.invoke('RequestFollowup', String(meetingId), bid)
                .then(ok => {
                    if (ok === false) {
                        // Server rejected (rate-limit or auth). Clear pending
                        // immediately so the host can retry.
                        block.manualFollowupPending = false;
                        renderThread();
                    }
                    // Successful invokes leave pending=true. The pending flag
                    // clears when V7FollowupSuggested arrives (handled below).
                })
                .catch(err => {
                    console.warn('[RecruitThread] RequestFollowup failed:', err);
                    block.manualFollowupPending = false;
                    renderThread();
                });
        } catch (e) {
            console.warn('[RecruitThread] RequestFollowup threw:', e);
            block.manualFollowupPending = false;
            renderThread();
        }
    }

    function addFollowupFromSuggestion(parentId) {
        const parent = blocks.find(b => b.id === parentId);
        if (!parent || !parent.followupSuggestion) return;
        const fs = parent.followupSuggestion;
        // Close the parent's active state (but keep it in the thread).
        parent.status = 'done';
        parent.doneAtMs = Date.now();
        parent.followupSuggestion = null;
        const fu = createBlock({
            questionText: fs.question,
            topic: fs.topic,
            difficulty: fs.difficulty,
            isFollowup: true,
            parentId: parent.id
        });
        emitActiveQuestion(fu);
        renderThread();
    }

    function skipFollowupSuggestion(parentId) {
        const parent = blocks.find(b => b.id === parentId);
        if (!parent) return;
        parent.followupSuggestion = null;
        renderThread();
    }

    function confirmDetected(detectionId) {
        const idx = pendingHostDetections.findIndex(d => d.id === detectionId);
        if (idx < 0) return;
        const d = pendingHostDetections[idx];
        pendingHostDetections.splice(idx, 1);
        // Transition the current active block: if it never got an answer or
        // a real grade (host pinned a picker option then asked a different
        // question instead), DELETE it — leaving an empty "DONE" husk is
        // visual clutter the host can't act on. Only keep blocks that had
        // genuine engagement (any grade other than 'skip', or an answer
        // summary that came in via streaming).
        const curIdx = blocks.findIndex(b => b.id === activeBlockId);
        if (curIdx >= 0) {
            const cur = blocks[curIdx];
            const hadEngagement = (cur.quality && cur.quality.color && cur.quality.color !== 'skip')
                || !!cur.answerSummary
                || (cur.deltas && cur.deltas.length > 0);
            if (hadEngagement) {
                cur.status = 'done';
                cur.doneAtMs = Date.now();
                cur.followupSuggestion = null;
            } else {
                blocks.splice(curIdx, 1);
            }
        }
        // Only treat as a follow-up when we have BOTH classification=follow_up
        // AND a resolvable parent id (the AIEngine's snapshotted active id).
        // Otherwise we'd render an orphan "FOLLOW-UP OF ?" chip — happens when
        // the prior block was already DONE before the detection arrived (no
        // active id to snapshot), but the AI still classified it as a
        // follow-up. In that case it's effectively a new topic.
        const hasResolvableParent = !!(d.parentQuestionIdHint && blocks.find(b => b.id === d.parentQuestionIdHint));
        const isFollowup = d.classification === 'follow_up' && hasResolvableParent;
        const block = createBlock({
            id: d.id,
            questionText: d.questionText,
            topic: d.topic,
            difficulty: 'medium',
            autoDetected: true,
            isFollowup: isFollowup,
            parentId: isFollowup ? d.parentQuestionIdHint : ''
        });
        emitActiveQuestion(block);
        renderThread();
    }

    function dismissDetected(detectionId) {
        pendingHostDetections = pendingHostDetections.filter(d => d.id !== detectionId);
        renderThread();
    }

    function openCustomQuestion() {
        // Inline themed input — no native window.prompt (which breaks the
        // cockpit theme and reads as phishy). Replaces the picker / idle
        // CTA with a textarea + Cancel/Use buttons.
        const pick = document.getElementById('rtPicker');
        const thread = document.getElementById('rtThread');
        const host = pick && pick.style.display !== 'none' ? pick : thread;
        if (!host) return;

        // Remove any existing custom-input UI first.
        Array.from(host.querySelectorAll('.rt-custom-input')).forEach(n => n.remove());

        const wrap = document.createElement('div');
        wrap.className = 'rt-custom-input';
        wrap.innerHTML =
            '<div class="rt-lbl-bar">YOUR OWN QUESTION</div>' +
            '<textarea class="rt-custom-textarea" id="rtCustomText" rows="3" placeholder="Type the question you want to ask the candidate…"></textarea>' +
            '<div class="rt-custom-actions">' +
            '  <button class="rt-btn-done" data-action="custom-submit">USE THIS QUESTION</button>' +
            '  <button class="rt-btn-ghost" data-action="custom-cancel">CANCEL</button>' +
            '</div>';
        // Insert at the top of host so it grabs attention.
        host.insertBefore(wrap, host.firstChild);
        wrap.querySelectorAll('[data-action]').forEach(btn => {
            btn.addEventListener('click', () => handleAction(btn.dataset.action));
        });
        // Auto-focus + Enter submits (Shift+Enter for newline).
        const ta = wrap.querySelector('#rtCustomText');
        if (ta) {
            ta.focus();
            ta.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    submitCustomQuestion();
                }
            });
        }
    }

    function submitCustomQuestion() {
        const ta = document.getElementById('rtCustomText');
        if (!ta) return;
        const text = (ta.value || '').trim();
        if (!text) { ta.focus(); return; }
        const block = createBlock({
            questionText: text,
            topic: '(custom)',
            difficulty: 'medium'
        });
        pickerOptions = null;
        pickerPending = false;
        cancelCustomQuestion();
        renderPicker();
        emitActiveQuestion(block);
        renderThread();
    }

    function cancelCustomQuestion() {
        Array.from(document.querySelectorAll('.rt-custom-input')).forEach(n => n.remove());
    }

    function skipRound() {
        // Just hide the picker. Host can do their own thing — the idle
        // CTA in the thread will appear if there's no active block.
        pickerOptions = null;
        pickerPending = false;
        renderPicker();
        renderThread();
    }

    function dismissTrust() {
        if (trustCheck) trustCheck.dismissedAtMs = Date.now();
        renderTrustCheck();
    }

    // ─── Helpers ──────────────────────────────────────────────
    function escape(s) {
        if (s == null) return '';
        return String(s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }
})();
