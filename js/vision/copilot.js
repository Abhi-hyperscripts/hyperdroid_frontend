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
    objection:  { label: 'OBJECTION',  glyph: '\u25B2', color: '#ff4757' },  // red triangle
    suggestion: { label: 'SUGGEST',    glyph: '\u25C6', color: '#00d4ff' },  // neon cyan diamond
    sentiment:  { label: 'SENTIMENT',  glyph: '\u25CF', color: '#ffa502' },  // amber circle
    key_moment: { label: 'KEY MOMENT', glyph: '\u2605', color: '#a78bfa' },  // bright purple star
    summary:    { label: 'SUMMARY',    glyph: '\u2500', color: '#94a3b8' }   // light slate line
};

/**
 * Initialize copilot HUD: register SignalR handler, start uptime clock.
 */
function initCopilot(connection, meetingMode, meetingIdParam) {
    copilotConnection = connection;
    copilotMeetingMode = meetingMode || 'sales';
    copilotMeetingId = meetingIdParam || null;
    copilotStartTime = Date.now();

    // Set mode badge
    const badge = document.getElementById('copilotModeBadge');
    if (badge) {
        badge.textContent = (copilotMeetingMode === 'interview' ? 'INTERVIEW' : 'SALES');
    }

    // Register SignalR handlers
    connection.on('CopilotInsight', handleCopilotInsight);
    connection.on('CopilotModeChanged', handleCopilotModeChanged);
    connection.on('CopilotFrequencyChanged', handleCopilotFrequencyChanged);
    connection.on('CopilotBotStatus', handleCopilotBotStatus);

    // Start uptime clock
    copilotUptimeInterval = setInterval(updateHudUptime, 1000);

    // Restore HUD position preference (left/center)
    restoreHudPosition();

    // Initialize mode toggle UI
    updateModeToggleUI('manual');

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

    const time = new Date(data.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

    const hasSuggested = data.suggestedResponse && data.suggestedResponse.trim().length > 0;

    el.innerHTML =
        `<div class="hud-insight-header">` +
            `<span class="hud-glyph" style="color:${config.color}">${config.glyph}</span>` +
            `<span class="hud-type" style="color:${config.color}">${config.label}</span>` +
            (isHigh ? `<span class="hud-priority-tag">HIGH</span>` : '') +
            `<span class="hud-time">${time}</span>` +
        `</div>` +
        `<div class="hud-insight-text">${escapeHtml(data.content)}</div>` +
        (hasSuggested
            ? `<div class="hud-suggested-response">` +
                `<div class="hud-suggested-label">` +
                    `<span class="hud-suggested-icon">\u{1F399}</span> SAY THIS` +
                    `<button class="hud-copy-btn" title="Copy to clipboard" onclick="copySuggestedResponse(this, event)">COPY</button>` +
                `</div>` +
                `<div class="hud-suggested-text">${escapeHtml(data.suggestedResponse)}</div>` +
              `</div>`
            : '');

    // Prepend newest on top — latest insights always visible first
    feed.prepend(el);

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
    if (freqSeparator?.classList.contains('hud-separator')) freqSeparator.style.display = mode === 'autonomous' ? 'none' : '';

    // Update the HUD mode badge to show current copilot mode
    const badge = document.getElementById('copilotModeBadge');
    if (badge) {
        const modeLabel = copilotMeetingMode === 'interview' ? 'INTERVIEW' : 'SALES';
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
    return div.innerHTML;
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

// ── Emotion Detection ──

const EMOTION_EMOJI = {
    happy: '\u{1F60A}', surprised: '\u{1F62E}', sad: '\u{1F614}', neutral: '\u{1F610}',
    angry: '\u{1F620}', fearful: '\u{1F628}', disgusted: '\u{1F922}'
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
    const emojiEl = document.getElementById('hudEmotionEmoji');
    const labelEl = document.getElementById('hudEmotionLabel');
    const dotEl = document.getElementById('hudAttentionDot');

    if (!emojiEl || !labelEl || !dotEl) return;

    if (emotion) {
        emojiEl.textContent = EMOTION_EMOJI[emotion] || '\u{1F610}';
        labelEl.textContent = emotion.toUpperCase();
        latestEmotion = { emotion, confidence, isLooking };
    } else {
        emojiEl.textContent = '--';
        labelEl.textContent = 'NO FACE';
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
