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
        const hud = document.getElementById('copilotHud');
        const insightFeed = document.getElementById('copilotInsights');
        if (!hud || !insightFeed) {
            console.warn('[RecruitHUD] #copilotHud or #copilotInsights missing — cannot inject');
            return;
        }

        const wrapper = document.createElement('div');
        wrapper.className = 'recruit-hud-sections';
        wrapper.id = 'recruitHudSections';
        wrapper.innerHTML = sectionsHtml();
        insightFeed.parentNode.insertBefore(wrapper, insightFeed);
    }

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

            + '<div class="recruit-ask-next" id="recruitAskNext" style="display:none;">'
            +   '<div class="recruit-section-header">'
            +     '<span class="recruit-section-label">ASK NEXT</span>'
            +     '<span class="recruit-section-help" title="AI-suggested follow-up questions. They replace each turn — pull from the top.">?</span>'
            +   '</div>'
            +   '<div class="recruit-ask-next-cards" id="recruitAskNextCards"></div>'
            + '</div>'

            + '<div class="recruit-signals-row" id="recruitSignalsRow" style="display:none;">'
            +   '<div class="recruit-quality-chip recruit-quality-empty" id="recruitQualityChip" title="Quality of the candidate\'s most recent answer">'
            +     '<span class="recruit-quality-dot"></span>'
            +     '<span class="recruit-quality-label">LAST ANSWER</span>'
            +     '<span class="recruit-quality-text" id="recruitQualityText">—</span>'
            +   '</div>'
            +   '<button type="button" class="recruit-jargon-trigger" id="recruitJargonTrigger" onclick="toggleRecruitJargonTray()">'
            +     '<span class="recruit-jargon-icon" aria-hidden="true">A.B</span>'
            +     '<span class="recruit-jargon-label">JARGON</span>'
            +     '<span class="recruit-jargon-count" id="recruitJargonCount">0</span>'
            +   '</button>'
            + '</div>'

            + '<div class="recruit-jargon-tray" id="recruitJargonTray" style="display:none;">'
            +   '<div class="recruit-jargon-list" id="recruitJargonList"></div>'
            + '</div>'

            + '<div class="recruit-scorecard" id="recruitScorecard" style="display:none;">'
            +   '<button type="button" class="recruit-scorecard-header" onclick="toggleRecruitScorecard()">'
            +     '<span class="recruit-scorecard-chevron">▸</span>'
            +     '<span class="recruit-section-label">SCORECARD</span>'
            +     '<span class="recruit-scorecard-summary" id="recruitScorecardSummary">—</span>'
            +   '</button>'
            +   '<div class="recruit-scorecard-body" id="recruitScorecardBody" style="display:none;"></div>'
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
        root.style.display = askNextQueue.length > 0 ? 'block' : 'none';
    }

    function onAnswerQuality(data) {
        const chip = document.getElementById('recruitQualityChip');
        const row = document.getElementById('recruitSignalsRow');
        if (!chip || !row) return;

        chip.classList.remove('recruit-quality-empty', 'recruit-quality-green', 'recruit-quality-amber', 'recruit-quality-red');
        chip.classList.add('recruit-quality-' + (data.color || 'empty'));
        setText('recruitQualityText', truncate(data.reason || (data.color || '').toUpperCase(), 80));

        const conf = typeof data.confidence === 'number' ? Math.round(data.confidence * 100) + '%' : '';
        chip.title = 'Last answer · ' + (data.color || '').toUpperCase() + (conf ? ' · ' + conf : '') + '\n' + (data.reason || '');
        row.style.display = 'flex';
    }

    function onJargonDetected(data) {
        const list = document.getElementById('recruitJargonList');
        const count = document.getElementById('recruitJargonCount');
        const row = document.getElementById('recruitSignalsRow');
        if (!list || !count || !row) return;

        const incoming = (data.terms || []).filter(t => t && t.term && t.definition);
        if (incoming.length === 0) return;

        // Prepend newest, dedupe by term (case-insensitive), cap 20.
        const seen = new Set(incoming.map(t => (t.term || '').toLowerCase()));
        jargonHistory = incoming.concat(jargonHistory.filter(t => !seen.has((t.term || '').toLowerCase()))).slice(0, 20);
        count.textContent = jargonHistory.length;
        row.style.display = 'flex';

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
        const sc = document.getElementById('recruitScorecard');
        if (!sc) return;

        (data.deltas || []).forEach(d => {
            if (!d || !d.competency || !d.signal) return;
            // Don't clobber an interviewer override.
            const existing = scorecardState.get(d.competency);
            if (existing && existing.overridden) return;
            scorecardState.set(d.competency, {
                signal: d.signal,
                evidenceQuote: d.evidenceQuote || '',
                overridden: false,
            });
        });

        renderScorecard();
        sc.style.display = 'block';
    }

    function renderScorecard() {
        const body = document.getElementById('recruitScorecardBody');
        const summary = document.getElementById('recruitScorecardSummary');
        if (!body || !summary) return;

        body.innerHTML = '';
        let demonstrated = 0, partial = 0, notYet = 0;
        const entries = Array.from(scorecardState.entries());
        // Sort: demonstrated last, not_yet first so the gaps are visible first.
        const rank = { not_yet: 0, partial: 1, demonstrated: 2 };
        entries.sort((a, b) => (rank[a[1].signal] || 0) - (rank[b[1].signal] || 0));

        entries.forEach(([competency, d]) => {
            const sig = d.signal || 'not_yet';
            if (sig === 'demonstrated') demonstrated++;
            else if (sig === 'partial') partial++;
            else notYet++;

            const row = document.createElement('div');
            row.className = 'recruit-sc-row recruit-sc-' + sig;
            const competencyEsc = escapeAttr(competency);
            const evidenceFull = d.evidenceQuote || '';
            const evidencePreview = evidenceFull ? '“' + truncate(evidenceFull, 70) + '”' : '';
            row.innerHTML = ''
                + '<span class="recruit-sc-comp" title="' + escapeAttr(competency) + '">' + escapeHtml(competency) + '</span>'
                + '<span class="recruit-sc-signal recruit-sc-signal-' + sig + '">' + sig.replace(/_/g, ' ') + (d.overridden ? ' (you)' : '') + '</span>'
                + (evidencePreview ? '<span class="recruit-sc-evidence" title="' + escapeAttr(evidenceFull) + '">' + escapeHtml(evidencePreview) + '</span>' : '<span class="recruit-sc-evidence"></span>')
                + '<select class="recruit-sc-override" data-comp="' + competencyEsc + '" onchange="overrideRecruitScorecard(this.dataset.comp, this.value)">'
                +   '<option value="">override…</option>'
                +   '<option value="demonstrated"' + (sig === 'demonstrated' ? ' selected' : '') + '>demonstrated</option>'
                +   '<option value="partial"'      + (sig === 'partial'      ? ' selected' : '') + '>partial</option>'
                +   '<option value="not_yet"'      + (sig === 'not_yet'      ? ' selected' : '') + '>not yet</option>'
                + '</select>';
            body.appendChild(row);
        });

        const total = scorecardState.size;
        summary.textContent = total === 0
            ? '—'
            : demonstrated + ' demo · ' + partial + ' partial · ' + notYet + ' gap';
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

    // Called by meeting.js's leaveMeeting() before the final disconnect. Returns
    // a Promise that resolves when the recruiter has Submitted or Skipped the
    // modal. If there's no draft yet (e.g. AIEngine didn't produce one because
    // the meeting was too short), resolves immediately.
    function showRecruitReportModal() {
        return new Promise((resolve) => {
            if (!isInterviewMode || !reportDraft) {
                resolve({ action: 'no_draft' });
                return;
            }
            if (reportSubmitted) {
                resolve({ action: 'already_submitted' });
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

            overlay.addEventListener('click', (e) => {
                const action = e.target && e.target.getAttribute && e.target.getAttribute('data-action');
                if (!action) return;
                if (action === 'skip') {
                    cleanup();
                    resolve({ action: 'skip' });
                } else if (action === 'submit') {
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
        const existing = scorecardState.get(competency) || { signal: 'not_yet', evidenceQuote: '', overridden: false };
        if (!value) {
            // Reset override (will be re-marked by next AI signal).
            existing.overridden = false;
            scorecardState.set(competency, existing);
        } else {
            existing.signal = value;
            existing.overridden = true;
            scorecardState.set(competency, existing);
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
