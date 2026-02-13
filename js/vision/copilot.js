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
let copilotVisible = false;
let copilotInsightCount = 0;
let copilotStartTime = null;
let copilotUptimeInterval = null;
let ttsSpeaking = false;

// Max visible insights in the feed before oldest auto-removes
const HUD_MAX_VISIBLE = 5;
// Auto-dismiss timeouts per mode (autonomous is faster — host isn't reading them as closely)
const HUD_DISMISS_MS = 25000;
const HUD_DISMISS_HIGH_MS = 45000;
const HUD_DISMISS_AUTO_MS = 8000;
const HUD_DISMISS_AUTO_HIGH_MS = 12000;

const HUD_TYPE_CONFIG = {
    objection:  { label: 'OBJECTION',  glyph: '\u25B2', color: '#ff4757' },  // red triangle
    suggestion: { label: 'SUGGEST',    glyph: '\u25C6', color: '#2ed573' },  // green diamond
    sentiment:  { label: 'SENTIMENT',  glyph: '\u25CF', color: '#ffa502' },  // amber circle
    key_moment: { label: 'KEY MOMENT', glyph: '\u2605', color: '#3742fa' },  // blue star
    summary:    { label: 'SUMMARY',    glyph: '\u2500', color: '#a4b0be' }   // gray line
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

    // Start uptime clock
    copilotUptimeInterval = setInterval(updateHudUptime, 1000);

    // Initialize mode toggle UI
    updateModeToggleUI('manual');

    console.log(`[Copilot HUD] Initialized for mode: ${copilotMeetingMode}`);
}

/**
 * Handle incoming copilot insight from SignalR.
 */
function handleCopilotInsight(data) {
    copilotInsightCount++;
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

    feed.appendChild(el);

    // Trigger entrance animation on next frame
    requestAnimationFrame(() => el.classList.add('hud-insight-in'));

    // Auto-dismiss after timeout (autonomous mode uses shorter times)
    let dismissMs;
    if (copilotMode === 'autonomous') {
        dismissMs = isHigh ? HUD_DISMISS_AUTO_HIGH_MS : HUD_DISMISS_AUTO_MS;
    } else {
        dismissMs = isHigh ? HUD_DISMISS_HIGH_MS : HUD_DISMISS_MS;
    }
    setTimeout(() => dismissInsight(el), dismissMs);

    // Evict oldest if over max — force-remove immediately (no animation) to prevent pile-up
    while (feed.children.length > HUD_MAX_VISIBLE) {
        const oldest = feed.children[0];
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

    // Cancel any in-progress TTS
    window.speechSynthesis.cancel();
    if (window._ttsResumeInterval) clearInterval(window._ttsResumeInterval);

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.0;
    utterance.volume = volume || 0.7;
    utterance.pitch = 1.0;

    ttsSpeaking = true;
    window._ttsActive = true;

    // Chrome bug workaround: speechSynthesis silently stops after ~15s.
    // Calling resume() every 5s keeps it alive.
    window._ttsResumeInterval = setInterval(() => {
        if (window.speechSynthesis?.speaking) {
            window.speechSynthesis.resume();
        } else {
            clearInterval(window._ttsResumeInterval);
            window._ttsResumeInterval = null;
        }
    }, 5000);

    utterance.onend = () => {
        ttsSpeaking = false;
        clearInterval(window._ttsResumeInterval);
        window._ttsResumeInterval = null;
        setTimeout(() => { window._ttsActive = false; }, 300);
    };
    utterance.onerror = () => {
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

/**
 * Toggle HUD visibility. Doesn't conflict with chat (overlay, not sidebar).
 */
function toggleCopilotPanel() {
    const hud = document.getElementById('copilotHud');
    if (!hud) return;

    copilotVisible = !copilotVisible;
    hud.style.display = copilotVisible ? 'block' : 'none';
}
