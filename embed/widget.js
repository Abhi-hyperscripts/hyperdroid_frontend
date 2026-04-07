/**
 * Ragenaizer Chat Widget v4
 * Embeddable Shadow DOM chat widget — supports two modes:
 *
 * 1. EMBED MODE (default) — Research chatbot on external websites
 *    <script src="widget.js" data-key="YOUR_EMBED_KEY" data-api="https://research.ragenaizer.com"></script>
 *
 * 2. COPILOT MODE — AI assistant inside the HyperDroid app
 *    <script src="widget.js" data-mode="copilot" data-api="https://localhost:5126"
 *            data-title="LMS Assistant" data-theme="dark"></script>
 *
 * Copilot mode attributes:
 *   data-mode="copilot"  — activates copilot behavior
 *   data-api             — backend service URL (e.g., LMS, Accounts, HRMS)
 *   data-title           — widget title (default: "Assistant")
 *   data-theme           — "dark" or "light" (default: "dark")
 *   data-logo            — custom logo URL (optional)
 *
 * Features:
 *   - marked.js for markdown rendering
 *   - ApexCharts for 15+ chart types
 *   - Adaptive streaming reveal with cursor (embed mode)
 *   - JSON response with instant display (copilot mode)
 *   - Progress step indicators
 *   - Resizable chat window (size persisted in localStorage)
 *   - Theme support (dark/light)
 */
(function () {
    'use strict';

    if (window.__ragenaizer_widget_loaded) return;
    window.__ragenaizer_widget_loaded = true;

    const scriptEl = document.currentScript;
    const widgetMode = scriptEl?.getAttribute('data-mode') || 'embed'; // 'embed' or 'copilot'
    const isCopilotMode = widgetMode === 'copilot';

    const embedKey = scriptEl?.getAttribute('data-key') || '';
    const shareToken = scriptEl?.getAttribute('data-share-token') || '';

    if (!isCopilotMode && !embedKey) { console.warn('[Ragenaizer] Missing data-key on embed script.'); return; }

    const explicitApi = scriptEl?.getAttribute('data-api') || '';
    const scriptSrc = scriptEl?.src || '';
    const scriptOrigin = scriptSrc ? new URL(scriptSrc).origin : '';
    // In copilot mode: use data-api, or auto-detect from CONFIG (set by config.js)
    // data-service tells us which service to use from CONFIG (e.g., "lms", "accounts", "hrms")
    const copilotService = scriptEl?.getAttribute('data-service') || '';
    // CONFIG is a global const from config.js — access via typeof check to avoid ReferenceError
    const appConfig = (typeof CONFIG !== 'undefined') ? CONFIG : null;
    const baseUrl = explicitApi
        || (isCopilotMode && copilotService && appConfig?.endpoints?.[copilotService])
        || (isCopilotMode && appConfig?.endpoints?.lms)
        || scriptOrigin;
    if (!baseUrl) { console.warn('[Ragenaizer] Set data-api attribute.'); return; }

    const logoUrl = scriptEl?.getAttribute('data-logo') || `${scriptOrigin}/assets/logo-icon-white.png`;

    // Copilot mode settings
    const copilotTitle = scriptEl?.getAttribute('data-title') || 'Assistant';
    const copilotTheme = scriptEl?.getAttribute('data-theme') || 'light';

    // Helper to get JWT token for copilot mode (reads from the host app's auth)
    function getCopilotJwt() {
        if (!isCopilotMode) return null;
        try {
            // Use the app's getAuthToken() if available, or read from localStorage directly
            if (typeof getAuthToken === 'function') return getAuthToken();
            // Fallback: read from known storage key (ragenaizer_authToken)
            const prefix = window.CONFIG?.storagePrefix || 'ragenaizer_';
            return localStorage.getItem(`${prefix}authToken`);
        } catch {}
        return null;
    }

    // Helper to detect current page context for copilot
    function getCurrentPageContext() {
        if (!isCopilotMode) return '';
        const path = window.location.pathname;
        // Extract meaningful context: "/pages/lms/courses.html" → "lms/courses"
        const match = path.match(/\/pages\/(.+?)\.html/);
        return match ? match[1] : path;
    }

    // Session ID — use sessionStorage so each tab/window gets a fresh session.
    // localStorage was causing stale sessions that persisted forever, leaking
    // old conversation context into new visits.
    // In copilot mode, session is per-user (managed server-side), so we use a fixed key.
    const storageKey = isCopilotMode ? 'copilot_session' : `ragenaizer_session_${embedKey}`;
    function generateSessionId() {
        return crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
            const r = Math.random() * 16 | 0;
            return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
        });
    }
    let sessionId = sessionStorage.getItem(storageKey);
    if (!sessionId) {
        sessionId = generateSessionId();
        sessionStorage.setItem(storageKey, sessionId);
    }
    // Clean up stale localStorage key from previous versions
    try { localStorage.removeItem(storageKey); } catch {}

    // Persisted window size
    const sizeKey = isCopilotMode ? 'copilot_size' : `ragenaizer_size_${embedKey}`;
    let savedSize = null;
    try { savedSize = JSON.parse(localStorage.getItem(sizeKey)); } catch {}
    const defaultW = 420, defaultH = 600;
    const minW = 340, minH = 400, maxW = 2400, maxH = 1600;
    let winW = savedSize?.w || defaultW;
    let winH = savedSize?.h || defaultH;

    // ========================================
    // LOAD EXTERNAL LIBRARIES
    // ========================================
    function loadScript(src) {
        return new Promise((resolve, reject) => {
            const s = document.createElement('script');
            s.src = src; s.async = true; s.onload = resolve; s.onerror = reject;
            document.head.appendChild(s);
        });
    }

    // ========================================
    // CHART COLORS & TOOL LABELS
    // ========================================
    const CHART_COLORS = ['#00d4ff', '#ff6b6b', '#51cf66', '#ffd43b', '#cc5de8', '#20c997', '#ff922b', '#748ffc'];
    const TOOL_LABELS = {
        execute_query: 'Running query',
        execute_function: 'Running analysis',
        search_questions: 'Searching questions',
        get_variable_details: 'Looking up metadata',
        create_visualization: 'Creating chart',
        load_dashboard_context: 'Loading dashboard context'
    };

    // ========================================
    // ASYNC INIT — fetch info first, then build widget
    // ========================================
    (async () => {
        // Load libraries in parallel with info fetch
        const libPromise = (async () => {
            try { if (typeof marked === 'undefined') await loadScript('https://cdn.jsdelivr.net/npm/marked@15.0.7/marked.min.js'); } catch {}
            try { if (typeof ApexCharts === 'undefined') await loadScript('https://cdn.jsdelivr.net/npm/apexcharts@4.3.0/dist/apexcharts.min.js'); } catch {}
        })();

        // Copilot mode: check if tenant has an active AI API key before rendering
        if (isCopilotMode) {
            try {
                const jwt = getCopilotJwt();
                if (jwt) {
                    const authBase = window.CONFIG?.authApiBaseUrl || window.appConfig?.endpoints?.auth || 'https://localhost:5098';
                    const keysRes = await fetch(`${authBase}/api/tenant-api-keys`, {
                        headers: { 'Authorization': `Bearer ${jwt}` }
                    });
                    if (keysRes.ok) {
                        const data = await keysRes.json();
                        const keysList = data.keys || data;
                        const hasActiveAiKey = Array.isArray(keysList) && keysList.some(k =>
                            (k.isActive || k.is_active) && ['anthropic', 'openai'].includes((k.provider || '').toLowerCase())
                        );
                        if (!hasActiveAiKey) {
                            window.__ragenaizer_widget_loaded = false;
                            return;
                        }
                    }
                }
            } catch { /* Auth unreachable — still show widget, will fail gracefully on use */ }
        }

        // Fetch embed info (theme, name, colors) — skip in copilot mode
        let info;
        if (isCopilotMode) {
            // In copilot mode, use data attributes for theme/branding
            info = { theme: copilotTheme, name: copilotTitle };
        } else {
            try {
                const r = await fetch(`${baseUrl}/api/embed/info/${embedKey}`);
                if (!r.ok) { window.__ragenaizer_widget_loaded = false; return; }
                info = await r.json();
            } catch { window.__ragenaizer_widget_loaded = false; return; }
        }

        await libPromise;

        // ========================================
        // THEME FROM BACKEND (or data attributes in copilot mode)
        // ========================================
        const theme = info.theme || 'light';
        const isDark = theme !== 'light';
        const C = isDark ? {
            bgCard: 'rgba(22, 25, 38, 0.88)', bgPanel: 'rgba(28, 32, 48, 0.9)', bgMessages: '#161924',
            bgSurface: '#282d40', bgHover: '#303654',
            text: '#eceef5', textSecondary: '#8b90a8', textMuted: '#555b75',
            border: 'rgba(255,255,255,0.06)', borderLight: '#333952',
            accent: '#00b8d9', accentDim: 'rgba(0,184,217,0.1)',
            headerBg: null,
            userBg: '#00b8d9', userText: '#fff',
            aiBg: 'rgba(255,255,255,0.03)', aiBorder: 'rgba(255,255,255,0.06)',
            inputBg: 'rgba(255,255,255,0.04)', inputBorder: 'rgba(255,255,255,0.08)',
            scrollThumb: 'rgba(255,255,255,0.08)',
            error: '#f87171', codeBlock: 'rgba(0,0,0,0.3)',
            tableBorder: 'rgba(255,255,255,0.06)', tableHeaderBg: 'rgba(255,255,255,0.03)', tableStripeBg: 'rgba(255,255,255,0.015)',
            chartFg: '#8b90a8', chartGrid: 'rgba(255,255,255,0.05)',
            chartLegend: '#8b90a8', chartDataLabel: '#c0c3d2', chartStroke: '#161924'
        } : {
            bgCard: 'rgba(255,255,255,0.92)', bgPanel: 'rgba(247,248,250,0.95)', bgMessages: '#f9fafb',
            bgSurface: '#f0f1f5', bgHover: '#e9ebf0',
            text: '#111827', textSecondary: '#6b7280', textMuted: '#9ca3af',
            border: 'rgba(0,0,0,0.06)', borderLight: '#d1d5db',
            accent: '#3b82f6', accentDim: 'rgba(59,130,246,0.08)',
            headerBg: '#3b82f6',
            userBg: '#3b82f6', userText: '#fff',
            aiBg: 'rgba(0,0,0,0.02)', aiBorder: 'rgba(0,0,0,0.05)',
            inputBg: '#ffffff', inputBorder: 'rgba(0,0,0,0.1)',
            scrollThumb: 'rgba(0,0,0,0.08)',
            error: '#ef4444', codeBlock: 'rgba(0,0,0,0.04)',
            tableBorder: 'rgba(0,0,0,0.06)', tableHeaderBg: 'rgba(0,0,0,0.02)', tableStripeBg: 'rgba(0,0,0,0.01)',
            chartFg: '#6b7280', chartGrid: 'rgba(0,0,0,0.06)',
            chartLegend: '#6b7280', chartDataLabel: '#374151', chartStroke: '#ffffff'
        };

        const projectName = isCopilotMode ? copilotTitle : (info.name || info.project_name || 'Research Assistant');

        // ========================================
        // HOST + SHADOW DOM
        // ========================================
        const host = document.createElement('div');
        host.id = 'ragenaizer-chat-widget';
        host.style.cssText = 'all:initial; position:fixed; bottom:0; right:0; z-index:2147483647; font-family:"SF Pro Display",-apple-system,"Segoe UI",system-ui,sans-serif;';
        document.body.appendChild(host);
        const shadow = host.attachShadow({ mode: 'closed' });

        // ========================================
        // STYLES — Clean Professional SaaS
        // ========================================
        const style = document.createElement('style');
        style.textContent = `
            *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

            /* ---- BUBBLE BUTTON ---- */
            .rz-bubble {
                position: fixed; bottom: 24px; right: 24px;
                width: 56px; height: 56px; border-radius: 16px;
                background: ${C.accent}; border: none; cursor: pointer;
                display: flex; align-items: center; justify-content: center;
                box-shadow: 0 4px 14px rgba(0,0,0,0.15), 0 1px 3px rgba(0,0,0,0.08);
                transition: transform 0.2s ease, box-shadow 0.2s ease;
                z-index: 10;
            }
            .rz-bubble:hover { transform: translateY(-2px); box-shadow: 0 6px 20px rgba(0,0,0,0.2), 0 2px 4px rgba(0,0,0,0.1); }
            .rz-bubble:active { transform: translateY(0); }
            .rz-bubble img { width: 26px; height: 26px; object-fit: contain; }
            .rz-bubble .rz-fallback-icon { width: 24px; height: 24px; fill: #fff; }

            /* ---- WINDOW WRAPPER ---- */
            .rz-window-wrap {
                position: fixed; bottom: 92px; right: 24px;
                width: ${winW}px; height: ${winH}px;
                max-width: calc(100vw - 32px); max-height: calc(100vh - 120px);
                min-width: ${minW}px; min-height: ${minH}px;
                border-radius: 16px;
                display: none; opacity: 0;
                transform: translateY(8px);
                transition: opacity 0.2s ease, transform 0.2s ease;
                box-shadow: 0 16px 48px rgba(0,0,0,0.2), 0 4px 12px rgba(0,0,0,0.1), 0 0 0 1px ${C.border};
                z-index: 5;
            }
            .rz-window-wrap.open { opacity: 1; transform: translateY(0); }

            .rz-window {
                width: 100%; height: 100%;
                background: ${C.bgCard};
                backdrop-filter: blur(20px) saturate(1.2); -webkit-backdrop-filter: blur(20px) saturate(1.2);
                border-radius: 16px;
                display: flex; flex-direction: column;
                overflow: hidden;
                font-size: 14px; color: ${C.text}; line-height: 1.55;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
            }

            /* ---- RESIZE HANDLE (invisible but functional at top-left) ---- */
            .rz-resize {
                position: absolute; top: 0; left: 0;
                width: 28px; height: 28px;
                cursor: nw-resize; z-index: 20;
            }

            /* ---- HEADER ---- */
            .rz-header {
                display: flex; align-items: center; gap: 10px;
                padding: 14px 16px;
                background: ${C.headerBg || C.accent};
                flex-shrink: 0; position: relative;
            }
            .rz-header-tooltip {
                position: absolute; top: 100%; left: 10px;
                background: #1e293b; color: #e2e8f0; font-size: 11px;
                padding: 5px 10px; border-radius: 4px; white-space: nowrap;
                pointer-events: none; opacity: 0; transition: opacity 0.2s;
                box-shadow: 0 2px 8px rgba(0,0,0,0.2); z-index: 30;
                margin-top: 6px;
            }
            .rz-header-tooltip::before {
                content: ''; position: absolute; top: -4px; left: 8px;
                width: 8px; height: 8px; background: #1e293b;
                transform: rotate(45deg);
            }
            .rz-header:hover .rz-header-tooltip { opacity: 1; }
            .rz-header-logo { width: 22px; height: 22px; object-fit: contain; border-radius: 4px; flex-shrink: 0; }
            .rz-header-title {
                font-size: 14px; font-weight: 600; color: #fff;
                overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1;
            }
            .rz-header-close {
                background: rgba(255,255,255,0.15); border: none; cursor: pointer;
                color: rgba(255,255,255,0.8); padding: 5px; display: flex;
                border-radius: 6px; transition: background 0.15s, color 0.15s;
            }
            .rz-header-close:hover { background: rgba(255,255,255,0.25); color: #fff; }
            .rz-header-close svg { width: 14px; height: 14px; stroke: currentColor; fill: none; }

            /* ---- MESSAGES ---- */
            .rz-messages {
                flex: 1; overflow-y: auto; padding: 16px;
                display: flex; flex-direction: column; gap: 12px;
                background: ${C.bgMessages};
            }
            .rz-messages::-webkit-scrollbar { width: 5px; }
            .rz-messages::-webkit-scrollbar-track { background: transparent; }
            .rz-messages::-webkit-scrollbar-thumb { background: ${C.scrollThumb}; border-radius: 3px; }

            .rz-msg { max-width: 85%; animation: rz-msg-in 0.2s ease; }
            .rz-msg.user { align-self: flex-end; }
            .rz-msg.ai { align-self: flex-start; max-width: 100%; }
            @keyframes rz-msg-in {
                from { opacity: 0; transform: translateY(6px); }
                to { opacity: 1; transform: translateY(0); }
            }

            .rz-msg.user .rz-msg-bubble {
                padding: 10px 14px; border-radius: 16px 16px 4px 16px;
                background: ${C.userBg}; color: ${C.userText};
                font-size: 13.5px; line-height: 1.5;
                word-wrap: break-word; overflow-wrap: break-word;
            }
            .rz-msg.ai .rz-msg-bubble {
                padding: 12px 14px; border-radius: 4px 16px 16px 16px;
                background: ${C.aiBg}; color: ${C.text};
                font-size: 13.5px; line-height: 1.6;
                border: 1px solid ${C.aiBorder};
                word-wrap: break-word; overflow-wrap: break-word;
            }

            /* ---- MARKDOWN ---- */
            .rz-msg.ai .rz-msg-bubble p { margin: 0 0 8px 0; }
            .rz-msg.ai .rz-msg-bubble p:last-child { margin-bottom: 0; }
            .rz-msg.ai .rz-msg-bubble strong { font-weight: 600; }
            .rz-msg.ai .rz-msg-bubble a { color: ${C.accent}; text-decoration: none; }
            .rz-msg.ai .rz-msg-bubble a:hover { text-decoration: underline; }
            .rz-msg.ai .rz-msg-bubble code {
                background: ${C.codeBlock}; padding: 2px 6px; border-radius: 4px;
                font-size: 12px; font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace;
            }
            .rz-msg.ai .rz-msg-bubble pre {
                background: ${C.codeBlock}; padding: 12px 14px; border-radius: 8px;
                overflow-x: auto; margin: 8px 0; font-size: 12px; line-height: 1.5;
                border: 1px solid ${C.border};
            }
            .rz-msg.ai .rz-msg-bubble pre code { background: none; padding: 0; font-size: inherit; }
            .rz-msg.ai .rz-msg-bubble ul, .rz-msg.ai .rz-msg-bubble ol { margin: 6px 0; padding-left: 20px; }
            .rz-msg.ai .rz-msg-bubble li { margin-bottom: 4px; }
            .rz-msg.ai .rz-msg-bubble h1, .rz-msg.ai .rz-msg-bubble h2, .rz-msg.ai .rz-msg-bubble h3 {
                margin: 14px 0 6px 0; font-weight: 600;
            }
            .rz-msg.ai .rz-msg-bubble h1 { font-size: 16px; }
            .rz-msg.ai .rz-msg-bubble h2 { font-size: 15px; }
            .rz-msg.ai .rz-msg-bubble h3 { font-size: 14px; }
            .rz-msg.ai .rz-msg-bubble blockquote {
                border-left: 3px solid ${C.accent}; padding-left: 12px;
                margin: 8px 0; color: ${C.textSecondary};
            }
            .rz-msg.ai .rz-msg-bubble hr { border: none; border-top: 1px solid ${C.border}; margin: 10px 0; }

            /* ---- TABLES ---- */
            .rz-msg.ai .rz-msg-bubble table {
                width: 100%; border-collapse: collapse; margin: 10px 0;
                font-size: 12px; font-variant-numeric: tabular-nums;
            }
            .rz-msg.ai .rz-msg-bubble th {
                background: ${C.tableHeaderBg}; font-weight: 600; text-align: left;
                padding: 8px 10px; border: 1px solid ${C.tableBorder};
                font-size: 11px; letter-spacing: 0.02em; color: ${C.textSecondary};
            }
            .rz-msg.ai .rz-msg-bubble td { padding: 6px 10px; border: 1px solid ${C.tableBorder}; }
            .rz-msg.ai .rz-msg-bubble tr:nth-child(even) td { background: ${C.tableStripeBg}; }

            /* ---- CHARTS ---- */
            .rz-chart-container {
                margin: 12px 0; border-radius: 10px;
                padding: 14px 10px 6px;
                background: ${C.bgPanel};
                border: 1px solid ${C.border};
            }
            .rz-chart-title {
                font-size: 11px; font-weight: 600; color: ${C.textSecondary};
                text-transform: uppercase; letter-spacing: 0.04em; padding: 0 6px 8px;
            }
            .rz-chart-base {
                font-size: 10px; font-weight: 400; color: ${C.textMuted};
                text-transform: none; letter-spacing: 0; margin-top: 2px;
            }
            .rz-chart-sig {
                font-size: 10px; color: ${C.textMuted}; padding: 6px 10px 2px;
                border-top: 1px solid ${C.border}; margin-top: 4px;
                font-style: italic;
            }
            .rz-chart-render { min-height: 200px; }
            .rz-chart-prov {
                margin-top: 6px; padding-top: 5px;
                border-top: 1px dashed ${C.border};
                font-size: 9px; color: ${C.textMuted};
                font-family: 'SF Mono', 'Cascadia Code', 'Consolas', monospace;
                line-height: 1.5; opacity: 0.75;
            }
            .rz-prov-src { display: block; color: ${isDark ? '#5ba3ff' : '#2563eb'}; }
            .rz-prov-calc { display: block; }

            /* ApexCharts toolbar menu — force readable in both themes */
            .apexcharts-menu {
                background: ${isDark ? '#1e2235' : '#ffffff'} !important;
                border: 1px solid ${C.border} !important;
                box-shadow: 0 4px 12px rgba(0,0,0,0.2) !important;
            }
            .apexcharts-menu-item {
                color: ${C.text} !important;
            }
            .apexcharts-menu-item:hover {
                background: ${C.bgHover} !important;
            }

            /* ---- STREAMING CURSOR ---- */
            .rz-cursor {
                display: inline-block; width: 2px; height: 15px;
                background: ${C.accent}; margin-left: 2px; vertical-align: text-bottom;
                animation: rz-blink 0.8s step-end infinite;
            }
            @keyframes rz-blink { 50% { opacity: 0; } }

            /* ---- PROGRESS ---- */
            .rz-progress {
                display: flex; align-items: center; gap: 10px;
                padding: 10px 14px; color: ${C.textSecondary}; font-size: 12.5px;
            }
            .rz-dots { display: flex; gap: 4px; }
            .rz-dot {
                width: 5px; height: 5px; border-radius: 50%;
                background: ${C.accent}; animation: rz-pulse 1.4s infinite ease-in-out;
            }
            .rz-dot:nth-child(2) { animation-delay: 0.2s; }
            .rz-dot:nth-child(3) { animation-delay: 0.4s; }
            @keyframes rz-pulse {
                0%, 80%, 100% { opacity: 0.25; transform: scale(0.7); }
                40% { opacity: 1; transform: scale(1); }
            }

            /* ---- INPUT ---- */
            .rz-input-area {
                display: flex; align-items: flex-end; gap: 8px;
                padding: 12px 14px; border-top: 1px solid ${C.border};
                background: ${C.bgCard}; flex-shrink: 0;
            }
            .rz-newchat {
                width: 40px; height: 40px; border-radius: 10px;
                border: 1px solid ${C.accent}; background: transparent; cursor: pointer;
                display: flex; align-items: center; justify-content: center;
                flex-shrink: 0; transition: background 0.15s, transform 0.1s;
                position: relative;
            }
            .rz-newchat:hover { background: ${C.accentDim}; }
            .rz-newchat:active { transform: scale(0.95); }
            .rz-newchat svg { width: 16px; height: 16px; stroke: ${C.accent}; fill: none; }
            .rz-newchat::after {
                content: 'New Chat'; position: absolute; bottom: calc(100% + 6px); left: 50%;
                transform: translateX(-50%);
                background: rgba(0,0,0,0.85); color: #fff; font-size: 11px; font-weight: 500;
                padding: 4px 8px; border-radius: 4px; white-space: nowrap;
                opacity: 0; pointer-events: none; transition: opacity 0.1s;
            }
            .rz-newchat:hover::after { opacity: 1; }
            .rz-input {
                flex: 1; border: 1px solid ${C.inputBorder}; background: ${C.inputBg};
                color: ${C.text}; border-radius: 10px; padding: 10px 14px;
                font-size: 13.5px; font-family: inherit; outline: none;
                resize: none; min-height: 40px; max-height: 120px; line-height: 1.4;
                transition: border-color 0.15s, box-shadow 0.15s;
            }
            .rz-input::placeholder { color: ${C.textMuted}; }
            .rz-input:focus { border-color: ${C.accent}; box-shadow: 0 0 0 2px ${C.accentDim}; }

            .rz-send {
                width: 40px; height: 40px; border-radius: 10px; border: none;
                background: ${C.accent}; cursor: pointer;
                display: flex; align-items: center; justify-content: center;
                flex-shrink: 0; transition: opacity 0.15s, transform 0.1s;
            }
            .rz-send:hover { opacity: 0.9; }
            .rz-send:active { transform: scale(0.95); }
            .rz-send:disabled { opacity: 0.4; cursor: not-allowed; }
            .rz-send svg { width: 18px; height: 18px; fill: #fff; }

            /* ---- FOOTER ---- */
            .rz-footer {
                text-align: center; padding: 6px; font-size: 10px;
                color: ${C.textMuted}; background: ${C.bgCard};
            }
            .rz-footer a { color: ${C.textMuted}; text-decoration: none; }
            .rz-footer a:hover { color: ${C.accent}; }

            /* ---- WELCOME ---- */
            .rz-welcome {
                display: flex; flex-direction: column; align-items: center; justify-content: center;
                flex: 1; text-align: center; padding: 32px 24px; gap: 12px;
            }
            .rz-welcome-icon {
                width: 48px; height: 48px; border-radius: 12px;
                background: ${C.accentDim}; display: flex; align-items: center; justify-content: center;
            }
            .rz-welcome-icon svg { width: 24px; height: 24px; stroke: ${C.accent}; fill: none; }
            .rz-welcome-title { font-size: 15px; font-weight: 600; color: ${C.text}; }
            .rz-welcome-sub { font-size: 13px; line-height: 1.5; color: ${C.textSecondary}; max-width: 280px; }

            .rz-error-msg { color: ${C.error}; font-size: 12px; padding: 8px 14px; text-align: center; }
            .rz-meta { font-size: 10px; color: ${C.textMuted}; text-align: right; padding: 4px 14px 0; }

            /* ---- COPY BUTTONS ---- */
            .rz-copy-row {
                display: flex; justify-content: flex-end; gap: 4px;
                margin-top: 6px; padding-top: 6px;
                border-top: 1px solid ${C.border};
            }
            .rz-copy-btn {
                display: inline-flex; align-items: center; gap: 4px;
                padding: 4px 10px; border-radius: 6px;
                border: 1px solid ${C.border}; background: ${C.bgSurface};
                color: ${C.textSecondary}; font-size: 11px; font-family: inherit;
                cursor: pointer; transition: all 0.15s; white-space: nowrap;
            }
            .rz-copy-btn:hover { background: ${C.bgHover}; color: ${C.text}; border-color: ${C.accent}; }
            .rz-copy-btn:active { transform: scale(0.96); }
            .rz-copy-btn svg { width: 12px; height: 12px; flex-shrink: 0; }
            .rz-copy-btn.copied { border-color: #22c55e; color: #22c55e; }

            .rz-tbl-wrap { position: relative; }
            .rz-tbl-copy {
                position: absolute; top: -2px; right: 0; z-index: 2;
                padding: 3px 7px; border-radius: 5px;
                border: 1px solid ${C.border}; background: ${C.bgSurface};
                color: ${C.textSecondary}; font-size: 10px; font-family: inherit;
                cursor: pointer; transition: all 0.15s;
                display: flex; align-items: center; gap: 3px;
                opacity: 0; pointer-events: none;
            }
            .rz-tbl-wrap:hover .rz-tbl-copy { opacity: 1; pointer-events: auto; }
            .rz-tbl-copy:hover { background: ${C.bgHover}; color: ${C.text}; border-color: ${C.accent}; }
            .rz-tbl-copy svg { width: 11px; height: 11px; }
            .rz-tbl-copy.copied { border-color: #22c55e; color: #22c55e; opacity: 1; }

            /* ---- MOBILE ---- */
            @media (max-width: 480px) {
                .rz-window-wrap {
                    top: 0; bottom: 0; right: 0; left: 0;
                    width: 100vw !important; height: 100% !important;
                    max-width: 100vw; max-height: 100%;
                    border-radius: 0;
                }
                .rz-window { border-radius: 0; height: 100%; }
                .rz-header { padding-top: max(14px, env(safe-area-inset-top)); }
                .rz-bubble { bottom: 16px; right: 16px; width: 48px; height: 48px; border-radius: 14px; }
                .rz-bubble img { width: 22px; height: 22px; }
                .rz-resize { display: none; }
                .rz-input-area { padding: 10px 12px; gap: 8px; padding-bottom: max(10px, env(safe-area-inset-bottom)); }
                .rz-input { font-size: 16px; padding: 10px 12px; min-height: 42px; }
                .rz-send { width: 42px; height: 42px; }
                .rz-send img { width: 20px; height: 20px; }
                .rz-footer { padding-bottom: max(6px, env(safe-area-inset-bottom)); }
                .rz-messages { padding: 12px; }
            }
        `;
        shadow.appendChild(style);

        // ========================================
        // HTML
        // ========================================
        const root = document.createElement('div');
        root.innerHTML = `
            <button class="rz-bubble" id="rzToggle" aria-label="Open Ragenaizer chat">
                <img src="${logoUrl}" alt="" onerror="this.style.display='none';this.nextElementSibling.style.display='block'">
                <svg class="rz-fallback-icon" style="display:none" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                    <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H6l-2 2V4h16v12z"/>
                </svg>
            </button>
            <div class="rz-window-wrap" id="rzWrap">
                <div class="rz-window" id="rzWindow">
                    <div class="rz-resize" id="rzResize"></div>
                    <div class="rz-header">
                        <div class="rz-header-tooltip">Drag top-left corner to resize</div>
                        <img class="rz-header-logo" src="${logoUrl}" alt="" onerror="this.style.display='none'">
                        <span class="rz-header-title" id="rzTitle">${esc(projectName)}</span>
                        <button class="rz-header-close" id="rzClose" aria-label="Close">
                            <svg viewBox="0 0 24 24" stroke-width="2" stroke-linecap="round">
                                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                            </svg>
                        </button>
                    </div>
                    <div class="rz-messages" id="rzMessages">
                        <div class="rz-welcome">
                            <div class="rz-welcome-icon">
                                <svg viewBox="0 0 24 24" stroke-width="1.5">
                                    <circle cx="12" cy="12" r="10"/>
                                    <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/>
                                    <line x1="12" y1="17" x2="12.01" y2="17"/>
                                </svg>
                            </div>
                            <div class="rz-welcome-title">${isCopilotMode ? 'Your AI-powered assistant.' : 'Agentic AI-powered research assistant.'}</div>
                            <div class="rz-welcome-sub">${isCopilotMode ? 'Ask anything. I\'ll handle the details.' : 'Plans. Scans. Analyzes. Visualizes. All from a single question.'}</div>
                        </div>
                    </div>
                    <div class="rz-input-area">
                        <button class="rz-newchat" id="rzNewChat" aria-label="New Chat">
                            <svg viewBox="0 0 24 24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
                            </svg>
                        </button>
                        <textarea class="rz-input" id="rzInput" placeholder="Ask a question..." rows="1"></textarea>
                        <button class="rz-send" id="rzSend" aria-label="Send">
                            <svg viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
                        </button>
                    </div>
                    <div class="rz-footer">
                        <a href="https://ragenaizer.com" target="_blank" rel="noopener">Powered by Ragenaizer</a>
                    </div>
                </div>
            </div>
        `;
        shadow.appendChild(root);

        // ========================================
        // REFS
        // ========================================
        const $ = sel => shadow.querySelector(sel);
        const toggleBtn = $('#rzToggle');
        const windowWrap = $('#rzWrap');
        const chatWindow = $('#rzWindow');
        const closeBtn = $('#rzClose');
        const newChatBtn = $('#rzNewChat');
        const messagesEl = $('#rzMessages');
        const inputEl = $('#rzInput');
        const sendBtn = $('#rzSend');
        const titleEl = $('#rzTitle');
        const resizeHandle = $('#rzResize');

        let isOpen = false, isProcessing = false, welcomeShown = true;
        let insightsLoaded = false;
        let historyLoaded = false;

        // Eagerly restore conversation history in copilot mode so the chat
        // window already has prior messages waiting when the user opens it.
        if (isCopilotMode) {
            historyLoaded = true;
            // Fire-and-forget; runs after function declarations are hoisted.
            queueMicrotask(() => { try { loadHistory(); } catch {} });
        }

        // Streaming state
        let sBubble = null, sText = '', dText = '', sBuf = '', sTimer = null, sDone = false, sMeta = null, sViz = null, sPendingConfirm = false;
        const REVEAL_MS = 25, SLOW = 2, MED = 8, FAST = 20;

        // ========================================
        // APPLY CUSTOM COLORS FROM BACKEND
        // ========================================
        const hdr = shadow.querySelector('.rz-header');
        const bubble = shadow.querySelector('.rz-bubble');
        const send = shadow.querySelector('.rz-send');
        const hdrLogo = shadow.querySelector('.rz-header-logo');
        const bubbleLogo = shadow.querySelector('.rz-bubble img');

        if (info.header_color) { hdr.style.background = info.header_color; }
        if (info.font_color) {
            const title = shadow.querySelector('.rz-header-title');
            if (title) title.style.color = info.font_color;
        }
        if (info.accent_color) {
            bubble.style.background = info.accent_color;
            send.style.background = info.accent_color;
            const ts = document.createElement('style');
            ts.textContent = `
                .rz-input:focus { border-color: ${info.accent_color}; box-shadow: 0 0 0 2px ${info.accent_color}22; }
                .rz-msg.user .rz-msg-bubble { background: ${info.accent_color}; color: #fff; }
                .rz-newchat { border-color: ${info.accent_color}; }
                .rz-newchat svg { stroke: ${info.accent_color}; }
                .rz-newchat:hover { background: ${info.accent_color}22; }
            `;
            shadow.appendChild(ts);
        }
        const effectiveLogo = info.logo_url || logoUrl;
        if (hdrLogo) { hdrLogo.src = effectiveLogo; hdrLogo.style.display = ''; }
        if (bubbleLogo) { bubbleLogo.src = effectiveLogo; bubbleLogo.style.display = ''; }

        // ========================================
        // RESIZE HANDLING (drag from top-left corner)
        // ========================================
        resizeHandle.addEventListener('mousedown', (e) => {
            e.preventDefault();
            const startX = e.clientX, startY = e.clientY;
            const startW = windowWrap.offsetWidth, startH = windowWrap.offsetHeight;

            function onMove(ev) {
                const dx = startX - ev.clientX;
                const dy = startY - ev.clientY;
                const vpW = window.innerWidth - 32;
                const vpH = window.innerHeight - 120;
                const nw = Math.min(maxW, vpW, Math.max(minW, startW + dx));
                const nh = Math.min(maxH, vpH, Math.max(minH, startH + dy));
                windowWrap.style.width = nw + 'px';
                windowWrap.style.height = nh + 'px';
            }
            function onUp() {
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
                winW = windowWrap.offsetWidth;
                winH = windowWrap.offsetHeight;
                try { localStorage.setItem(sizeKey, JSON.stringify({ w: winW, h: winH })); } catch {}
            }
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        });

        // ========================================
        // TOGGLE / CLOSE
        // ========================================
        const isMobile = () => window.innerWidth <= 480;

        toggleBtn.addEventListener('click', () => {
            isOpen = !isOpen;
            if (isOpen) {
                windowWrap.style.display = 'block';
                requestAnimationFrame(() => { windowWrap.classList.add('open'); });
                if (isMobile()) toggleBtn.style.display = 'none';
                inputEl.focus();
                if (isCopilotMode && !historyLoaded) {
                    loadHistory();
                    historyLoaded = true;
                }
                if (isCopilotMode && !insightsLoaded) {
                    loadInsights();
                    insightsLoaded = true;
                }
            } else {
                windowWrap.classList.remove('open');
                if (isMobile()) toggleBtn.style.display = '';
                setTimeout(() => { if (!isOpen) windowWrap.style.display = 'none'; }, 350);
            }
        });
        closeBtn.addEventListener('click', () => {
            isOpen = false;
            windowWrap.classList.remove('open');
            if (isMobile()) toggleBtn.style.display = '';
            setTimeout(() => { if (!isOpen) windowWrap.style.display = 'none'; }, 350);
        });
        newChatBtn.addEventListener('click', async () => {
            if (isProcessing) return;
            // In copilot mode, also clear the server-side session so context truly resets
            if (isCopilotMode) {
                try {
                    const jwt = getCopilotJwt();
                    if (jwt) {
                        await fetch(`${baseUrl}/api/copilot/session`, {
                            method: 'DELETE',
                            headers: { 'Authorization': `Bearer ${jwt}` }
                        });
                    }
                } catch (e) { console.debug('[Copilot] Failed to clear server session:', e); }
            }
            // Generate fresh session — discard all old context
            sessionId = generateSessionId();
            sessionStorage.setItem(storageKey, sessionId);
            // Reset chat UI to welcome state
            messagesEl.innerHTML = `
                <div class="rz-welcome">
                    <div class="rz-welcome-icon">
                        <svg viewBox="0 0 24 24" stroke-width="1.5">
                            <circle cx="12" cy="12" r="10"/>
                            <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/>
                            <line x1="12" y1="17" x2="12.01" y2="17"/>
                        </svg>
                    </div>
                    <div class="rz-welcome-title">Agentic AI-powered research assistant.</div>
                    <div class="rz-welcome-sub">Plans. Scans. Analyzes. Visualizes. All from a single question.</div>
                </div>`;
            welcomeShown = true;
            // Clear any streaming state
            sBubble = null; sText = ''; dText = ''; sBuf = ''; sDone = false; sMeta = null; sViz = null;
            if (sTimer) { clearInterval(sTimer); sTimer = null; }
            inputEl.value = ''; inputEl.style.height = 'auto';
            inputEl.focus();
        });

        // ========================================
        // COPILOT HISTORY (restore conversation across page navigations)
        // ========================================
        async function loadHistory() {
            if (!isCopilotMode) return;
            try {
                const jwt = getCopilotJwt();
                if (!jwt) return;
                const res = await fetch(`${baseUrl}/api/copilot/history?limit=50`, {
                    headers: { 'Authorization': `Bearer ${jwt}` }
                });
                if (!res.ok) return;
                const data = await res.json();
                const messages = data.messages || [];
                if (!messages.length) return;

                // Backend returns newest-first; render oldest-first
                const ordered = [...messages].reverse();

                // Clear welcome state and render saved messages
                messagesEl.innerHTML = '';
                welcomeShown = false;

                for (const m of ordered) {
                    if (m.role !== 'user' && m.role !== 'assistant') continue;
                    const bubble = appendMessage(m.role === 'user' ? 'user' : 'ai', m.content || '');
                    if (m.role === 'assistant') {
                        addCopyButtons(bubble);
                    }
                }
                if (data.session_id) sessionId = data.session_id;
            } catch (e) {
                console.debug('[Copilot] History fetch failed:', e);
            }
        }

        // ========================================
        // COPILOT INSIGHT CARDS
        // ========================================
        async function loadInsights() {
            try {
                const jwt = getCopilotJwt();
                if (!jwt) return;
                const res = await fetch(`${baseUrl}/api/copilot/insights`, {
                    headers: { 'Authorization': `Bearer ${jwt}` }
                });
                if (!res.ok) return;
                const data = await res.json();
                if (!data.insights || data.insights.length === 0) return;

                const container = document.createElement('div');
                container.style.cssText = 'padding:8px 12px;display:flex;flex-direction:column;gap:6px;';

                for (const insight of data.insights) {
                    const card = document.createElement('div');
                    const severityColors = { urgent: C.error, warning: '#f59e0b', info: C.accent };
                    const borderColor = severityColors[insight.severity] || C.accent;
                    card.style.cssText = `display:flex;align-items:center;justify-content:space-between;padding:10px 12px;border-radius:8px;border-left:3px solid ${borderColor};background:${C.aiBg};cursor:pointer;transition:background 0.15s;`;
                    card.addEventListener('mouseenter', () => card.style.background = C.bgHover);
                    card.addEventListener('mouseleave', () => card.style.background = C.aiBg);

                    const textDiv = document.createElement('div');
                    textDiv.style.cssText = `font-size:12.5px;color:${C.text};`;
                    textDiv.textContent = insight.title;

                    const actionBtn = document.createElement('span');
                    actionBtn.style.cssText = `font-size:11px;color:${C.accent};font-weight:600;white-space:nowrap;margin-left:8px;`;
                    actionBtn.textContent = insight.action_label;

                    card.appendChild(textDiv);
                    card.appendChild(actionBtn);

                    card.addEventListener('click', () => {
                        container.remove();
                        inputEl.value = insight.action_message;
                        sendMessage();
                    });

                    container.appendChild(card);
                }

                // Insert at top of messages area
                messagesEl.insertBefore(container, messagesEl.firstChild);
            } catch (e) {
                console.debug('[Copilot] Insights fetch failed:', e);
            }
        }

        // ========================================
        // SEND MESSAGE
        // ========================================
        sendBtn.addEventListener('click', sendMessage);
        inputEl.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } });
        inputEl.addEventListener('input', () => { inputEl.style.height = 'auto'; inputEl.style.height = Math.min(inputEl.scrollHeight, 120) + 'px'; });

        async function sendMessage() {
            const text = inputEl.value.trim();
            if (!text || isProcessing) return;

            if (welcomeShown) { messagesEl.innerHTML = ''; welcomeShown = false; }

            sBubble = null; sText = ''; dText = ''; sBuf = ''; sDone = false; sMeta = null; sViz = null;
            if (sTimer) { clearInterval(sTimer); sTimer = null; }

            appendMessage('user', text);
            inputEl.value = ''; inputEl.style.height = 'auto';
            setProcessing(true);
            const progressEl = showProgress('Thinking...');

            try {
                // Build request based on mode
                let fetchUrl, fetchHeaders, fetchBody;
                if (isCopilotMode) {
                    const jwt = getCopilotJwt();
                    if (!jwt) { removeEl(progressEl); appendError('Not logged in. Please refresh and log in first.'); setProcessing(false); return; }
                    fetchUrl = `${baseUrl}/api/copilot/message`;
                    fetchHeaders = { 'Content-Type': 'application/json', 'Accept': 'text/event-stream', 'Authorization': `Bearer ${jwt}` };
                    fetchBody = JSON.stringify({ message: text, current_page: getCurrentPageContext() });
                } else {
                    fetchUrl = `${baseUrl}/api/embed/chat/${embedKey}`;
                    fetchHeaders = { 'Content-Type': 'application/json', 'Accept': 'text/event-stream' };
                    fetchBody = JSON.stringify({ message: text, session_id: sessionId, share_token: shareToken || undefined });
                }

                const res = await fetch(fetchUrl, {
                    method: 'POST',
                    headers: fetchHeaders,
                    body: fetchBody
                });

                if (!res.ok) {
                    const err = await res.json().catch(() => ({ error: 'Request failed' }));
                    removeEl(progressEl); appendError(err.error || 'Something went wrong');
                    setProcessing(false); return;
                }

                const reader = res.body.getReader();
                const dec = new TextDecoder();
                let buf = '';

                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    buf += dec.decode(value, { stream: true });
                    const lines = buf.split('\n'); buf = lines.pop() || '';
                    let evType = '';
                    for (const line of lines) {
                        if (line.startsWith('event: ')) evType = line.substring(7).trim();
                        else if (line.startsWith('data: ') && evType) {
                            try { handleSSE(evType, JSON.parse(line.substring(6)), progressEl); } catch {}
                            evType = '';
                        }
                    }
                }
                if (sBubble && !sDone) completeReveal();
            } catch {
                removeEl(progressEl); appendError('Failed to connect. Please try again.');
            }
            setProcessing(false);
        }

        function handleSSE(type, data, progressEl) {
            switch (type) {
                case 'progress': {
                    let desc = data.step_description || 'Analyzing...';
                    if (data.tools_called) { const tl = TOOL_LABELS[data.tools_called]; if (tl) desc = tl; }
                    if (data.round > 0) desc = `Step ${data.round}: ${desc}`;
                    updateProgress(progressEl, desc);
                    break;
                }
                case 'chunk':
                    if (!sBubble) { removeEl(progressEl); sBubble = appendMessage('ai', ''); }
                    sText += (data.chunk || ''); sBuf += (data.chunk || '');
                    startReveal();
                    break;
                case 'response':
                    removeEl(progressEl);
                    sMeta = { qt: data.query_time_ms || 0, it: data.input_tokens || 0, ot: data.output_tokens || 0 };
                    if (data.visualizations_json) { try { sViz = JSON.parse(data.visualizations_json); if (!Array.isArray(sViz)) sViz = [sViz]; } catch { sViz = null; } }
                    if (data.session_id) sessionId = data.session_id;
                    if (sBubble) {
                        if (data.response && data.response !== sText) { sText = data.response; sBuf = data.response.substring(dText.length); }
                        const bubbleRef = sBubble; // capture before completeReveal nullifies it
                        sDone = true;
                        if (!sTimer) completeReveal();
                        // Copilot: flag for confirmation buttons (added by completeReveal after final render)
                        const needsConfirm = data.requires_confirmation || (isCopilotMode && (data.response || '').includes('Reply **yes** to proceed'));
                        if (isCopilotMode && needsConfirm) sPendingConfirm = true;
                    } else {
                        const b = appendMessage('ai', data.response || 'No response.');
                        if (sViz?.length) renderCharts(b, sViz);
                        addCopyButtons(b);
                        showMeta(sMeta);
                        // Copilot: render confirmation buttons when no chunks were sent
                        const needsConfirmNoChunk = data.requires_confirmation || (isCopilotMode && (data.response || '').includes('Reply **yes** to proceed'));
                        if (isCopilotMode && needsConfirmNoChunk && b) {
                            const btnContainer = document.createElement('div');
                            btnContainer.style.cssText = 'display:flex;gap:8px;margin-top:12px;padding-top:10px;border-top:1px solid ' + C.border + ';';
                            const acceptBtn = document.createElement('button');
                            acceptBtn.textContent = '\u2713 Confirm';
                            acceptBtn.style.cssText = 'background:' + C.accent + ';color:#fff;border:none;padding:7px 18px;border-radius:6px;cursor:pointer;font-size:12.5px;font-weight:600;';
                            acceptBtn.addEventListener('click', () => { btnContainer.remove(); inputEl.value = 'yes'; sendMessage(); });
                            const cancelBtn = document.createElement('button');
                            cancelBtn.textContent = '\u2717 Cancel';
                            cancelBtn.style.cssText = 'background:' + C.error + ';color:#fff;border:none;padding:7px 18px;border-radius:6px;cursor:pointer;font-size:12.5px;font-weight:600;';
                            cancelBtn.addEventListener('click', () => { btnContainer.remove(); inputEl.value = 'no'; sendMessage(); });
                            btnContainer.appendChild(acceptBtn);
                            btnContainer.appendChild(cancelBtn);
                            b.appendChild(btnContainer);
                            scrollBottom();
                        }
                    }
                    break;
                case 'error':
                    removeEl(progressEl);
                    if (sBubble) completeReveal();
                    appendError(data.error || 'An error occurred');
                    break;
            }
        }

        // ========================================
        // ADAPTIVE STREAMING REVEAL
        // ========================================
        function startReveal() {
            if (sTimer) return;
            sTimer = setInterval(() => {
                if (!sBuf.length) {
                    clearInterval(sTimer); sTimer = null;
                    if (sDone) completeReveal();
                    return;
                }
                let n = SLOW;
                if (sBuf.length > 500) n = FAST;
                else if (sBuf.length > 100) n = MED;
                dText += sBuf.substring(0, n); sBuf = sBuf.substring(n);
                if (sBubble) { sBubble.innerHTML = renderContent(dText, true) + '<span class="rz-cursor"></span>'; scrollBottom(); }
            }, REVEAL_MS);
        }

        function completeReveal() {
            if (sTimer) { clearInterval(sTimer); sTimer = null; }
            sDone = true;
            const bubble = sBubble;
            if (sBubble) {
                dText = sText; sBuf = '';
                sBubble.innerHTML = renderContent(sText, false);
                if (sViz?.length) renderCharts(sBubble, sViz);
                addCopyButtons(sBubble);
                // Add confirmation buttons after final render (so innerHTML doesn't destroy them)
                if (sPendingConfirm && isCopilotMode) {
                    const btnContainer = document.createElement('div');
                    btnContainer.style.cssText = 'display:flex;gap:8px;margin-top:12px;padding-top:10px;border-top:1px solid ' + C.border + ';';
                    const acceptBtn = document.createElement('button');
                    acceptBtn.textContent = '\u2713 Confirm';
                    acceptBtn.style.cssText = 'background:' + C.accent + ';color:#fff;border:none;padding:7px 18px;border-radius:6px;cursor:pointer;font-size:12.5px;font-weight:600;';
                    acceptBtn.addEventListener('click', () => { btnContainer.remove(); inputEl.value = 'yes'; sendMessage(); });
                    const cancelBtn = document.createElement('button');
                    cancelBtn.textContent = '\u2717 Cancel';
                    cancelBtn.style.cssText = 'background:' + C.error + ';color:#fff;border:none;padding:7px 18px;border-radius:6px;cursor:pointer;font-size:12.5px;font-weight:600;';
                    cancelBtn.addEventListener('click', () => { btnContainer.remove(); inputEl.value = 'no'; sendMessage(); });
                    btnContainer.appendChild(acceptBtn);
                    btnContainer.appendChild(cancelBtn);
                    sBubble.appendChild(btnContainer);
                }
                scrollBottom();
            }
            if (sMeta) showMeta(sMeta);
            sBubble = null; sText = ''; dText = ''; sBuf = ''; sViz = null; sMeta = null; sPendingConfirm = false;
        }

        // ========================================
        // UI HELPERS
        // ========================================
        function appendMessage(role, content) {
            const d = document.createElement('div'); d.className = `rz-msg ${role}`;
            const b = document.createElement('div'); b.className = 'rz-msg-bubble';
            if (role === 'user') b.textContent = content; else b.innerHTML = renderContent(content, false);
            d.appendChild(b); messagesEl.appendChild(d); scrollBottom(); return b;
        }

        function showProgress(text) {
            const el = document.createElement('div'); el.className = 'rz-progress';
            el.innerHTML = `<div class="rz-dots"><span class="rz-dot"></span><span class="rz-dot"></span><span class="rz-dot"></span></div><span class="rz-ptxt">${esc(text)}</span>`;
            messagesEl.appendChild(el); scrollBottom(); return el;
        }
        function updateProgress(el, text) { if (!el) return; const s = el.querySelector('.rz-ptxt'); if (s) s.textContent = text; }
        function removeEl(el) { if (el?.parentNode) el.parentNode.removeChild(el); }
        function appendError(text) { const el = document.createElement('div'); el.className = 'rz-error-msg'; el.textContent = text; messagesEl.appendChild(el); scrollBottom(); }

        function showMeta(m) {
            if (!m) return;
            const old = messagesEl.querySelector('.rz-meta'); if (old) old.remove();
            if (m.qt <= 0) return;
            const el = document.createElement('div'); el.className = 'rz-meta';
            el.textContent = (m.qt / 1000).toFixed(1) + 's';
            messagesEl.appendChild(el);
        }

        function setProcessing(v) { isProcessing = v; sendBtn.disabled = v; inputEl.disabled = v; if (!v) inputEl.focus(); }
        function scrollBottom() { requestAnimationFrame(() => { messagesEl.scrollTop = messagesEl.scrollHeight; }); }

        // ========================================
        // MARKDOWN RENDERING
        // ========================================
        function renderContent(text, stripMarkers) {
            if (!text) return '';
            if (stripMarkers) text = text.replace(/\[CHART:\d+\]\n?/g, '');
            if (typeof marked !== 'undefined') return marked.parse(text);
            return mdFallback(text);
        }

        function mdFallback(md) {
            if (!md) return '';
            let h = esc(md);
            h = h.replace(/```(\w*)\n([\s\S]*?)```/g, (_, l, c) => `<pre><code>${c.trim()}</code></pre>`);
            h = h.replace(/`([^`]+)`/g, '<code>$1</code>');
            h = h.replace(/((?:^\|.+\|$\n?)+)/gm, (tb) => {
                const rows = tb.trim().split('\n').filter(r => r.trim());
                if (rows.length < 2) return tb;
                if (!/^\|[\s\-:|]+\|$/.test(rows[1])) return tb;
                const pr = r => r.split('|').slice(1,-1).map(c => c.trim());
                const hd = pr(rows[0]); let t = '<table><thead><tr>';
                hd.forEach(h => { t += `<th>${h}</th>`; }); t += '</tr></thead><tbody>';
                rows.slice(2).forEach(r => { const c = pr(r); t += '<tr>'; c.forEach(v => { t += `<td>${v}</td>`; }); t += '</tr>'; });
                return t + '</tbody></table>';
            });
            h = h.replace(/^### (.+)$/gm, '<h3>$1</h3>');
            h = h.replace(/^## (.+)$/gm, '<h2>$1</h2>');
            h = h.replace(/^# (.+)$/gm, '<h1>$1</h1>');
            h = h.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
            h = h.replace(/\*(.+?)\*/g, '<em>$1</em>');
            h = h.replace(/^---$/gm, '<hr>');
            h = h.replace(/^&gt; (.+)$/gm, '<blockquote>$1</blockquote>');
            h = h.replace(/((?:^- .+$\n?)+)/gm, b => '<ul>' + b.trim().split('\n').map(l => `<li>${l.replace(/^- /,'')}</li>`).join('') + '</ul>');
            h = h.replace(/((?:^\d+\. .+$\n?)+)/gm, b => '<ol>' + b.trim().split('\n').map(l => `<li>${l.replace(/^\d+\. /,'')}</li>`).join('') + '</ol>');
            h = h.replace(/^(?!<[a-z])((?!<\/)[^\n]+)$/gm, '<p>$1</p>');
            h = h.replace(/<p><\/p>/g, ''); h = h.replace(/\n/g, '');
            return h;
        }

        // ========================================
        // INLINE CHART RENDERING (ApexCharts)
        // ========================================
        function buildWidgetChartHtml(c, ts, idx) {
            const baseHtml = c.base_n ? `<div class="rz-chart-base">Base: N=${c.base_n.toLocaleString()}</div>` : '';
            const sigHtml = c.significance_notes ? `<div class="rz-chart-sig">${esc(c.significance_notes)}</div>` : '';
            let provHtml = '';
            if (c.data_source || c.calculation_note) {
                provHtml = '<div class="rz-chart-prov">';
                if (c.data_source) provHtml += `<span class="rz-prov-src">Source: ${esc(c.data_source)}</span>`;
                if (c.calculation_note) provHtml += `<span class="rz-prov-calc">Method: ${esc(c.calculation_note)}</span>`;
                provHtml += '</div>';
            }
            return `<div class="rz-chart-container" data-ci="${idx}"><div class="rz-chart-title">${esc(c.title||'')}${baseHtml}</div><div class="rz-chart-render" id="rzc-${ts}-${idx}"></div>${sigHtml}${provHtml}</div>`;
        }

        function renderCharts(el, charts) {
            if (!charts?.length || typeof ApexCharts === 'undefined') return;
            const ts = Date.now();
            const html = el.innerHTML;
            const hasM = /\[CHART:\d+\]/.test(html);
            if (hasM) {
                let nh = html.replace(/<p>\s*\[CHART:(\d+)\]\s*<\/p>/g, (_, i) => {
                    const idx = parseInt(i); if (idx >= charts.length) return '';
                    return buildWidgetChartHtml(charts[idx], ts, idx);
                });
                nh = nh.replace(/\[CHART:(\d+)\]/g, (_, i) => {
                    const idx = parseInt(i); if (idx >= charts.length) return '';
                    return `</p>${buildWidgetChartHtml(charts[idx], ts, idx)}<p>`;
                });
                el.innerHTML = nh.replace(/<p>\s*<\/p>/g, '');
            } else {
                const fb = el.querySelector('h1, h2, h3, p');
                let ch = ''; charts.forEach((c, i) => { ch += buildWidgetChartHtml(c, ts, i); });
                if (fb) fb.insertAdjacentHTML('afterend', ch); else el.innerHTML += ch;
            }
            requestAnimationFrame(() => {
                el.querySelectorAll('.rz-chart-render').forEach(c => {
                    const idx = parseInt(c.parentElement.dataset.ci);
                    if (idx < charts.length) makeChart(c, charts[idx]);
                });
                scrollBottom();
            });
        }

        function makeChart(el, cd) {
            const { chart_type, categories, series, points, counts, base_n, significance_markers } = cd;
            const usesPoints = ['scatter_chart', 'bubble_chart', 'treemap_chart'].includes(chart_type);
            const isGauge = chart_type === 'gauge_chart';
            if (!usesPoints && !isGauge && (!categories?.length || !series?.length)) return;
            if (usesPoints && (!points?.length) && (!series?.length)) return;
            const cc = CHART_COLORS.slice(0, Math.max((series||[]).length, (categories||[]).length, (points||[]).length));
            // Value format suffix — only show % when LLM says "percentage"
            const VF_MAP = { 'percentage': '%', 'count': '', 'currency_usd': ' USD', 'decimal': '', 'ratio': '', 'index': '', 'mean': '', 'score': '', 'year': '', 'custom': '' };
            const valSuffix = VF_MAP[cd.value_format || ''] !== undefined ? VF_MAP[cd.value_format || ''] : '';
            function fmtWithSuffix(v) { return fmtNum(v) + valSuffix; }
            // Build significance lookup: { "category|series": "high"|"low" }
            const sigMap = {};
            if (significance_markers?.length) significance_markers.forEach(m => { sigMap[`${m.category}|${m.series||''}`] = m.direction; });
            // Resolve count for a data point
            function resolveCnt(sIdx, dIdx, pctVal) {
                if (counts?.length && counts[sIdx]?.data) { const c = counts[sIdx].data[dIdx]; if (c != null) return c; }
                if (counts?.length && typeof counts[0] === 'number') { const c = counts[dIdx]; if (c != null) return c; }
                if (base_n && typeof pctVal === 'number' && valSuffix === '%') return Math.round(pctVal * base_n / 100);
                return null;
            }
            // Custom tooltip that shows count + value + suffix + significance arrow
            const richTooltip = {
                theme: isDark ? 'dark' : 'light', style: { fontSize: '11px' },
                custom: ({ series: s, seriesIndex, dataPointIndex, w }) => {
                    const cat = categories?.[dataPointIndex] || '';
                    const sName = w.config.series[seriesIndex]?.name || '';
                    const val = s[seriesIndex]?.[dataPointIndex];
                    const cnt = resolveCnt(seriesIndex, dataPointIndex, val);
                    const sig = sigMap[`${cat}|${sName}`] || sigMap[`${cat}|`];
                    const sigIcon = sig === 'high' ? ' <span style="color:#22c55e">&#9650;</span>' : sig === 'low' ? ' <span style="color:#ef4444">&#9660;</span>' : '';
                    let html = `<div style="padding:8px 12px;font-size:12px;background:#1e293b;color:#e2e8f0;border-radius:6px;box-shadow:0 4px 12px rgba(0,0,0,.35);">`;
                    html += `<strong>${esc(cat)}</strong><br>`;
                    if (val != null) html += `${fmtWithSuffix(val)}${sigIcon}`;
                    if (cnt != null) html += `<br><span style="color:#94a3b8">Count: ${cnt.toLocaleString()}</span>`;
                    if (base_n) html += `<br><span style="color:#64748b">Base: ${base_n.toLocaleString()}</span>`;
                    html += '</div>';
                    return html;
                }
            };
            const base = {
                chart: {
                    background: 'transparent',
                    toolbar: { show: true, tools: { download: true, selection: false, zoom: false, zoomin: false, zoomout: false, pan: false, reset: false }, export: { png: { background: 'transparent' }, svg: { background: 'transparent' } } },
                    fontFamily: 'inherit', foreColor: C.chartFg, redrawOnParentResize: true,
                    animations: { enabled: true, easing: 'easeinout', speed: 600 }
                },
                colors: cc,
                grid: { borderColor: C.chartGrid, strokeDashArray: 3, xaxis: { lines: { show: false } }, yaxis: { lines: { show: true } } },
                tooltip: { theme: isDark ? 'dark' : 'light', style: { fontSize: '11px' } },
                legend: { position: 'bottom', fontSize: '11px', labels: { colors: C.chartLegend }, markers: { size: 6, offsetX: -3 } },
                dataLabels: { enabled: false }
            };
            let opt;
            switch (chart_type) {
                case 'bar_chart':
                    opt = { ...base, chart: { ...base.chart, type: 'bar', height: Math.max(280, categories.length * 32) },
                        series: series.map(s => ({ name: s.name, data: s.data })),
                        plotOptions: { bar: { horizontal: true, borderRadius: 4, barHeight: '65%', dataLabels: { position: 'right' } } },
                        dataLabels: { enabled: true, textAnchor: 'start', offsetX: 8, style: { fontSize: '10px', fontWeight: 400, colors: [C.chartDataLabel] },
                            formatter: (v) => '\u2003' + fmtWithSuffix(v) },
                        tooltip: richTooltip,
                        xaxis: { categories, labels: { style: { fontSize: '10px' } } }, yaxis: { labels: { style: { fontSize: '10px' }, maxWidth: 160 } } };
                    break;
                case 'column_chart':
                    opt = { ...base, chart: { ...base.chart, type: 'bar', height: 320 },
                        series: series.map(s => ({ name: s.name, data: s.data })),
                        plotOptions: { bar: { horizontal: false, columnWidth: series.length > 1 ? '75%' : '55%', borderRadius: 4, borderRadiusApplication: 'end' } },
                        dataLabels: { enabled: categories.length <= 8, offsetY: -8, style: { fontSize: '10px', colors: [C.chartDataLabel] },
                            formatter: (v) => fmtWithSuffix(v) },
                        tooltip: richTooltip,
                        xaxis: { categories, labels: { rotate: categories.length > 6 ? -45 : 0, rotateAlways: categories.length > 6, style: { fontSize: '10px' } } },
                        yaxis: { labels: { style: { fontSize: '10px' }, formatter: v => fmtNum(v) } } };
                    break;
                case 'line_chart':
                    opt = { ...base, chart: { ...base.chart, type: 'line', height: 320 },
                        series: series.map(s => ({ name: s.name, data: s.data })),
                        stroke: { curve: 'smooth', width: 2.5 }, markers: { size: 5, strokeWidth: 0, hover: { size: 7 } },
                        tooltip: richTooltip,
                        xaxis: { categories, labels: { rotate: categories.length > 8 ? -45 : 0, rotateAlways: categories.length > 8, style: { fontSize: '10px' } } },
                        yaxis: { labels: { style: { fontSize: '10px' }, formatter: v => fmtWithSuffix(v) } } };
                    break;
                case 'pie_chart':
                    opt = { ...base, chart: { ...base.chart, type: 'pie', height: 320 },
                        series: series[0].data, labels: categories,
                        dataLabels: { enabled: true, formatter: (v) => fmtWithSuffix(Math.round(v)), style: { fontSize: '11px', fontWeight: 500 }, dropShadow: { enabled: false } },
                        tooltip: { custom: ({ seriesIndex, w }) => {
                            const cat = w.config.labels?.[seriesIndex] || '';
                            const val = w.globals.series?.[seriesIndex];
                            const cnt = resolveCnt(0, seriesIndex, val);
                            let h = `<div style="padding:8px 12px;font-size:12px;background:#1e293b;color:#e2e8f0;border-radius:6px;"><strong>${esc(cat)}</strong><br>${fmtWithSuffix(val)}`;
                            if (cnt != null) h += `<br><span style="color:#94a3b8">Count: ${Number(cnt).toLocaleString()}</span>`;
                            if (base_n) h += `<br><span style="color:#64748b">Base: ${base_n.toLocaleString()}</span>`;
                            return h + '</div>';
                        }},
                        plotOptions: { pie: { expandOnClick: true } }, stroke: { width: 1, colors: [C.chartStroke] } };
                    break;
                case 'donut_chart':
                    opt = { ...base, chart: { ...base.chart, type: 'donut', height: 320 },
                        series: series[0].data, labels: categories,
                        dataLabels: { enabled: true, formatter: (v) => fmtWithSuffix(Math.round(v)), style: { fontSize: '11px', fontWeight: 500 }, dropShadow: { enabled: false } },
                        tooltip: { custom: ({ seriesIndex, w }) => {
                            const cat = w.config.labels?.[seriesIndex] || '';
                            const val = w.globals.series?.[seriesIndex];
                            const cnt = resolveCnt(0, seriesIndex, val);
                            let h = `<div style="padding:8px 12px;font-size:12px;background:#1e293b;color:#e2e8f0;border-radius:6px;"><strong>${esc(cat)}</strong><br>${fmtWithSuffix(val)}`;
                            if (cnt != null) h += `<br><span style="color:#94a3b8">Count: ${Number(cnt).toLocaleString()}</span>`;
                            if (base_n) h += `<br><span style="color:#64748b">Base: ${base_n.toLocaleString()}</span>`;
                            return h + '</div>';
                        }},
                        plotOptions: { pie: { donut: { size: '62%', labels: {
                            show: true, name: { show: true, fontSize: '12px', color: C.chartLegend },
                            value: { show: true, fontSize: '16px', fontWeight: 600, color: '#00d4ff', formatter: v => fmtNum(parseFloat(v)) },
                            total: { show: true, label: base_n ? `N=${base_n.toLocaleString()}` : 'Total', fontSize: '11px', color: C.textMuted, formatter: w => fmtNum(w.globals.spikeWidth ? 0 : w.globals.series.reduce((a,b)=>a+b,0)) }
                        } } } }, stroke: { width: 1, colors: [C.chartStroke] } };
                    break;
                case 'scatter_chart': {
                    const pts = cd.points || [];
                    const scSeries = pts.map(s => ({ name: s.name, data: (s.data || []).map(p => ({ x: p.x, y: p.y, meta: p.label || '' })) }));
                    const scColors = pts.map(s => s.color || '#00d4ff');
                    const ann = cd.annotations || {};
                    const annOpts = { xaxis: [], yaxis: [] };
                    if (ann.x_line != null) annOpts.xaxis.push({ x: ann.x_line, strokeDashArray: 4, borderColor: 'rgba(255,255,255,0.25)', label: { text: 'Mean', style: { color: '#fff', background: 'rgba(0,0,0,0.5)', fontSize: '10px', padding: { left: 4, right: 4, top: 2, bottom: 2 } }, position: 'top' } });
                    if (ann.y_line != null) annOpts.yaxis.push({ y: ann.y_line, strokeDashArray: 4, borderColor: 'rgba(255,255,255,0.25)', label: { text: 'Mean', style: { color: '#fff', background: 'rgba(0,0,0,0.5)', fontSize: '10px', padding: { left: 4, right: 4, top: 2, bottom: 2 } }, position: 'left' } });
                    opt = { ...base, chart: { ...base.chart, type: 'scatter', height: 380, zoom: { enabled: false } },
                        series: scSeries, colors: scColors,
                        markers: { size: 8, strokeWidth: 1, strokeColors: 'rgba(0,0,0,0.3)', hover: { size: 11 } },
                        xaxis: { type: 'numeric', title: cd.x_label ? { text: cd.x_label, style: { color: C.chartFg, fontSize: '11px' } } : undefined, labels: { formatter: v => Number(v).toFixed(1), style: { fontSize: '10px' } }, tickAmount: 6 },
                        yaxis: { title: cd.y_label ? { text: cd.y_label, style: { color: C.chartFg, fontSize: '11px' } } : undefined, labels: { formatter: v => Number(v).toFixed(1), style: { fontSize: '10px' } } },
                        annotations: annOpts,
                        grid: { ...base.grid, xaxis: { lines: { show: true } } },
                        tooltip: { theme: 'dark', custom: ({ seriesIndex, dataPointIndex, w }) => {
                            const pt = w.config.series[seriesIndex]?.data[dataPointIndex]; if (!pt) return '';
                            const sn = w.config.series[seriesIndex].name || '';
                            return `<div style="padding:8px 12px;font-size:12px;background:#1e293b;color:#e2e8f0;border-radius:6px;box-shadow:0 4px 12px rgba(0,0,0,.35);"><strong>${esc(pt.meta||sn)}</strong><br>${cd.x_label||'X'}: ${Number(pt.x).toFixed(1)}<br>${cd.y_label||'Y'}: ${Number(pt.y).toFixed(1)}<br><span style="color:${scColors[seriesIndex]||'#00d4ff'}">${sn}</span></div>`;
                        } } };
                    break;
                }
                case 'bubble_chart': {
                    const bPts = cd.points || [];
                    const bSeries = bPts.map(s => ({ name: s.name, data: (s.data || []).map(p => [p.x, p.y, p.z || 10]) }));
                    const bColors = bPts.map(s => s.color || '#00d4ff');
                    opt = { ...base, chart: { ...base.chart, type: 'bubble', height: 380, zoom: { enabled: false } },
                        series: bSeries, colors: bColors.length ? bColors : cc, fill: { opacity: 0.7 },
                        xaxis: { type: 'numeric', title: cd.x_label ? { text: cd.x_label, style: { color: C.chartFg, fontSize: '11px' } } : undefined, labels: { style: { fontSize: '10px' } }, tickAmount: 6 },
                        yaxis: { title: cd.y_label ? { text: cd.y_label, style: { color: C.chartFg, fontSize: '11px' } } : undefined, labels: { style: { fontSize: '10px' } } } };
                    break;
                }
                case 'radar_chart':
                    opt = { ...base, chart: { ...base.chart, type: 'radar', height: 480 },
                        series: series.map(s => ({ name: s.name, data: s.data })),
                        tooltip: richTooltip,
                        xaxis: { categories, labels: { style: { fontSize: '10px', colors: Array(categories.length).fill(C.chartFg) } } },
                        yaxis: { show: false }, stroke: { width: 2 }, fill: { opacity: 0.15 },
                        markers: { size: 4, strokeWidth: 0, hover: { size: 6 } },
                        plotOptions: { radar: { polygons: { strokeColors: 'rgba(255,255,255,0.08)', connectorColors: 'rgba(255,255,255,0.08)', fill: { colors: ['transparent'] } } } } };
                    break;
                case 'heatmap_chart':
                    opt = { ...base, chart: { ...base.chart, type: 'heatmap', height: Math.max(280, (series.length||5)*38) },
                        series: series.map(s => ({ name: s.name, data: s.data.map((v,i) => ({ x: categories[i]||`Col ${i+1}`, y: v })) })),
                        plotOptions: { heatmap: { radius: 2, enableShades: true, shadeIntensity: 0.5, colorScale: { ranges: [{ from: -Infinity, to: 0, color: '#ef4444', name: 'Low' },{ from: 0, to: 50, color: '#f59e0b', name: 'Medium' },{ from: 50, to: Infinity, color: '#22c55e', name: 'High' }] } } },
                        dataLabels: { enabled: true, style: { fontSize: '10px', colors: ['#fff'] } },
                        tooltip: richTooltip,
                        stroke: { width: 1, colors: ['rgba(0,0,0,0.15)'] } };
                    break;
                case 'treemap_chart': {
                    const tmPts = cd.points || [];
                    const tmS = tmPts.length > 0
                        ? tmPts.map(s => ({ name: s.name, data: (s.data||[]).map(p => ({ x: p.label||p.x, y: p.y })) }))
                        : (series?.length > 0 ? [{ data: categories.map((c,i) => ({ x: c, y: series[0].data[i]||0 })) }] : []);
                    opt = { ...base, chart: { ...base.chart, type: 'treemap', height: 340 },
                        series: tmS,
                        plotOptions: { treemap: { enableShades: true, shadeIntensity: 0.3, distributed: tmS.length <= 1 } },
                        dataLabels: { enabled: true, style: { fontSize: '11px' }, formatter: (text, op) => [text, fmtNum(op.value)], offsetY: -2 } };
                    break;
                }
                case 'radialBar_chart':
                    opt = { ...base, chart: { ...base.chart, type: 'radialBar', height: 340 },
                        series: series?.length > 0 ? series[0].data : [], labels: categories,
                        plotOptions: { radialBar: { hollow: { size: categories.length > 3 ? '30%' : '45%' }, track: { background: 'rgba(255,255,255,0.06)', strokeWidth: '100%' },
                            dataLabels: { name: { fontSize: '12px', color: C.chartLegend, offsetY: -10 }, value: { fontSize: '18px', fontWeight: 600, color: '#00d4ff', formatter: v => Math.round(v) + '%' },
                                total: { show: categories.length > 1, label: 'Average', fontSize: '11px', color: C.textMuted, formatter: w => Math.round(w.globals.series.reduce((a,b)=>a+b,0)/w.globals.series.length) + '%' } } } },
                        stroke: { lineCap: 'round' } };
                    break;
                case 'polarArea_chart':
                    opt = { ...base, chart: { ...base.chart, type: 'polarArea', height: 340 },
                        series: series?.length > 0 ? series[0].data : [], labels: categories,
                        fill: { opacity: 0.8 }, stroke: { width: 1, colors: [C.chartStroke] },
                        plotOptions: { polarArea: { rings: { strokeWidth: 1, strokeColor: 'rgba(255,255,255,0.08)' }, spokes: { strokeWidth: 1, connectorColors: 'rgba(255,255,255,0.08)' } } },
                        yaxis: { show: false }, dataLabels: { enabled: true, formatter: v => Math.round(v) + '%', style: { fontSize: '10px' }, dropShadow: { enabled: false } } };
                    break;
                case 'boxPlot_chart': {
                    const bpSeries = (series||[]).map(s => ({
                        name: s.name || 'Distribution', type: 'boxPlot',
                        data: (s.data||[]).map((d,i) => ({
                            x: (categories||[])[i] || `Group ${i+1}`,
                            y: Array.isArray(d) && d.length >= 5 ? d.slice(0,5) : Array.isArray(d) ? [...d, ...Array(5-d.length).fill(d[d.length-1]||0)] : [d,d,d,d,d]
                        }))
                    }));
                    opt = { ...base, chart: { ...base.chart, type: 'boxPlot', height: 340 },
                        series: bpSeries,
                        plotOptions: { boxPlot: { colors: { upper: '#00d4ff', lower: '#22c55e' } } } };
                    break;
                }
                case 'area_chart':
                    opt = { ...base, chart: { ...base.chart, type: 'area', height: 320 },
                        series: series.map(s => ({ name: s.name, data: s.data })),
                        stroke: { curve: 'smooth', width: 2 }, fill: { type: 'gradient', gradient: { shadeIntensity: 1, opacityFrom: 0.4, opacityTo: 0.05, stops: [0, 90, 100] } },
                        tooltip: richTooltip,
                        xaxis: { categories, labels: { rotate: categories.length > 8 ? -45 : 0, rotateAlways: categories.length > 8, style: { fontSize: '10px' } } },
                        yaxis: { labels: { style: { fontSize: '10px' }, formatter: v => fmtWithSuffix(v) } },
                        markers: { size: 4, strokeWidth: 0, hover: { size: 6 } } };
                    break;
                case 'stacked_bar_chart':
                    opt = { ...base, chart: { ...base.chart, type: 'bar', height: Math.max(280, (categories||[]).length * 48), stacked: true, stackType: '100%' },
                        series: series.map(s => ({ name: s.name, data: s.data })),
                        plotOptions: { bar: { horizontal: true, borderRadius: 2, barHeight: '70%' } },
                        dataLabels: { enabled: true, style: { fontSize: '10px', fontWeight: 400, colors: ['#fff'] },
                            formatter: (val, o) => { const raw = series[o.seriesIndex]?.data[o.dataPointIndex]; return raw != null && raw >= 5 ? raw.toFixed(1) + valSuffix : ''; } },
                        tooltip: richTooltip,
                        xaxis: { categories, labels: { style: { fontSize: '10px' }, formatter: v => Math.round(v) + '%' } },
                        yaxis: { labels: { style: { fontSize: '10px' }, maxWidth: 160 } },
                        legend: { ...base.legend, position: 'bottom' } };
                    break;
                case 'gauge_chart': {
                    const gv = cd.gauge_value ?? (series?.[0]?.data?.[0] ?? 0);
                    const gl = cd.gauge_label || cd.title || 'Value';
                    opt = { ...base, chart: { ...base.chart, type: 'radialBar', height: 300 },
                        series: [Math.min(100, Math.max(0, gv))], labels: [gl],
                        plotOptions: { radialBar: { startAngle: -135, endAngle: 135, hollow: { size: '60%' },
                            track: { background: 'rgba(255,255,255,0.06)', strokeWidth: '100%' },
                            dataLabels: { name: { fontSize: '13px', color: C.chartLegend, offsetY: 20 },
                                value: { fontSize: '28px', fontWeight: 700, color: '#00d4ff', offsetY: -15,
                                    formatter: () => gv % 1 === 0 ? gv.toFixed(0) + '%' : gv.toFixed(1) + '%' } } } },
                        stroke: { lineCap: 'round' } };
                    break;
                }
                default: return;
            }
            try { new ApexCharts(el, opt).render().catch(() => { el.innerHTML = `<div style="color:${C.textMuted};font-size:11px;padding:20px;text-align:center;">Chart rendering failed</div>`; }); } catch { el.innerHTML = `<div style="color:${C.textMuted};font-size:11px;padding:20px;text-align:center;">Chart rendering failed</div>`; }
        }

        function fmtNum(v) {
            if (v == null) return '';
            if (Math.abs(v) >= 1e6) return (v / 1e6).toFixed(1) + 'M';
            if (Math.abs(v) >= 1e3) return (v / 1e3).toFixed(1) + 'K';
            return Number.isInteger(v) ? v.toString() : v.toFixed(1);
        }

        // ========================================
        // COPY UTILITIES
        // ========================================
        const COPY_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
        const CHECK_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;

        function flashCopied(btn) {
            const orig = btn.innerHTML;
            btn.innerHTML = `${CHECK_ICON} Copied`;
            btn.classList.add('copied');
            setTimeout(() => { btn.innerHTML = orig; btn.classList.remove('copied'); }, 1500);
        }

        // Copy full AI bubble as plain text
        function copyBubbleText(bubble) {
            const clone = bubble.cloneNode(true);
            // Remove UI elements from clone
            clone.querySelectorAll('.rz-copy-row, .rz-tbl-copy').forEach(e => e.remove());
            // Replace charts with just their title
            clone.querySelectorAll('.rz-chart-container').forEach(chart => {
                const title = chart.querySelector('.rz-chart-title')?.textContent?.trim() || '';
                chart.replaceWith(document.createTextNode(title ? `[Chart: ${title}]\n` : ''));
            });
            // For tables, convert to tab-separated
            clone.querySelectorAll('table').forEach(tbl => {
                let txt = '';
                tbl.querySelectorAll('tr').forEach(row => {
                    const cells = Array.from(row.querySelectorAll('th, td')).map(c => c.textContent.trim());
                    txt += cells.join('\t') + '\n';
                });
                tbl.replaceWith(document.createTextNode(txt));
            });
            return clone.innerText || clone.textContent || '';
        }

        // Copy table as tab-separated text
        function copyTableText(table) {
            let txt = '';
            table.querySelectorAll('tr').forEach(row => {
                const cells = Array.from(row.querySelectorAll('th, td')).map(c => c.textContent.trim());
                txt += cells.join('\t') + '\n';
            });
            return txt.trim();
        }

        // Add copy buttons to a completed AI message bubble
        function addCopyButtons(bubble) {
            // Wrap tables with copy button
            bubble.querySelectorAll('table').forEach(tbl => {
                if (tbl.closest('.rz-tbl-wrap')) return;
                const wrap = document.createElement('div');
                wrap.className = 'rz-tbl-wrap';
                tbl.parentNode.insertBefore(wrap, tbl);
                wrap.appendChild(tbl);
                const btn = document.createElement('button');
                btn.className = 'rz-tbl-copy';
                btn.innerHTML = `${COPY_ICON} Copy table`;
                btn.onclick = async (e) => {
                    e.stopPropagation();
                    const txt = copyTableText(tbl);
                    try { await navigator.clipboard.writeText(txt); flashCopied(btn); } catch {}
                };
                wrap.appendChild(btn);
            });

            // Add bottom copy row for entire response
            const copyRow = document.createElement('div');
            copyRow.className = 'rz-copy-row';
            const copyAllBtn = document.createElement('button');
            copyAllBtn.className = 'rz-copy-btn';
            copyAllBtn.innerHTML = `${COPY_ICON} Copy response`;
            copyAllBtn.onclick = async (e) => {
                e.stopPropagation();
                const txt = copyBubbleText(bubble);
                try { await navigator.clipboard.writeText(txt); flashCopied(copyAllBtn); } catch {}
            };
            copyRow.appendChild(copyAllBtn);
            bubble.appendChild(copyRow);
        }

    })();

    // Helper available at module scope for HTML template
    function esc(s) { return s ? s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;') : ''; }

})();
