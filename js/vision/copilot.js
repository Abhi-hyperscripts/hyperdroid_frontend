/**
 * AI Copilot HUD — heads-up display overlay for host-only real-time coaching.
 * Renders like a pilot's visor: transparent overlay on the video grid,
 * insights slide in from the left, auto-dismiss after timeout.
 *
 * Supports three operational modes:
 * - Manual: Host reads insights on screen (default)
 * - Earpiece: Host hears TTS whisper of suggested responses
 * - Autonomous: AI speaks to prospect via TTS on their browser
 */

let copilotConnection = null;
let copilotMeetingId = null;
let copilotMeetingMode = 'sales';
let copilotMode = 'manual'; // "manual", "earpiece", "autonomous"
let copilotFrequency = 'normal'; // "fast", "normal", "chill"
let copilotFrequencySynced = false; // true once initial frequency sent to backend
let copilotVisible = false;
let copilotInsightCount = 0;
let copilotStartTime = null;
let copilotUptimeInterval = null;
let copilotBotActive = false;
let copilotBotPollInterval = null;
let ttsSpeaking = false;

// Emotion detection state
let emotionDetector = null;
let emotionSendInterval = null;
let latestEmotion = { emotion: null, confidence: 0, isLooking: false };

// Research intel panel state
let researchPanelVisible = false;
let researchCount = 0;

// Max visible insights in the feed before oldest auto-removes
const HUD_MAX_VISIBLE = 5;
// Auto-dismiss timeouts per mode (autonomous is faster — host isn't reading them as closely)
const HUD_DISMISS_MS = 25000;
const HUD_DISMISS_HIGH_MS = 45000;
const HUD_DISMISS_AUTO_MS = 8000;
const HUD_DISMISS_AUTO_HIGH_MS = 12000;
// Minimum time (ms) a card stays on top before a new one can push it down.
// Prevents rapid-fire insights from making cards unreadable.
const HUD_MIN_DISPLAY_MS = 5000;
let hudLastCardShownAt = 0;
let hudInsightQueue = [];

const HUD_TYPE_CONFIG = {
    // \u2500\u2500 Sales-mode types \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
    objection:  { label: 'OBJECTION',  glyph: '\u25B2', color: '#ff4757' },  // red triangle
    suggestion: { label: 'SUGGEST',    glyph: '\u25C6', color: '#00d4ff' },  // neon cyan diamond
    sentiment:  { label: 'SENTIMENT',  glyph: '\u25CF', color: '#ffa502' },  // amber circle
    key_moment: { label: 'KEY MOMENT', glyph: '\u2605', color: '#00d4ff' },  // cyan star
    summary:    { label: 'SUMMARY',    glyph: '\u2500', color: '#94a3b8' },  // light slate line
    // \u2500\u2500 Interview-mode types (drill-down state machine) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
    next_question:        { label: 'NEXT Q',         glyph: '\u00BB',     color: '#00d4ff' },  // \u00BB double angle
    follow_up:            { label: 'FOLLOW-UP',      glyph: '\u21AA',     color: '#a78bfa' },  // \u21AA hooked arrow
    move_on:              { label: 'MOVE ON',        glyph: '\u2705',     color: '#22c55e' },  // \u2705
    depth_signal_strong:  { label: 'STRONG ANSWER',  glyph: '\u2731',     color: '#22c55e' },  // \u2731
    depth_signal_weak:    { label: 'WEAK ANSWER',    glyph: '\u26A0',     color: '#fbbf24' }   // \u26A0
};

/**
 * Initialize copilot HUD: register SignalR handler, start uptime clock.
 */
function initCopilot(connection, meetingMode, meetingIdParam) {
    copilotConnection = connection;
    copilotMeetingMode = meetingMode || 'sales';
    copilotMeetingId = meetingIdParam || null;
    copilotStartTime = Date.now();

    // Set mode badge. HRMS persists meeting_mode='recruit' for hiring
    // interviews; AIEngine still calls them 'interview'. Both should
    // surface as INTERVIEW on the HUD so a recruiter doesn't see "SALES"
    // mid-interview (which has happened — confusing/embarrassing in front
    // of candidates). Anything else falls back to SALES.
    const badge = document.getElementById('copilotModeBadge');
    if (badge) {
        const isInterview = copilotMeetingMode === 'interview' || copilotMeetingMode === 'recruit';
        badge.textContent = isInterview ? 'INTERVIEW' : 'SALES';
    }

    // Register SignalR handlers
    connection.on('CopilotInsight', handleCopilotInsight);
    connection.on('CopilotResearch', handleCopilotResearch);
    connection.on('CopilotModeChanged', handleCopilotModeChanged);
    connection.on('CopilotFrequencyChanged', handleCopilotFrequencyChanged);
    connection.on('CopilotModelChanged', handleCopilotModelChanged);
    connection.on('CopilotBotStatus', handleCopilotBotStatus);

    // Start uptime clock
    copilotUptimeInterval = setInterval(updateHudUptime, 1000);

    // Restore HUD position preference (left/center)
    restoreHudPosition();

    // Initialize mode + model toggle UI. The model toggle was never synced at
    // init, so the HUD highlighted whatever the HTML hardcoded (haiku) while the
    // tracked default was 'sonnet' — the recruiter couldn't tell which model was
    // actually answering.
    updateModeToggleUI('manual');
    updateModelToggleUI(copilotModel);

    // Set initial bot status to standby
    updateBotStatusUI(false);

    // Query initial bot status from server
    queryCopilotBotStatus();

    // Poll bot status every 10s as a fallback (in case we miss a SignalR event)
    copilotBotPollInterval = setInterval(queryCopilotBotStatus, 10000);

    console.log(`[Copilot HUD] Initialized for mode: ${copilotMeetingMode}`);
}

/**
 * Query copilot bot status from server via SignalR invoke.
 */
function queryCopilotBotStatus() {
    if (!copilotConnection || !copilotMeetingId) return;

    copilotConnection.invoke('GetCopilotBotStatus', copilotMeetingId)
        .then(active => {
            updateBotStatusUI(active);
        })
        .catch(err => {
            console.warn(`[Copilot HUD] Error querying bot status: ${err}`);
        });
}

/**
 * Handle CopilotBotStatus broadcast from server.
 */
function handleCopilotBotStatus(data) {
    console.log(`[Copilot HUD] Bot status: active=${data.active}`);
    updateBotStatusUI(data.active);
}

/**
 * Update the LIVE/STANDBY indicator in the HUD status bar.
 */
function updateBotStatusUI(active) {
    copilotBotActive = active;

    // Sync initial frequency to backend when bot first becomes active
    if (active && !copilotFrequencySynced && copilotConnection && copilotMeetingId) {
        copilotFrequencySynced = true;
        copilotConnection.invoke('SetCopilotFrequency', copilotMeetingId, copilotFrequency)
            .then(ok => { if (ok) console.log(`[Copilot HUD] Initial frequency synced: ${copilotFrequency}`); })
            .catch(err => { console.warn(`[Copilot HUD] Initial frequency sync failed: ${err}`); copilotFrequencySynced = false; });
    }

    const dot = document.getElementById('hudBotDot');
    const label = document.getElementById('hudBotLabel');

    if (dot) {
        if (active) {
            dot.classList.add('hud-bot-active');
            dot.classList.remove('hud-bot-inactive');
        } else {
            dot.classList.add('hud-bot-inactive');
            dot.classList.remove('hud-bot-active');
        }
    }

    if (label) {
        label.textContent = active ? 'LIVE' : 'STANDBY';
        if (active) {
            label.classList.add('hud-bot-active');
            label.classList.remove('hud-bot-inactive');
        } else {
            label.classList.add('hud-bot-inactive');
            label.classList.remove('hud-bot-active');
        }
        // Surface meaning on hover — without this, users see "STANDBY · 0 INSIGHTS"
        // mid-meeting and can't tell whether the bot crashed, the audio isn't being
        // captured, or it just hasn't generated anything yet. Same for LIVE — the
        // recruiter wants confirmation it's actually listening to the candidate.
        const tip = active
            ? 'Copilot is LIVE and listening to the conversation. Insights will appear as the model spots them.'
            : 'Copilot is on STANDBY. Audio is not being processed yet — the bot joins automatically once the meeting starts and at least one other participant is speaking.';
        label.title = tip;
        const dotEl = document.getElementById('hudBotDot');
        if (dotEl) dotEl.title = tip;
    }
}

/**
 * Handle incoming copilot insight from SignalR.
 * Uses a minimum display time to prevent rapid cards from being unreadable.
 */
function handleCopilotInsight(data) {
    const now = Date.now();
    const timeSinceLast = now - hudLastCardShownAt;

    // If a card was shown recently, queue this one
    if (timeSinceLast < HUD_MIN_DISPLAY_MS && hudLastCardShownAt > 0) {
        hudInsightQueue.push(data);
        // Schedule drain after remaining time
        const delay = HUD_MIN_DISPLAY_MS - timeSinceLast;
        setTimeout(drainInsightQueue, delay);
        console.log(`[Copilot HUD] Queued insight (${hudInsightQueue.length} pending, showing in ${delay}ms)`);
        return;
    }

    showInsightCard(data);
}

/**
 * Drain queued insights one at a time with minimum display spacing.
 */
function drainInsightQueue() {
    if (hudInsightQueue.length === 0) return;
    const now = Date.now();
    const timeSinceLast = now - hudLastCardShownAt;
    if (timeSinceLast < HUD_MIN_DISPLAY_MS) {
        // Still too soon, retry later
        setTimeout(drainInsightQueue, HUD_MIN_DISPLAY_MS - timeSinceLast);
        return;
    }
    const next = hudInsightQueue.shift();
    showInsightCard(next);
    // If more queued, schedule next
    if (hudInsightQueue.length > 0) {
        setTimeout(drainInsightQueue, HUD_MIN_DISPLAY_MS);
    }
}

/**
 * Render an insight card into the HUD feed.
 */
function showInsightCard(data) {
    copilotInsightCount++;
    hudLastCardShownAt = Date.now();

    const feed = document.getElementById('copilotInsights');
    if (!feed) return;

    const config = HUD_TYPE_CONFIG[data.type] || HUD_TYPE_CONFIG.suggestion;
    const isHigh = data.priority === 'high';

    // Create insight element
    const el = document.createElement('div');
    el.className = `hud-insight${isHigh ? ' hud-high' : ''}`;
    el.setAttribute('data-priority', data.priority || 'medium');
    el.setAttribute('data-type', data.type || 'suggestion');

    const time = new Date(data.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

    const hasSuggested = data.suggestedResponse && data.suggestedResponse.trim().length > 0;
    const tacticalPreview = hasSuggested ? extractTacticalPreview(data.suggestedResponse) : '';

    // Interview-mode drill-down chip — shown only when meeting is in interview
    // mode AND the insight carries a topic_label. Camel/snake handled because
    // SignalR may serialize either way depending on backend config.
    const topicLabel = data.topicLabel || data.topic_label || '';
    const followUpDepth = (typeof data.followUpDepth === 'number' ? data.followUpDepth :
                          (typeof data.follow_up_depth === 'number' ? data.follow_up_depth : 0));
    const topicExhausted = data.topicExhausted === true || data.topic_exhausted === true;
    // Match the badge logic, which treats 'recruit' as an interview alias — else
    // a recruit-mode meeting silently drops the drill-depth topic chip.
    const isInterview = copilotMeetingMode === 'interview' || copilotMeetingMode === 'recruit';
    let depthChip = '';
    if (isInterview && topicLabel) {
        // Colour ramps as drill depth grows: 0=cool/cyan, 1=neutral, 2=amber, 3=red
        // → host can see at a glance "we've drilled hard, time to wrap up".
        const depthColors = ['#00d4ff', '#94a3b8', '#fbbf24', '#ff4757'];
        const dotColor = topicExhausted ? '#22c55e' : depthColors[Math.min(followUpDepth, 3)];
        const depthText = topicExhausted ? '✓ done' : `drill ${followUpDepth}/3`;
        depthChip = `<span class="hud-topic-chip" title="Topic: ${escapeAttr(topicLabel)} — ${depthText}">` +
                      `<span class="hud-topic-dot" style="background:${dotColor}"></span>` +
                      `${escapeHtml(topicLabel)} · ${depthText}` +
                    `</span>`;
    }

    el.innerHTML =
        `<div class="hud-insight-header">` +
            `<span class="hud-glyph" style="color:${config.color}">${config.glyph}</span>` +
            `<span class="hud-type" style="color:${config.color}">${config.label}</span>` +
            (isHigh ? `<span class="hud-priority-tag">HIGH</span>` : '') +
            depthChip +
            `<span class="hud-time">${time}</span>` +
        `</div>` +
        `<div class="hud-insight-text">${escapeHtml(data.content)}</div>` +
        (hasSuggested
            ? `<div class="hud-suggested-response">` +
                `<div class="hud-suggested-label" onclick="toggleSuggestedResponse(this)">` +
                    `<span class="hud-suggested-chevron">\u25B8</span>` +
                    `<span class="hud-suggested-icon">\u{1F399}</span> SAY THIS` +
                    `<span class="hud-suggested-preview">${escapeHtml(tacticalPreview)}</span>` +
                    `<button class="hud-copy-btn" title="Copy to clipboard" onclick="copySuggestedResponse(this, event)">COPY</button>` +
                `</div>` +
                `<div class="hud-suggested-text">${escapeHtml(data.suggestedResponse)}</div>` +
              `</div>`
            : '');

    // Prepend newest on top — latest insights always visible first
    feed.prepend(el);

    // Fighter-jet rule: only ONE high-priority card at a time.
    // Demote all older HIGHs so the newest alert stays primary.
    if (isHigh) {
        const allHighs = feed.querySelectorAll('.hud-high');
        allHighs.forEach(card => {
            if (card === el) return; // keep the new one
            card.classList.remove('hud-high');
            card.setAttribute('data-priority', 'medium');
            const tag = card.querySelector('.hud-priority-tag');
            if (tag) tag.remove();
        });
    }

    // Remove glow from any previous "latest" card
    const prevNew = feed.querySelector('.hud-new');
    if (prevNew) prevNew.classList.remove('hud-new');

    // Trigger entrance animation + new-card glow on next frame
    requestAnimationFrame(() => {
        el.classList.add('hud-insight-in', 'hud-new');
        setTimeout(() => el.classList.remove('hud-new'), 2000);
    });

    // Auto-dismiss after timeout (autonomous mode uses shorter times)
    let dismissMs;
    if (copilotMode === 'autonomous') {
        dismissMs = isHigh ? HUD_DISMISS_AUTO_HIGH_MS : HUD_DISMISS_AUTO_MS;
    } else {
        dismissMs = isHigh ? HUD_DISMISS_HIGH_MS : HUD_DISMISS_MS;
    }
    setTimeout(() => dismissInsight(el), dismissMs);

    // Evict oldest from bottom if over max
    while (feed.children.length > HUD_MAX_VISIBLE) {
        const oldest = feed.children[feed.children.length - 1];
        if (oldest) oldest.remove();
    }

    // Update stats
    updateHudStats();

    // Flash button if HUD is hidden
    if (!copilotVisible) {
        const btn = document.getElementById('copilotBtn');
        if (btn) {
            btn.classList.add('copilot-flash');
            setTimeout(() => btn.classList.remove('copilot-flash'), 2000);
        }
    }

    // Earpiece mode: TTS whisper the suggested response to host
    if (copilotMode === 'earpiece' && hasSuggested) {
        speakTTS(data.suggestedResponse, 0.7);
    }
}

/**
 * Handle CopilotModeChanged broadcast from server.
 * Syncs local mode state when another client changes mode.
 */
function handleCopilotModeChanged(data) {
    console.log(`[Copilot HUD] Mode changed to: ${data.mode} by ${data.changedBy}`);
    const prevMode = copilotMode;
    copilotMode = data.mode;
    updateModeToggleUI(data.mode);

    // Cancel earpiece TTS when switching away from earpiece mode
    if (prevMode === 'earpiece' && data.mode !== 'earpiece') {
        cancelTTS();
    }
}

/**
 * Set copilot mode via SignalR invoke.
 */
function setCopilotMode(mode) {
    if (!copilotConnection || !copilotMeetingId) {
        console.warn('[Copilot HUD] Cannot set mode — no connection or meeting ID');
        return;
    }

    copilotConnection.invoke('SetCopilotMode', copilotMeetingId, mode)
        .then(success => {
            if (success) {
                copilotMode = mode;
                updateModeToggleUI(mode);
                console.log(`[Copilot HUD] Mode set to: ${mode}`);
            } else {
                console.warn(`[Copilot HUD] Failed to set mode: ${mode}`);
            }
        })
        .catch(err => {
            console.error(`[Copilot HUD] Error setting mode: ${err}`);
        });
}

/**
 * Set copilot insight frequency via SignalR invoke.
 */
function setCopilotFrequency(frequency) {
    if (!copilotConnection || !copilotMeetingId) {
        console.warn('[Copilot HUD] Cannot set frequency — no connection or meeting ID');
        return;
    }

    copilotConnection.invoke('SetCopilotFrequency', copilotMeetingId, frequency)
        .then(success => {
            if (success) {
                copilotFrequency = frequency;
                updateFreqToggleUI(frequency);
                console.log(`[Copilot HUD] Frequency set to: ${frequency}`);
            } else {
                console.warn(`[Copilot HUD] Failed to set frequency: ${frequency}`);
            }
        })
        .catch(err => {
            console.error(`[Copilot HUD] Error setting frequency: ${err}`);
        });
}

/**
 * Handle CopilotFrequencyChanged broadcast from server.
 */
function handleCopilotFrequencyChanged(data) {
    console.log(`[Copilot HUD] Frequency changed to: ${data.frequency} by ${data.changedBy}`);
    copilotFrequency = data.frequency;
    updateFreqToggleUI(data.frequency);
}

/**
 * Update frequency toggle button UI.
 */
function updateFreqToggleUI(frequency) {
    const buttons = document.querySelectorAll('.copilot-freq-btn');
    buttons.forEach(btn => {
        if (btn.getAttribute('data-freq') === frequency) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });
}

/**
 * Switch the per-turn copilot model mid-session. "sonnet" (default — better
 * follow-up quality, handles detailed prompts/tools without truncation) or
 * "haiku" (faster but misses nuance on the recruit-copilot's long prompt).
 */
let copilotModel = 'sonnet';
function setCopilotModel(model) {
    if (!copilotConnection || !copilotMeetingId) {
        console.warn('[Copilot HUD] Cannot set model — no connection or meeting ID');
        return;
    }
    if (model !== 'haiku' && model !== 'sonnet') return;

    // Cost guard — Sonnet at FAST cooldown can queue calls.
    if (model === 'sonnet' && copilotFrequency === 'fast' && window.Toast) {
        Toast.info('Sonnet at FAST may queue calls — consider NORMAL or CHILL.');
    }

    copilotConnection.invoke('SetCopilotModel', copilotMeetingId, model)
        .then(success => {
            if (success) {
                copilotModel = model;
                updateModelToggleUI(model);
                console.log(`[Copilot HUD] Model set to: ${model}`);
            } else {
                console.warn(`[Copilot HUD] Failed to set model: ${model}`);
            }
        })
        .catch(err => {
            console.error(`[Copilot HUD] Error setting model: ${err}`);
        });
}

function handleCopilotModelChanged(data) {
    console.log(`[Copilot HUD] Model changed to: ${data.model} by ${data.changedBy}`);
    copilotModel = data.model;
    updateModelToggleUI(data.model);
}

function updateModelToggleUI(model) {
    document.querySelectorAll('.copilot-model-btn').forEach(btn => {
        if (btn.getAttribute('data-model') === model) btn.classList.add('active');
        else btn.classList.remove('active');
    });
}
window.setCopilotModel = setCopilotModel;

/**
 * Update mode toggle button UI to reflect active mode.
 */
function updateModeToggleUI(mode) {
    const buttons = document.querySelectorAll('.copilot-mode-btn');
    buttons.forEach(btn => {
        if (btn.getAttribute('data-mode') === mode) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });

    // Hide frequency toggle in autonomous mode (frequency has no effect there)
    const freqToggle = document.getElementById('copilotFreqToggle');
    const freqSeparator = freqToggle?.previousElementSibling;
    if (freqToggle) freqToggle.style.display = mode === 'autonomous' ? 'none' : '';
    // The divider before the frequency toggle is class "hud-panel-divider" in the
    // HTML, not "hud-separator" — the old check never matched, so in autonomous
    // mode the frequency toggle hid but its divider was left dangling.
    if (freqSeparator?.classList.contains('hud-panel-divider')) freqSeparator.style.display = mode === 'autonomous' ? 'none' : '';

    // Update the HUD mode badge to show current copilot mode
    // (mirrors the same recruit↔interview alias as initCopilot)
    const badge = document.getElementById('copilotModeBadge');
    if (badge) {
        const isInterview = copilotMeetingMode === 'interview' || copilotMeetingMode === 'recruit';
        const modeLabel = isInterview ? 'INTERVIEW' : 'SALES';
        const modeIndicator = mode === 'manual' ? '' : mode === 'earpiece' ? ' | EAR' : ' | AUTO';
        badge.textContent = modeLabel + modeIndicator;
    }
}

/**
 * Speak text via Web Speech API TTS.
 * Used for earpiece mode (host hears suggestions whispered).
 * @param {string} text - Text to speak
 * @param {number} volume - Volume 0.0-1.0 (default 0.7 for earpiece whisper)
 */
function speakTTS(text, volume) {
    if (!window.speechSynthesis || !text) return;

    // Increment generation so stale onerror/onend callbacks from cancelled utterances
    // don't reset _ttsActive (race condition: cancel() triggers async onerror on old utterance)
    window._ttsGeneration = (window._ttsGeneration || 0) + 1;
    const gen = window._ttsGeneration;

    // Cancel any in-progress TTS
    window.speechSynthesis.cancel();
    if (window._ttsResumeInterval) clearInterval(window._ttsResumeInterval);

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.0;
    utterance.volume = volume || 0.7;
    utterance.pitch = 1.0;

    ttsSpeaking = true;
    window._ttsActive = true;
    window._ttsStartTime = Date.now();

    // Chrome bug workaround: speechSynthesis silently stops/pauses after ~15s.
    // Calling resume() every 3s keeps it alive. Don't self-destruct — let onend handle cleanup.
    window._ttsResumeInterval = setInterval(() => {
        if (window.speechSynthesis) window.speechSynthesis.resume();
    }, 3000);

    utterance.onend = () => {
        if (window._ttsGeneration !== gen) return; // stale callback from cancelled utterance
        ttsSpeaking = false;
        clearInterval(window._ttsResumeInterval);
        window._ttsResumeInterval = null;
        setTimeout(() => { window._ttsActive = false; }, 300);
    };
    utterance.onerror = (e) => {
        if (window._ttsGeneration !== gen) return; // stale callback from cancelled utterance
        if (e.error === 'canceled') return; // expected when we call cancel() for new utterance
        ttsSpeaking = false;
        clearInterval(window._ttsResumeInterval);
        window._ttsResumeInterval = null;
        window._ttsActive = false;
    };

    window.speechSynthesis.speak(utterance);
}

/**
 * Cancel any in-progress TTS.
 */
function cancelTTS() {
    if (window.speechSynthesis?.speaking) {
        window.speechSynthesis.cancel();
    }
    if (window._ttsResumeInterval) {
        clearInterval(window._ttsResumeInterval);
        window._ttsResumeInterval = null;
    }
    ttsSpeaking = false;
    window._ttsActive = false;
}

/**
 * Toggle HUD position: left (default) ↔ center (teleprompter).
 * Center mode positions insights at top-center of screen, near the webcam,
 * so the host's eyes stay on the camera line while reading.
 */
function toggleHudPosition() {
    const hud = document.getElementById('copilotHud');
    if (!hud) return;
    const isCenter = hud.classList.toggle('hud-center');
    // Persist preference
    try { localStorage.setItem('copilot_hud_position', isCenter ? 'center' : 'left'); } catch (e) {}
    // Update button tooltip
    const btn = document.getElementById('hudPositionBtn');
    if (btn) btn.title = isCenter ? 'Move HUD to left side' : 'Move HUD to center (teleprompter mode)';
}

/**
 * Restore HUD position from localStorage on init.
 */
function restoreHudPosition() {
    try {
        const pos = localStorage.getItem('copilot_hud_position');
        if (pos === 'center') {
            const hud = document.getElementById('copilotHud');
            if (hud) hud.classList.add('hud-center');
            const btn = document.getElementById('hudPositionBtn');
            if (btn) btn.title = 'Move HUD to left side';
        }
    } catch (e) {}
}

function dismissInsight(el) {
    if (!el || !el.parentNode) return;
    el.classList.add('hud-insight-out');
    setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el); }, 400);
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    // Quote-safe. Serialising a TEXT node to innerHTML escapes & < > and
    // nothing else, so a value containing a double quote used to break
    // straight out of any quoted HTML attribute it was interpolated into
    // — and lead names, company names and WhatsApp display names all
    // arrive from outside. Over-escaping is free in text context, where
    // &quot; renders as a plain quote.
    return div.innerHTML.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// HTML attribute escape — used for title="..." tooltips on the topic chip.
// Quote chars must be HTML-encoded inside attribute values.
function escapeAttr(text) {
    return String(text == null ? '' : text)
        .replace(/&/g, '&amp;').replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Only http/https URLs are safe as an href. Blocks javascript:/data:/etc.
// (research source URLs come from AIEngine web search — attacker-influenceable).
// The returned value must still pass through escapeAttr for the attribute context.
function safeHttpUrl(url) {
    const u = String(url == null ? '' : url).trim();
    return /^https?:\/\//i.test(u) ? u : '#';
}

/**
 * Extract a tactical one-liner from a full script.
 * Splits on sentence boundaries (. ! ?) and caps at 80 chars.
 */
function extractTacticalPreview(text) {
    if (!text) return '';
    const match = text.match(/^[^.!?]*[.!?]/);
    let preview = match ? match[0].trim() : text.trim();
    if (preview.length > 80) preview = preview.substring(0, 77) + '...';
    return preview;
}

function updateHudStats() {
    const countEl = document.getElementById('hudInsightCount');
    if (countEl) countEl.textContent = copilotInsightCount + ' INSIGHT' + (copilotInsightCount !== 1 ? 'S' : '');

    // Update toolbar badge
    const btn = document.getElementById('copilotBtn');
    if (!btn) return;
    let badge = btn.querySelector('.copilot-badge');
    if (!badge) {
        badge = document.createElement('span');
        badge.className = 'copilot-badge';
        btn.appendChild(badge);
    }
    badge.textContent = copilotInsightCount;
    badge.style.display = copilotInsightCount > 0 ? 'flex' : 'none';
}

function updateHudUptime() {
    if (!copilotStartTime) return;
    const el = document.getElementById('hudUptime');
    if (!el) return;
    const elapsed = Math.floor((Date.now() - copilotStartTime) / 1000);
    const m = Math.floor(elapsed / 60).toString().padStart(2, '0');
    const s = (elapsed % 60).toString().padStart(2, '0');
    el.textContent = m + ':' + s;
}

/**
 * Copy suggested response text to clipboard.
 */
function copySuggestedResponse(btn, event) {
    event.stopPropagation();
    const textEl = btn.closest('.hud-suggested-response')?.querySelector('.hud-suggested-text');
    if (!textEl) return;

    navigator.clipboard.writeText(textEl.textContent).then(() => {
        btn.textContent = 'COPIED';
        btn.classList.add('hud-copy-success');
        setTimeout(() => {
            btn.textContent = 'COPY';
            btn.classList.remove('hud-copy-success');
        }, 1500);
    }).catch(() => {
        // Fallback for non-HTTPS contexts
        const range = document.createRange();
        range.selectNodeContents(textEl);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        document.execCommand('copy');
        sel.removeAllRanges();
        btn.textContent = 'COPIED';
        setTimeout(() => { btn.textContent = 'COPY'; }, 1500);
    });
}

/**
 * Toggle the SAY THIS suggested response section open/closed.
 */
function toggleSuggestedResponse(labelEl) {
    const container = labelEl.closest('.hud-suggested-response');
    if (!container) return;
    container.classList.toggle('hud-suggested-expanded');
}

// ── Emotion Detection ──

const EMOTION_COLORS = {
    happy: '#2ed573',      // green
    surprised: '#ffa502',  // amber
    sad: '#70a1ff',        // blue
    neutral: '#a4b0be',    // gray
    angry: '#ff4757',      // red
    fearful: '#c084fc',    // light purple
    disgusted: '#ff6348'   // orange-red
};

/**
 * Initialize emotion detection. Lazy-loads face-api.js + models only on first HUD open.
 */
async function initEmotionDetection() {
    if (emotionDetector) return; // already initialized

    try {
        emotionDetector = new EmotionDetector();
        await emotionDetector.initialize();

        emotionDetector.onEmotionUpdate = updateEmotionDisplay;

        // Find the first remote participant's video element
        const remoteVideo = findRemoteParticipantVideo();
        if (remoteVideo) {
            emotionDetector.startAnalysis(remoteVideo);
        }

        // Send emotion data to backend every 3 seconds
        emotionSendInterval = setInterval(sendEmotionToBackend, 3000);

        console.log('[Copilot] Emotion detection initialized');
    } catch (e) {
        console.warn('[Copilot] Failed to init emotion detection:', e.message);
        emotionDetector = null;
    }
}

/**
 * Find the first remote participant's video element in the DOM.
 */
function findRemoteParticipantVideo() {
    // Remote participant tiles have class "video-participant" with id like "participant-{identity}"
    // Local participant has id "local-participant"
    const tiles = document.querySelectorAll('.video-participant:not(#local-participant)');
    for (const tile of tiles) {
        const video = tile.querySelector('video');
        if (video && video.srcObject) return video;
    }
    return null;
}

/**
 * Update the cockpit panel emotion indicator display.
 */
function updateEmotionDisplay(emotion, confidence, isLooking, allExpressions) {
    const labelEl = document.getElementById('hudEmotionLabel');
    const dotEl = document.getElementById('hudAttentionDot');

    if (!labelEl || !dotEl) return;

    if (emotion) {
        const color = EMOTION_COLORS[emotion] || EMOTION_COLORS.neutral;
        labelEl.textContent = emotion.toUpperCase();
        labelEl.style.color = color;
        latestEmotion = { emotion, confidence, isLooking };
    } else {
        labelEl.textContent = 'NO FACE';
        labelEl.style.color = '';
        latestEmotion = { emotion: null, confidence: 0, isLooking: false };
    }

    if (isLooking) {
        dotEl.classList.add('looking');
    } else {
        dotEl.classList.remove('looking');
    }
}

/**
 * Send latest emotion data to backend via SignalR (every 3s).
 */
function sendEmotionToBackend() {
    if (copilotConnection && copilotMeetingId && latestEmotion.emotion) {
        copilotConnection.invoke('FeedEmotionData', copilotMeetingId,
            latestEmotion.emotion,
            latestEmotion.confidence,
            latestEmotion.isLooking
        ).catch(err => console.warn('[Copilot] Emotion send failed:', err));
    }
}

/**
 * Re-target emotion detector to a new remote participant video.
 * Called when participants join/leave.
 */
function retargetEmotionDetector() {
    if (!emotionDetector || !emotionDetector.loaded) return;

    emotionDetector.stopAnalysis();
    const remoteVideo = findRemoteParticipantVideo();
    if (remoteVideo) {
        emotionDetector.startAnalysis(remoteVideo);
        console.log('[Copilot] Emotion detector re-targeted to new participant');
    }
}

/**
 * Stop emotion detection and clean up intervals.
 */
function stopEmotionDetection() {
    if (emotionDetector) {
        emotionDetector.stopAnalysis();
    }
    if (emotionSendInterval) {
        clearInterval(emotionSendInterval);
        emotionSendInterval = null;
    }
}

// ── Research Intel Panel ──

/**
 * Handle incoming research result from SignalR.
 */
function handleCopilotResearch(data) {
    console.log(`[Copilot HUD] Research received: query="${data.query}", ${data.sources?.length || 0} sources`);
    researchCount++;
    showResearchCard(data);

    // Update count badge
    const countEl = document.getElementById('hudResearchCount');
    if (countEl) countEl.textContent = researchCount;

    // Show notification dot if panel is hidden
    if (!researchPanelVisible) {
        const dot = document.getElementById('hudResearchDot');
        if (dot) dot.style.display = '';
    }
}

/**
 * Render a research card into the intel feed.
 * Default collapsed: query + first-line preview. Click header to expand.
 */
function showResearchCard(data) {
    const feed = document.getElementById('hudResearchFeed');
    if (!feed) return;

    const card = document.createElement('div');
    card.className = 'hud-research-card';

    const time = new Date(data.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

    // Extract first line of summary as collapsed preview
    const summaryText = data.summary || '';
    const firstLine = summaryText.split('\n')[0] || '';
    const summaryPreview = firstLine.length > 100 ? firstLine.substring(0, 97) + '...' : firstLine;

    let sourcesHtml = '';
    if (data.sources && data.sources.length > 0) {
        sourcesHtml = '<div class="hud-research-card-sources">';
        for (const src of data.sources) {
            const safeTitle = escapeHtml(src.title || src.url || 'Source');
            // escapeHtml (textContent variant) does NOT encode double-quotes, so a
            // URL with a " broke out of href="...". Scheme-validate then attr-escape.
            const safeUrl = escapeAttr(safeHttpUrl(src.url));
            sourcesHtml += `<a class="hud-research-source-link" href="${safeUrl}" target="_blank" rel="noopener">${safeTitle}</a>`;
        }
        sourcesHtml += '</div>';
    }

    card.innerHTML =
        `<div class="hud-research-card-header" onclick="toggleResearchCard(this)">` +
            `<span class="hud-research-card-chevron">\u25B8</span>` +
            `<span class="hud-research-card-query">${escapeHtml(data.query || '')}</span>` +
            `<span class="hud-research-card-preview">${escapeHtml(summaryPreview)}</span>` +
            `<span class="hud-research-card-time">${time}</span>` +
        `</div>` +
        `<div class="hud-research-card-details">` +
            (data.triggeredBy ? `<div class="hud-research-card-reason">${escapeHtml(data.triggeredBy)}</div>` : '') +
            `<div class="hud-research-card-summary">${escapeHtml(summaryText)}</div>` +
            sourcesHtml +
        `</div>`;

    // Prepend newest on top
    feed.prepend(card);
}

/**
 * Toggle a research card between collapsed and expanded.
 */
function toggleResearchCard(headerEl) {
    const card = headerEl.closest('.hud-research-card');
    if (card) card.classList.toggle('hud-research-expanded');
}

/**
 * Toggle research intel panel visibility.
 */
function toggleResearchPanel() {
    const panel = document.getElementById('hudResearchPanel');
    const btn = document.getElementById('hudResearchToggle');
    if (!panel) return;

    researchPanelVisible = !researchPanelVisible;
    panel.style.display = researchPanelVisible ? 'flex' : 'none';

    if (btn) {
        if (researchPanelVisible) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    }

    // Clear notification dot when opening
    if (researchPanelVisible) {
        const dot = document.getElementById('hudResearchDot');
        if (dot) dot.style.display = 'none';
    }
}

/**
 * Clear all research cards from the panel.
 */
function clearResearchPanel() {
    const feed = document.getElementById('hudResearchFeed');
    if (feed) feed.innerHTML = '';
    researchCount = 0;
    const countEl = document.getElementById('hudResearchCount');
    if (countEl) countEl.textContent = '0';
}

/**
 * Toggle HUD visibility. Doesn't conflict with chat (overlay, not sidebar).
 */
function toggleCopilotPanel() {
    const hud = document.getElementById('copilotHud');
    if (!hud) return;

    copilotVisible = !copilotVisible;
    hud.style.display = copilotVisible ? 'block' : 'none';

    // Query bot status when opening HUD
    if (copilotVisible) {
        queryCopilotBotStatus();
        // Lazy-init emotion detection on first HUD open
        initEmotionDetection();
    }
}
