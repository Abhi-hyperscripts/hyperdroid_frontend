/**
 * Ragenaizer Research Chat Widget v4
 * Embeddable Shadow DOM chat widget for external websites.
 *
 * Features:
 *   - marked.js for markdown rendering
 *   - ApexCharts for visualizations (bar, column, line, pie, donut)
 *   - Adaptive streaming reveal with cursor
 *   - Progress step indicators
 *   - Resizable chat window (size persisted in localStorage)
 *   - Theme (dark/light) fetched from backend — no data-theme attribute needed
 *
 * Usage:
 *   <script src="https://ragenaizer.com/embed/widget.js"
 *           data-key="YOUR_EMBED_KEY"
 *           data-api="https://research.ragenaizer.com"></script>
 */
(function () {
    'use strict';

    if (window.__ragenaizer_widget_loaded) return;
    window.__ragenaizer_widget_loaded = true;

    const scriptEl = document.currentScript;
    const embedKey = scriptEl?.getAttribute('data-key') || '';

    if (!embedKey) { console.warn('[Ragenaizer] Missing data-key on embed script.'); return; }

    const explicitApi = scriptEl?.getAttribute('data-api') || '';
    const scriptSrc = scriptEl?.src || '';
    const scriptOrigin = scriptSrc ? new URL(scriptSrc).origin : '';
    const baseUrl = explicitApi || scriptOrigin;
    if (!baseUrl) { console.warn('[Ragenaizer] Set data-api attribute.'); return; }

    const logoUrl = `${scriptOrigin}/assets/logo-icon-white.png`;

    // Session ID
    const storageKey = `ragenaizer_session_${embedKey}`;
    let sessionId = localStorage.getItem(storageKey);
    if (!sessionId) {
        sessionId = crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
            const r = Math.random() * 16 | 0;
            return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
        });
        localStorage.setItem(storageKey, sessionId);
    }

    // Persisted window size
    const sizeKey = `ragenaizer_size_${embedKey}`;
    let savedSize = null;
    try { savedSize = JSON.parse(localStorage.getItem(sizeKey)); } catch {}
    const defaultW = 420, defaultH = 600;
    const minW = 340, minH = 400, maxW = 1600, maxH = 1200;
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
        create_visualization: 'Creating chart'
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

        // Fetch embed info (theme, name, colors)
        let info;
        try {
            const r = await fetch(`${baseUrl}/api/embed/info/${embedKey}`);
            if (!r.ok) { window.__ragenaizer_widget_loaded = false; return; }
            info = await r.json();
        } catch { window.__ragenaizer_widget_loaded = false; return; }

        await libPromise;

        // ========================================
        // THEME FROM BACKEND
        // ========================================
        const theme = info.theme || 'light';
        const isDark = theme !== 'light';
        const C = isDark ? {
            bgCard: 'rgba(22, 25, 38, 0.88)', bgPanel: 'rgba(28, 32, 48, 0.9)', bgMessages: '#161924',
            bgSurface: '#282d40', bgHover: '#303654',
            text: '#eceef5', textSecondary: '#8b90a8', textMuted: '#555b75',
            border: 'rgba(255,255,255,0.06)', borderLight: '#333952',
            accent: '#00b8d9', accentDim: 'rgba(0,184,217,0.1)',
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
            accent: '#0891b2', accentDim: 'rgba(8,145,178,0.08)',
            userBg: '#0891b2', userText: '#fff',
            aiBg: 'rgba(0,0,0,0.02)', aiBorder: 'rgba(0,0,0,0.05)',
            inputBg: '#ffffff', inputBorder: 'rgba(0,0,0,0.1)',
            scrollThumb: 'rgba(0,0,0,0.08)',
            error: '#ef4444', codeBlock: 'rgba(0,0,0,0.04)',
            tableBorder: 'rgba(0,0,0,0.06)', tableHeaderBg: 'rgba(0,0,0,0.02)', tableStripeBg: 'rgba(0,0,0,0.01)',
            chartFg: '#6b7280', chartGrid: 'rgba(0,0,0,0.06)',
            chartLegend: '#6b7280', chartDataLabel: '#374151', chartStroke: '#ffffff'
        };

        const projectName = info.name || info.project_name || 'Research Assistant';

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

            /* ---- RESIZE HANDLE ---- */
            .rz-resize {
                position: absolute; top: 0; left: 0;
                width: 24px; height: 24px;
                cursor: nw-resize; z-index: 20;
            }
            .rz-resize::after {
                content: ''; position: absolute; top: 6px; left: 6px;
                width: 8px; height: 8px;
                border-top: 2px solid ${C.textMuted}; border-left: 2px solid ${C.textMuted};
                opacity: 0.4; transition: opacity 0.15s;
            }
            .rz-resize:hover::after { opacity: 0.8; }

            /* ---- HEADER ---- */
            .rz-header {
                display: flex; align-items: center; gap: 10px;
                padding: 14px 16px;
                background: ${C.accent};
                flex-shrink: 0; position: relative;
            }
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
            .rz-chart-render { min-height: 200px; }

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

            /* ---- MOBILE ---- */
            @media (max-width: 480px) {
                .rz-window-wrap { bottom: 0; right: 0; width: 100vw !important; height: 100vh !important; max-height: 100vh; border-radius: 0; }
                .rz-window { border-radius: 0; }
                .rz-bubble { bottom: 16px; right: 16px; }
                .rz-resize { display: none; }
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
                            <div class="rz-welcome-title">Ask anything about this data</div>
                            <div class="rz-welcome-sub">AI-powered research analysis. Ask questions about the dataset and get instant insights with charts.</div>
                        </div>
                    </div>
                    <div class="rz-input-area">
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
        const messagesEl = $('#rzMessages');
        const inputEl = $('#rzInput');
        const sendBtn = $('#rzSend');
        const titleEl = $('#rzTitle');
        const resizeHandle = $('#rzResize');

        let isOpen = false, isProcessing = false, welcomeShown = true;

        // Streaming state
        let sBubble = null, sText = '', dText = '', sBuf = '', sTimer = null, sDone = false, sMeta = null, sViz = null;
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
        if (info.accent_color) {
            bubble.style.background = info.accent_color;
            send.style.background = info.accent_color;
            const ts = document.createElement('style');
            ts.textContent = `.rz-input:focus { border-color: ${info.accent_color}; box-shadow: 0 0 0 2px ${info.accent_color}22; }`;
            shadow.appendChild(ts);
        }
        if (info.logo_url) {
            if (hdrLogo) { hdrLogo.src = info.logo_url; hdrLogo.style.display = ''; }
            if (bubbleLogo) { bubbleLogo.src = info.logo_url; bubbleLogo.style.display = ''; }
        }

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
                const nw = Math.min(maxW, Math.max(minW, startW + dx));
                const nh = Math.min(maxH, Math.max(minH, startH + dy));
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
        toggleBtn.addEventListener('click', () => {
            isOpen = !isOpen;
            if (isOpen) {
                windowWrap.style.display = 'block';
                requestAnimationFrame(() => { windowWrap.classList.add('open'); });
                inputEl.focus();
            } else {
                windowWrap.classList.remove('open');
                setTimeout(() => { if (!isOpen) windowWrap.style.display = 'none'; }, 350);
            }
        });
        closeBtn.addEventListener('click', () => {
            isOpen = false;
            windowWrap.classList.remove('open');
            setTimeout(() => { if (!isOpen) windowWrap.style.display = 'none'; }, 350);
        });

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
                const res = await fetch(`${baseUrl}/api/embed/chat/${embedKey}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Accept': 'text/event-stream' },
                    body: JSON.stringify({ message: text, session_id: sessionId })
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
                        sDone = true;
                        if (!sTimer) completeReveal();
                    } else {
                        const b = appendMessage('ai', data.response || 'No response.');
                        if (sViz?.length) renderCharts(b, sViz);
                        showMeta(sMeta);
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
            if (sBubble) {
                dText = sText; sBuf = '';
                sBubble.innerHTML = renderContent(sText, false);
                if (sViz?.length) renderCharts(sBubble, sViz);
                scrollBottom();
            }
            if (sMeta) showMeta(sMeta);
            sBubble = null; sText = ''; dText = ''; sBuf = ''; sViz = null; sMeta = null;
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
        function renderCharts(el, charts) {
            if (!charts?.length || typeof ApexCharts === 'undefined') return;
            const ts = Date.now();
            const html = el.innerHTML;
            const hasM = /\[CHART:\d+\]/.test(html);
            if (hasM) {
                let nh = html.replace(/<p>\s*\[CHART:(\d+)\]\s*<\/p>/g, (_, i) => {
                    const idx = parseInt(i); if (idx >= charts.length) return '';
                    return `<div class="rz-chart-container" data-ci="${idx}"><div class="rz-chart-title">${esc(charts[idx].title||'')}</div><div class="rz-chart-render" id="rzc-${ts}-${idx}"></div></div>`;
                });
                nh = nh.replace(/\[CHART:(\d+)\]/g, (_, i) => {
                    const idx = parseInt(i); if (idx >= charts.length) return '';
                    return `</p><div class="rz-chart-container" data-ci="${idx}"><div class="rz-chart-title">${esc(charts[idx].title||'')}</div><div class="rz-chart-render" id="rzc-${ts}-${idx}"></div></div><p>`;
                });
                el.innerHTML = nh.replace(/<p>\s*<\/p>/g, '');
            } else {
                const fb = el.querySelector('h1, h2, h3, p');
                let ch = ''; charts.forEach((c, i) => {
                    ch += `<div class="rz-chart-container" data-ci="${i}"><div class="rz-chart-title">${esc(c.title||'')}</div><div class="rz-chart-render" id="rzc-${ts}-${i}"></div></div>`;
                });
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
            const { chart_type, categories, series } = cd;
            if (!categories?.length || !series?.length) return;
            const cc = CHART_COLORS.slice(0, Math.max(series.length, categories.length));
            const base = {
                chart: {
                    background: 'transparent',
                    toolbar: { show: true, tools: { download: true, selection: false, zoom: false, zoomin: false, zoomout: false, pan: false, reset: false } },
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
                        dataLabels: { enabled: true, textAnchor: 'start', offsetX: 8, style: { fontSize: '10px', fontWeight: 400, colors: [C.chartDataLabel] }, formatter: v => '\u2003' + fmtNum(v) },
                        xaxis: { categories, labels: { style: { fontSize: '10px' } } }, yaxis: { labels: { style: { fontSize: '10px' }, maxWidth: 160 } } };
                    break;
                case 'column_chart':
                    opt = { ...base, chart: { ...base.chart, type: 'bar', height: 320 },
                        series: series.map(s => ({ name: s.name, data: s.data })),
                        plotOptions: { bar: { horizontal: false, columnWidth: series.length > 1 ? '75%' : '55%', borderRadius: 4, borderRadiusApplication: 'end' } },
                        dataLabels: { enabled: categories.length <= 8, offsetY: -8, style: { fontSize: '10px', colors: [C.chartDataLabel] }, formatter: v => fmtNum(v) },
                        xaxis: { categories, labels: { rotate: categories.length > 6 ? -45 : 0, rotateAlways: categories.length > 6, style: { fontSize: '10px' } } },
                        yaxis: { labels: { style: { fontSize: '10px' }, formatter: v => fmtNum(v) } } };
                    break;
                case 'line_chart':
                    opt = { ...base, chart: { ...base.chart, type: 'line', height: 320 },
                        series: series.map(s => ({ name: s.name, data: s.data })),
                        stroke: { curve: 'smooth', width: 2.5 }, markers: { size: 5, strokeWidth: 0, hover: { size: 7 } },
                        xaxis: { categories, labels: { rotate: categories.length > 8 ? -45 : 0, rotateAlways: categories.length > 8, style: { fontSize: '10px' } } },
                        yaxis: { labels: { style: { fontSize: '10px' }, formatter: v => fmtNum(v) } } };
                    break;
                case 'pie_chart':
                    opt = { ...base, chart: { ...base.chart, type: 'pie', height: 320 },
                        series: series[0].data, labels: categories,
                        dataLabels: { enabled: true, formatter: v => Math.round(v) + '%', style: { fontSize: '11px', fontWeight: 500 }, dropShadow: { enabled: false } },
                        plotOptions: { pie: { expandOnClick: true } }, stroke: { width: 1, colors: [C.chartStroke] } };
                    break;
                case 'donut_chart':
                    opt = { ...base, chart: { ...base.chart, type: 'donut', height: 320 },
                        series: series[0].data, labels: categories,
                        dataLabels: { enabled: true, formatter: v => Math.round(v) + '%', style: { fontSize: '11px', fontWeight: 500 }, dropShadow: { enabled: false } },
                        plotOptions: { pie: { donut: { size: '62%', labels: {
                            show: true, name: { show: true, fontSize: '12px', color: C.chartLegend },
                            value: { show: true, fontSize: '16px', fontWeight: 600, color: '#00d4ff', formatter: v => fmtNum(parseFloat(v)) },
                            total: { show: true, label: 'Total', fontSize: '11px', color: C.textMuted, formatter: w => fmtNum(w.globals.spikeWidth ? 0 : w.globals.series.reduce((a,b)=>a+b,0)) }
                        } } } }, stroke: { width: 1, colors: [C.chartStroke] } };
                    break;
                default: return;
            }
            try { new ApexCharts(el, opt).render(); } catch { el.innerHTML = `<div style="color:${C.textMuted};font-size:11px;padding:20px;text-align:center;">Chart rendering failed</div>`; }
        }

        function fmtNum(v) {
            if (v == null) return '';
            if (Math.abs(v) >= 1e6) return (v / 1e6).toFixed(1) + 'M';
            if (Math.abs(v) >= 1e3) return (v / 1e3).toFixed(1) + 'K';
            return Number.isInteger(v) ? v.toString() : v.toFixed(1);
        }

    })();

    // Helper available at module scope for HTML template
    function esc(s) { return s ? s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;') : ''; }

})();
