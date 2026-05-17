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

    // Trust check state — populated on V7TrustCheck. Floating banner.
    let trustCheck = null;              // { reason, coaching, confidence, dismissedAtMs }

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
        if (initialized) return;
        signalR = connection;
        meetingId = meetingIdParam;
        // Body class drives the CSS that hides the legacy COPILOT panel,
        // INTEL panel, and insight feed in interview mode (Phase 2.5).
        // Removing this class restores the v6 layout for debugging.
        document.body.classList.add('recruit-v7-mode');
        replaceBody();
        wireSignalR();
        initialized = true;
        console.log('[RecruitThread] v7 initialized for meeting', meetingId);
    }
    window.initRecruitThread = initRecruitThread;

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
            '    <button class="copilot-model-btn active" data-model="haiku" onclick="setCopilotModel(\'haiku\')" title="Haiku — fast, cheap">HAIKU</button>' +
            '    <button class="copilot-model-btn" data-model="sonnet" onclick="setCopilotModel(\'sonnet\')" title="Sonnet — recommended for interviews">SONNET</button>' +
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

        // Existing v6 signals — still fire for question-scoped grading
        // until the backend starts emitting V7QuestionGrade. We treat the
        // single-payload CopilotInsight HUD signals as updates to the
        // currently-active block.
        signalR.on('InterviewQuestionsUpdated', onLegacyQuestionsUpdated);
        signalR.on('AnswerQuality', onLegacyAnswerQuality);
        signalR.on('JargonDetected', onLegacyJargon);
        signalR.on('ScorecardUpdate', onLegacyScorecard);
        signalR.on('InterviewContextLoaded', onContextLoaded);
    }

    function onContextLoaded(data) {
        // Round type + budget come from HRMS via Phase 1 InterviewContextLoaded.
        if (!data) return;
        roundMeta.roundType = data.roundType || '';
        roundMeta.roundLabel = data.roundLabel || data.roundType || '';
        const total = roundBudgetMins(data.roundType);
        roundMeta.budgetMins = total;
        const tEl = document.getElementById('rtTotal');
        if (tEl) tEl.textContent = total + ':00';
        const rEl = document.getElementById('rtBudgetRound');
        if (rEl) rEl.textContent = (data.roundLabel || data.roundType || 'INTERVIEW').toUpperCase();
        const tdEl = document.getElementById('rtTopicsTotal');
        const topics = Array.isArray(data.topicsSeeded) ? data.topicsSeeded.length : 0;
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
        // De-dup: ignore if we already have an unresolved detection with the same text.
        const dupe = pendingHostDetections.find(d => d.questionText.trim().toLowerCase() === trimmed.toLowerCase());
        if (dupe) return;
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
        // v7 explicit question_id tagging. Until AIEngine emits these,
        // the legacy handlers below carry the load — but when present,
        // route directly to the named block.
        if (!data || !data.questionId) return;
        const block = blocks.find(b => b.id === data.questionId);
        if (!block) return;
        if (data.qualityColor) block.quality = { color: data.qualityColor, reason: data.qualityReason || '', confidence: data.qualityConfidence || 0 };
        if (data.answerSummary) block.answerSummary = data.answerSummary;
        (data.jargon || []).forEach(j => addJargonToBlock(block, j));
        (data.deltas || []).forEach(d => {
            addDeltaToBlock(block, d);  // per-block visibility
            applyScorecardDelta(d);     // also bubble up to aggregate rollup
        });
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
        parent.followupSuggestion = {
            question: data.question,
            why: data.why || '',
            topic: data.topic || parent.topic,
            difficulty: data.difficulty || 'medium',
            reason: data.reason || ''
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
            }
        } else {
            block.deltas.push({
                competency: d.competency,
                signal: d.signal,
                evidenceQuote: d.evidenceQuote || ''
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

        const diffClass = 'rt-diff-' + (b.difficulty || 'medium').toLowerCase();
        const statusLbl = b.status === 'done' ? '✓ DONE' : 'LISTENING';
        const statusCls = b.status === 'done' ? '' : 'rt-active-dot';

        // Follow-up chip references the parent so the host can see at a
        // glance "this is a drill-down of Q1" — combined with the Q1.1
        // numbering, the relationship is unmissable.
        const fuChip = b.isFollowup
            ? `<span class="rt-fu-chip" title="Follow-up question drilling into ${escape(parentNum || 'parent')}">↳ FOLLOW-UP OF ${escape(parentNum || '?')}</span>`
            : '';

        let html = '<div class="rt-qhead">' +
            `<span class="rt-qnum">${escape(displayNum)}</span>` +
            `<span class="rt-qdiff ${diffClass}">${escape(b.difficulty || 'medium').toUpperCase()}</span>` +
            `<span class="rt-qtopic">${escape(b.topic || '')}</span>` +
            fuChip +
            `<span class="rt-qstatus ${statusCls}">${statusLbl}</span>` +
            '</div>';

        html += '<div class="rt-qbody">';
        html += `<div class="rt-qtext">${escape(b.questionText)}</div>`;

        if (b.answerSummary) {
            html += `<div class="rt-answer"><span class="rt-tag">A:</span> ${escape(b.answerSummary)}</div>`;
        } else if (b.status !== 'done') {
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
                html += '<div class="rt-bsc-row">' +
                    `<span class="rt-sig ${cls}">${dot}</span>` +
                    `<span class="rt-bsc-comp">${escape(d.competency)}</span>` +
                    (d.evidenceQuote ? `<span class="rt-bsc-evidence">"${escape(d.evidenceQuote)}"</span>` : '') +
                    '</div>';
            });
            html += '</div>';
        }

        html += '</div>'; // qbody

        // Follow-up suggestion card (only on active blocks)
        if (b.status !== 'done' && b.followupSuggestion) {
            const fs = b.followupSuggestion;
            html += '<div class="rt-fu-suggest">' +
                '<span class="rt-fu-icon">↳</span>' +
                '<div class="rt-fu-body">' +
                `<strong>${escape(fs.question)}</strong>` +
                (fs.why ? `<div class="rt-fu-why">${escape(fs.why)}</div>` : '') +
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

        // Hide the picker entirely while a Q-Block is active — the host
        // shouldn't see "pick next" while they're still on a question.
        // Options remain stashed in pickerOptions; they'll render the
        // moment Done is clicked.
        if (activeBlockId) {
            pick.style.display = 'none';
            return;
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
        const safeOpts = pickerOptions.options.filter(o => o && typeof o === 'object' && o.question && o.question.trim());
        safeOpts.forEach((o, idx) => {
            html += `<div class="rt-picker-option" data-idx="${idx}">` +
                '<div class="rt-po-hdr">' +
                `<span class="rt-qdiff rt-diff-${(o.difficulty || 'medium').toLowerCase()}">${escape(o.difficulty || 'medium').toUpperCase()}</span>` +
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

        // Topics-done counter on the budget bar
        const done = Array.from(scorecard.values()).filter(v => v.signal === 'demonstrated').length;
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
            case 'request-next':     return (() => { pickerPending = true; renderThread(); renderPicker(); requestNextTopic(); })();
            case 'request-followup': return requestManualFollowup(ref);
            case 'custom-submit':    return submitCustomQuestion();
            case 'custom-cancel':    return cancelCustomQuestion();
        }
    }

    function pickOption(idx) {
        if (!pickerOptions || !pickerOptions.options[idx]) return;
        const opt = pickerOptions.options[idx];
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
        // If there's a current active block, close it.
        const cur = blocks.find(b => b.id === activeBlockId);
        if (cur) { cur.status = 'done'; cur.followupSuggestion = null; }
        const block = createBlock({
            id: d.id,
            questionText: d.questionText,
            topic: d.topic,
            difficulty: 'medium',
            autoDetected: true,
            isFollowup: d.classification === 'follow_up',
            parentId: d.parentQuestionIdHint
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
