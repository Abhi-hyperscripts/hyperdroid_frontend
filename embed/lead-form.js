/**
 * Ragenaizer Lead Capture Form Widget v2
 * Embeddable Shadow DOM lead form for external websites.
 * Supports backend-controlled styling via form_styling JSONB.
 *
 * Usage:
 *   <script src="https://crm.ragenaizer.com/embed/lead-form.js"
 *           data-key="WEBHOOK_KEY"
 *           data-api="https://crm.ragenaizer.com"
 *           data-trigger="#myButton"
 *           data-position="center"
 *           data-theme="light"></script>
 *
 * Attributes:
 *   data-key      — (required) Webhook key for the lead source
 *   data-api      — (optional) API base URL override. Defaults to script origin.
 *   data-trigger   — (optional) CSS selector for button(s) that open the form.
 *                     If omitted, call window.RagenazerLeadForm.open() manually.
 *   data-position  — (optional) Where the modal appears:
 *                     "center" (default), "top-right", "top-left",
 *                     "bottom-right", "bottom-left"
 *   data-theme     — (optional) "light" (default) or "dark"
 */
(function () {
    'use strict';

    if (window.__ragenaizer_lead_form_loaded) return;
    window.__ragenaizer_lead_form_loaded = true;

    const scriptEl = document.currentScript;
    const webhookKey = scriptEl?.getAttribute('data-key') || '';

    if (!webhookKey) {
        console.warn('[RagenazerLeadForm] Missing data-key on embed script.');
        return;
    }

    const explicitApi = scriptEl?.getAttribute('data-api') || '';
    const scriptSrc = scriptEl?.src || '';
    const scriptOrigin = scriptSrc ? new URL(scriptSrc).origin : '';
    const baseUrl = explicitApi || scriptOrigin;

    if (!baseUrl) {
        console.warn('[RagenazerLeadForm] Cannot determine API URL. Set data-api attribute.');
        return;
    }

    const triggerSelector = scriptEl?.getAttribute('data-trigger') || '';
    const attrPosition = scriptEl?.getAttribute('data-position') || '';
    const attrTheme = scriptEl?.getAttribute('data-theme') || '';

    // ── State ──────────────────────────────────────────────────────────────
    let formConfig = null;
    let isOpen = false;
    let host = null;
    let shadow = null;

    // ── Helpers ─────────────────────────────────────────────────────────────

    function hexToRgba(hex, opacity) {
        if (!hex || typeof hex !== 'string') return `rgba(0,0,0,${opacity})`;
        hex = hex.replace('#', '');
        if (hex.length === 3) hex = hex[0]+hex[0]+hex[1]+hex[1]+hex[2]+hex[2];
        const r = parseInt(hex.substring(0, 2), 16);
        const g = parseInt(hex.substring(2, 4), 16);
        const b = parseInt(hex.substring(4, 6), 16);
        if (isNaN(r) || isNaN(g) || isNaN(b)) return `rgba(0,0,0,${opacity})`;
        return `rgba(${r},${g},${b},${opacity})`;
    }

    // Same fonts map as the settings.js preview — keep parallel.
    const FONTS = {
        'system':         { gf: null, css: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' },
        'inter':          { gf: 'Inter:wght@300..700', css: '"Inter", system-ui, sans-serif' },
        'inter-tight':    { gf: 'Inter+Tight:wght@300..700', css: '"Inter Tight", "Inter", system-ui, sans-serif' },
        'roboto':         { gf: 'Roboto:wght@300..700', css: '"Roboto", system-ui, sans-serif' },
        'open-sans':      { gf: 'Open+Sans:wght@300..700', css: '"Open Sans", system-ui, sans-serif' },
        'space-grotesk':  { gf: 'Space+Grotesk:wght@300..700', css: '"Space Grotesk", system-ui, sans-serif' },
        'fraunces':       { gf: 'Fraunces:opsz,wght@9..144,300..700', css: '"Fraunces", Georgia, serif' },
        'playfair':       { gf: 'Playfair+Display:wght@400..900', css: '"Playfair Display", Georgia, serif' },
        'lora':           { gf: 'Lora:wght@400..700', css: '"Lora", Georgia, serif' },
        'jetbrains-mono': { gf: 'JetBrains+Mono:wght@300..700', css: '"JetBrains Mono", ui-monospace, monospace' },
        'fira-code':      { gf: 'Fira+Code:wght@300..700', css: '"Fira Code", ui-monospace, monospace' },
        'ibm-plex-mono':  { gf: 'IBM+Plex+Mono:wght@300..700', css: '"IBM Plex Mono", ui-monospace, monospace' },
        'space-mono':     { gf: 'Space+Mono:wght@400;700', css: '"Space Mono", ui-monospace, monospace' }
    };
    function fontFamily(key) { return (FONTS[key] || FONTS.system).css; }
    // Inject a Google Fonts <link> into the host document head (NOT the
    // Shadow DOM — fonts need to load at the document level for Shadow
    // DOM children to inherit them in all browsers).
    let _gfLoaded = false;
    function injectGoogleFonts(keys) {
        if (_gfLoaded) return;
        const families = [];
        const seen = new Set();
        for (const k of keys) {
            const f = FONTS[k];
            if (!f || !f.gf || seen.has(f.gf)) continue;
            seen.add(f.gf);
            families.push('family=' + f.gf);
        }
        if (families.length === 0) return;
        const url = `https://fonts.googleapis.com/css2?${families.join('&')}&display=swap`;
        const preconnect1 = document.createElement('link');
        preconnect1.rel = 'preconnect'; preconnect1.href = 'https://fonts.googleapis.com';
        const preconnect2 = document.createElement('link');
        preconnect2.rel = 'preconnect'; preconnect2.href = 'https://fonts.gstatic.com'; preconnect2.crossOrigin = '';
        const link = document.createElement('link');
        link.rel = 'stylesheet'; link.href = url;
        document.head.appendChild(preconnect1);
        document.head.appendChild(preconnect2);
        document.head.appendChild(link);
        _gfLoaded = true;
    }

    // ── Styling Resolution ──────────────────────────────────────────────────
    // Priority: backend styling > data-attributes > theme defaults

    function resolveStyling(backendStyling) {
        const bs = backendStyling || {};
        const theme = bs.theme || attrTheme || 'light';
        const isDark = theme === 'dark';

        // Design-system extras — shared baseline for all themes.
        const typographyDefaults = {
            font_heading: 'system',
            font_body: 'system',
            font_label: 'system',
            label_uppercase: false,
            headline_gradient: false,
            bg_style: 'solid',      // solid | gradient | aurora | grid | dots
            hud_brackets: false,
            button_gradient: false
        };

        // Theme defaults
        const lightDefaults = {
            theme: 'light',
            position: 'center',
            background_color: '#ffffff',
            background_opacity: 1.0,
            text_color: '#1e1e2e',
            label_color: '#3f3f46',
            input_bg_color: '#fafafa',
            input_text_color: '#1e1e2e',
            button_color: '#6366f1',
            button_hover_color: '#4f46e5',
            button_text_color: '#ffffff',
            button_text: 'Submit',
            border_color: '#e4e4e7',
            border_radius: 10,
            glassy_effect: false,
            show_labels: true,
            form_title: '',
            logo_url: '',
            logo_position: 'top',
            logo_height: 32,
            input_height: 40,
            button_height: 44,
            form_width: 440,
            ...typographyDefaults
        };

        const darkDefaults = {
            theme: 'dark',
            position: 'center',
            background_color: '#1e1e2e',
            background_opacity: 0.95,
            text_color: '#e4e4e7',
            label_color: '#d4d4d8',
            input_bg_color: '#27273a',
            input_text_color: '#e4e4e7',
            button_color: '#6366f1',
            button_hover_color: '#4f46e5',
            button_text_color: '#ffffff',
            button_text: 'Submit',
            border_color: '#3f3f46',
            border_radius: 10,
            glassy_effect: false,
            show_labels: true,
            form_title: '',
            logo_url: '',
            logo_position: 'top',
            logo_height: 32,
            input_height: 40,
            button_height: 44,
            form_width: 440,
            ...typographyDefaults
        };

        const defaults = isDark ? darkDefaults : lightDefaults;

        // Merge: defaults < data-attrs < backend
        const s = { ...defaults };

        // Override with data-attributes if present
        if (attrPosition) s.position = attrPosition;

        // Override with backend styling (only non-empty values)
        for (const [key, val] of Object.entries(bs)) {
            if (val !== null && val !== undefined && val !== '') {
                s[key] = val;
            }
        }

        return s;
    }

    // ── Styles ─────────────────────────────────────────────────────────────
    function getStyles(s) {
        const isDark = s.theme === 'dark';
        const radius = `${s.border_radius}px`;
        const bgRgba = hexToRgba(s.background_color, s.background_opacity);

        // Always use rgba so opacity slider works; add blur only when glassy
        const glassyModal = s.glassy_effect
            ? `backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px); border: 1px solid ${hexToRgba(s.border_color, 0.3)};`
            : '';
        const modalBg = bgRgba; // always rgba for opacity support

        // ── Design-system computed pieces ─────────────────────────────
        const fontHeading = fontFamily(s.font_heading);
        const fontBody = fontFamily(s.font_body);
        const fontLabel = fontFamily(s.font_label === 'system' ? s.font_body : s.font_label);

        const labelTransform = s.label_uppercase
            ? 'text-transform: uppercase; letter-spacing: 0.18em; font-size: 0.7rem;'
            : '';
        const titleGradient = s.headline_gradient
            ? 'background: linear-gradient(95deg, currentColor 0%, #A78BFA 35%, #38BDF8 75%, #BEF264 100%); -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent; color: transparent;'
            : '';
        const buttonGradient = s.button_gradient
            ? `background: linear-gradient(180deg, ${s.button_color} 0%, ${s.button_hover_color} 100%);`
            : `background: ${s.button_color};`;
        const buttonShadow = s.button_gradient
            ? `box-shadow: 0 14px 30px -10px ${hexToRgba(s.button_color, 0.55)}, inset 0 1px 0 rgba(255,255,255,0.22);`
            : '';

        // Extra top padding on body when nothing above it (no logo-top, no title)
        const hasTopContent = (s.logo_position === 'top' && s.logo_url) || s.form_title;
        const bodyPadTop = hasTopContent ? '20px' : '48px';

        // Position-specific overlay alignment
        const positionMap = {
            'center': 'justify-content: center; align-items: center;',
            'top-right': 'justify-content: flex-end; align-items: flex-start; padding: 24px;',
            'top-left': 'justify-content: flex-start; align-items: flex-start; padding: 24px;',
            'bottom-right': 'justify-content: flex-end; align-items: flex-end; padding: 24px;',
            'bottom-left': 'justify-content: flex-start; align-items: flex-end; padding: 24px;',
        };
        const overlayAlign = positionMap[s.position] || positionMap['center'];

        // Focus ring color based on button color
        const focusRingColor = hexToRgba(s.button_color, 0.15);

        return `
            :host { all: initial; }

            * { box-sizing: border-box; margin: 0; padding: 0; }

            .rlf-overlay {
                position: fixed;
                inset: 0;
                z-index: 2147483647;
                display: none;
                ${overlayAlign}
                background: rgba(0, 0, 0, 0.45);
                backdrop-filter: blur(4px);
                -webkit-backdrop-filter: blur(4px);
                opacity: 0;
                transition: opacity 0.2s ease;
            }

            .rlf-overlay.rlf-open {
                display: flex;
                opacity: 1;
            }

            .rlf-overlay.rlf-animating {
                display: flex;
            }

            .rlf-modal {
                position: relative;
                background: ${modalBg};
                border-radius: ${radius};
                box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.35);
                ${glassyModal}
                width: 100%;
                max-width: ${s.form_width || 440}px;
                max-height: 90vh;
                overflow-y: auto;
                transform: translateY(16px) scale(0.97);
                opacity: 0;
                transition: transform 0.25s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.2s ease;
                font-family: ${fontBody};
                color: ${s.text_color};
            }

            /* HUD corner brackets — small L-shapes top-left + bottom-right */
            .rlf-hud {
                position: absolute;
                width: 14px;
                height: 14px;
                border-color: ${hexToRgba(s.button_color, 0.7)};
                pointer-events: none;
                z-index: 1;
            }
            .rlf-hud-tl { top: 8px; left: 8px; border-top: 1px solid; border-left: 1px solid; }
            .rlf-hud-br { bottom: 8px; right: 8px; border-bottom: 1px solid; border-right: 1px solid; }

            /* Background motifs applied to the overlay backdrop */
            .rlf-overlay.rlf-motif-aurora::before {
                content: ""; position: absolute; inset: -10%; pointer-events: none;
                background:
                    radial-gradient(40vmax 30vmax at 18% 10%, rgba(124,58,237,0.45), transparent 60%),
                    radial-gradient(35vmax 28vmax at 85% 90%, rgba(34,211,238,0.35), transparent 60%),
                    radial-gradient(28vmax 22vmax at 50% 50%, rgba(99,102,241,0.20), transparent 60%);
                filter: blur(40px);
                opacity: 0.7;
            }
            .rlf-overlay.rlf-motif-grid::before {
                content: ""; position: absolute; inset: 0; pointer-events: none;
                background-image:
                    linear-gradient(rgba(255,255,255,0.04) 1px, transparent 1px),
                    linear-gradient(90deg, rgba(255,255,255,0.04) 1px, transparent 1px);
                background-size: 48px 48px;
                mask-image: radial-gradient(ellipse at center, black 30%, transparent 80%);
                -webkit-mask-image: radial-gradient(ellipse at center, black 30%, transparent 80%);
            }
            .rlf-overlay.rlf-motif-dots::before {
                content: ""; position: absolute; inset: 0; pointer-events: none;
                background-image: radial-gradient(rgba(255,255,255,0.07) 1px, transparent 1px);
                background-size: 28px 28px;
            }

            .rlf-open .rlf-modal {
                transform: translateY(0) scale(1);
                opacity: 1;
            }

            .rlf-close {
                position: absolute;
                top: 12px;
                right: 12px;
                z-index: 2;
                background: none;
                border: none;
                cursor: pointer;
                padding: 6px;
                border-radius: 8px;
                color: ${isDark ? '#a1a1aa' : '#71717a'};
                transition: background 0.15s, color 0.15s;
                display: flex;
                align-items: center;
                justify-content: center;
            }

            .rlf-close:hover {
                background: ${isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)'};
                color: ${s.text_color};
            }

            .rlf-header {
                padding: 20px 24px 0;
                padding-right: 48px;
            }

            .rlf-title {
                font-family: ${fontHeading};
                font-size: 1.4rem;
                font-weight: 600;
                letter-spacing: -0.02em;
                line-height: 1.15;
                color: ${s.text_color};
                ${titleGradient}
            }

            .rlf-body {
                padding: ${bodyPadTop} 24px 24px;
            }

            .rlf-field {
                margin-bottom: 16px;
            }

            .rlf-label {
                display: block;
                font-family: ${fontLabel};
                font-size: 0.82rem;
                font-weight: 600;
                margin-bottom: 6px;
                color: ${s.label_color};
                ${labelTransform}
            }

            .rlf-required {
                color: #ef4444;
                margin-left: 2px;
            }

            .rlf-input, .rlf-textarea {
                width: 100%;
                height: ${s.input_height || 40}px;
                padding: 0 14px;
                font-size: 0.92rem;
                font-family: inherit;
                border: 1.5px solid ${s.border_color};
                border-radius: ${radius};
                background: ${s.input_bg_color};
                color: ${s.input_text_color};
                transition: border-color 0.15s, box-shadow 0.15s;
                outline: none;
            }

            .rlf-input::placeholder, .rlf-textarea::placeholder {
                color: ${isDark ? '#71717a' : '#a1a1aa'};
            }

            .rlf-input:focus, .rlf-textarea:focus {
                border-color: ${s.button_color};
                box-shadow: 0 0 0 3px ${focusRingColor};
            }

            .rlf-textarea {
                height: auto;
                min-height: ${Math.round((s.input_height || 40) * 1.8)}px;
                padding: 8px 14px;
                resize: vertical;
            }

            .rlf-submit {
                width: 100%;
                height: ${s.button_height || 44}px;
                padding: 0 20px;
                font-size: 0.95rem;
                font-weight: 600;
                font-family: ${fontBody};
                border: none;
                border-radius: ${radius};
                cursor: pointer;
                ${buttonGradient}
                ${buttonShadow}
                color: ${s.button_text_color};
                transition: filter 0.15s, transform 0.1s;
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 8px;
                margin-top: 4px;
            }

            .rlf-submit:hover:not(:disabled) {
                ${s.button_gradient ? 'filter: brightness(1.08);' : `background: ${s.button_hover_color};`}
            }

            .rlf-submit:active:not(:disabled) {
                transform: scale(0.98);
            }

            .rlf-submit:disabled {
                opacity: 0.65;
                cursor: not-allowed;
            }

            .rlf-spinner {
                width: 18px;
                height: 18px;
                border: 2.5px solid rgba(255,255,255,0.3);
                border-top-color: ${s.button_text_color};
                border-radius: 50%;
                animation: rlf-spin 0.6s linear infinite;
                display: none;
            }

            .rlf-submit.rlf-loading .rlf-spinner { display: inline-block; }
            .rlf-submit.rlf-loading .rlf-btn-text { display: none; }

            @keyframes rlf-spin {
                to { transform: rotate(360deg); }
            }

            .rlf-error-msg {
                background: ${isDark ? '#3b1117' : '#fef2f2'};
                border: 1px solid ${isDark ? '#7f1d1d' : '#fecaca'};
                color: ${isDark ? '#fca5a5' : '#b91c1c'};
                padding: 10px 14px;
                border-radius: 8px;
                font-size: 0.84rem;
                margin-bottom: 12px;
                display: none;
            }

            .rlf-success {
                display: none;
                text-align: center;
                padding: 40px 24px;
            }

            .rlf-success-icon {
                width: 56px;
                height: 56px;
                background: ${isDark ? '#064e3b' : '#ecfdf5'};
                border-radius: 50%;
                display: flex;
                align-items: center;
                justify-content: center;
                margin: 0 auto 16px;
            }

            .rlf-success-icon svg {
                width: 28px;
                height: 28px;
                color: #10b981;
            }

            .rlf-success h3 {
                font-size: 1.15rem;
                font-weight: 700;
                margin-bottom: 6px;
                color: ${s.text_color};
            }

            .rlf-success p {
                font-size: 0.88rem;
                color: ${isDark ? '#a1a1aa' : '#71717a'};
            }

            .rlf-powered {
                text-align: center;
                padding: 0 24px 16px;
                font-size: 0.72rem;
                color: ${isDark ? '#52525b' : '#a1a1aa'};
            }

            .rlf-powered a {
                color: inherit;
                text-decoration: none;
            }

            .rlf-powered a:hover {
                text-decoration: underline;
            }

            .rlf-logo {
                text-align: center;
                padding: 16px 24px 4px;
            }

            .rlf-logo img {
                max-height: ${s.logo_height || 32}px;
                max-width: 80%;
                object-fit: contain;
            }

            .rlf-logo-bottom {
                padding: 4px 24px 12px;
            }

            /* Scrollbar */
            .rlf-modal::-webkit-scrollbar { width: 6px; }
            .rlf-modal::-webkit-scrollbar-track { background: transparent; }
            .rlf-modal::-webkit-scrollbar-thumb {
                background: ${isDark ? '#3f3f46' : '#d4d4d8'};
                border-radius: 3px;
            }

            @media (max-width: 480px) {
                .rlf-modal {
                    max-width: 100%;
                    max-height: 100vh;
                    border-radius: 0;
                    height: 100%;
                }
                .rlf-overlay {
                    padding: 0 !important;
                    justify-content: stretch !important;
                    align-items: stretch !important;
                }
            }
        `;
    }

    // ── Fetch form config ──────────────────────────────────────────────────
    async function fetchFormConfig() {
        try {
            const res = await fetch(`${baseUrl}/api/leads/capture/${webhookKey}/form-config?v=${Date.now()}`);
            if (!res.ok) return null;
            return await res.json();
        } catch (e) {
            console.warn('[RagenazerLeadForm] Failed to fetch form config:', e);
            return null;
        }
    }

    // ── Build DOM ──────────────────────────────────────────────────────────
    function buildWidget() {
        // Resolve styling from backend config
        const styling = resolveStyling(formConfig.styling);
        const buttonText = styling.button_text || 'Submit';

        // Load Google Fonts BEFORE the Shadow DOM mounts so the first paint
        // uses the right typeface. Browsers inherit document-level
        // @font-face into Shadow DOM children automatically.
        injectGoogleFonts([styling.font_heading, styling.font_body, styling.font_label]);

        host = document.createElement('div');
        host.id = 'ragenaizer-lead-form';
        shadow = host.attachShadow({ mode: 'closed' });

        // Styles
        const style = document.createElement('style');
        style.textContent = getStyles(styling);
        shadow.appendChild(style);

        // Overlay — motif class drives the aurora / grid / dots backdrop.
        const overlay = document.createElement('div');
        const motifSuffix = ['aurora', 'grid', 'dots'].includes(styling.bg_style)
            ? ` rlf-motif-${styling.bg_style}` : '';
        overlay.className = 'rlf-overlay' + motifSuffix;
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) closeForm();
        });

        // Modal
        const modal = document.createElement('div');
        modal.className = 'rlf-modal';
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-modal', 'true');

        // HUD corner brackets — small L-shaped accents pinned to the modal
        // corners. Only when the tenant has enabled the effect.
        if (styling.hud_brackets) {
            const hudTl = document.createElement('span');
            hudTl.className = 'rlf-hud rlf-hud-tl';
            const hudBr = document.createElement('span');
            hudBr.className = 'rlf-hud rlf-hud-br';
            modal.appendChild(hudTl);
            modal.appendChild(hudBr);
        }

        // Close button — absolutely positioned at top-right of card
        const closeBtn = document.createElement('button');
        closeBtn.className = 'rlf-close';
        closeBtn.setAttribute('aria-label', 'Close form');
        closeBtn.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
        closeBtn.addEventListener('click', closeForm);

        // Header — only rendered if form_title is set
        let header = null;
        const titleText = styling.form_title || '';
        if (titleText) {
            header = document.createElement('div');
            header.className = 'rlf-header';
            header.innerHTML = `<div class="rlf-title">${escapeHtml(titleText)}</div>`;
        }

        // Body (form)
        const body = document.createElement('div');
        body.className = 'rlf-body';

        const errorMsg = document.createElement('div');
        errorMsg.className = 'rlf-error-msg';

        const form = document.createElement('form');
        form.setAttribute('novalidate', '');

        // Build fields
        formConfig.fields.forEach(field => {
            const div = document.createElement('div');
            div.className = 'rlf-field';

            if (styling.show_labels !== false) {
                const label = document.createElement('label');
                label.className = 'rlf-label';
                label.textContent = field.label;
                if (field.required) {
                    const req = document.createElement('span');
                    req.className = 'rlf-required';
                    req.textContent = ' *';
                    label.appendChild(req);
                }
                div.appendChild(label);
            }

            let input;
            if (field.type === 'textarea') {
                input = document.createElement('textarea');
                input.className = 'rlf-textarea';
                input.rows = 3;
            } else {
                input = document.createElement('input');
                input.className = 'rlf-input';
                input.type = field.type || 'text';
            }
            input.name = field.name;
            input.placeholder = field.placeholder || '';
            if (field.required) input.required = true;

            div.appendChild(input);
            form.appendChild(div);
        });

        // Submit button
        const submitBtn = document.createElement('button');
        submitBtn.type = 'submit';
        submitBtn.className = 'rlf-submit';
        submitBtn.innerHTML = `<span class="rlf-btn-text">${escapeHtml(buttonText)}</span><span class="rlf-spinner"></span>`;
        form.appendChild(submitBtn);

        // Success state
        const success = document.createElement('div');
        success.className = 'rlf-success';
        success.innerHTML = `
            <div class="rlf-success-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="20 6 9 17 4 12"/>
                </svg>
            </div>
            <h3>Thank you!</h3>
            <p>We've received your information and will be in touch soon.</p>
        `;

        // Powered by
        const powered = document.createElement('div');
        powered.className = 'rlf-powered';
        powered.innerHTML = `Powered by <a href="https://ragenaizer.com" target="_blank" rel="noopener">Ragenaizer</a>`;

        // Form submit handler
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            errorMsg.style.display = 'none';

            // Basic client-side validation
            const requiredFields = form.querySelectorAll('[required]');
            for (const f of requiredFields) {
                if (!f.value.trim()) {
                    f.focus();
                    errorMsg.textContent = `Please fill in ${f.name.replace(/_/g, ' ')}`;
                    errorMsg.style.display = 'block';
                    return;
                }
            }

            // Email validation
            const emailInput = form.querySelector('input[type="email"]');
            if (emailInput && emailInput.value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailInput.value)) {
                emailInput.focus();
                errorMsg.textContent = 'Please enter a valid email address';
                errorMsg.style.display = 'block';
                return;
            }

            submitBtn.classList.add('rlf-loading');
            submitBtn.disabled = true;

            try {
                const formData = {};
                new FormData(form).forEach((v, k) => { formData[k] = v; });

                const webhookUrl = `${baseUrl}${formConfig.webhook_url}`;
                const res = await fetch(webhookUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(formData)
                });

                if (!res.ok) {
                    const data = await res.json().catch(() => ({}));
                    throw new Error(data.error || 'Submission failed');
                }

                // Show success
                form.style.display = 'none';
                errorMsg.style.display = 'none';
                success.style.display = 'block';

                // Auto-close after 3 seconds
                setTimeout(() => {
                    closeForm();
                    // Reset for next open
                    setTimeout(() => {
                        form.style.display = '';
                        success.style.display = 'none';
                        form.reset();
                    }, 300);
                }, 3000);

            } catch (err) {
                errorMsg.textContent = err.message || 'Something went wrong. Please try again.';
                errorMsg.style.display = 'block';
            } finally {
                submitBtn.classList.remove('rlf-loading');
                submitBtn.disabled = false;
            }
        });

        // Logo element
        let logoEl = null;
        if (styling.logo_url) {
            logoEl = document.createElement('div');
            logoEl.className = 'rlf-logo' + (styling.logo_position === 'bottom' ? ' rlf-logo-bottom' : '');
            const logoImg = document.createElement('img');
            logoImg.src = styling.logo_url;
            logoImg.alt = 'Logo';
            logoImg.onerror = function() { this.style.display = 'none'; };
            logoEl.appendChild(logoImg);
        }

        // Assemble
        body.appendChild(errorMsg);
        body.appendChild(form);
        body.appendChild(success);
        modal.appendChild(closeBtn);
        if (logoEl && styling.logo_position === 'top') modal.appendChild(logoEl);
        if (header) modal.appendChild(header);
        modal.appendChild(body);
        if (logoEl && styling.logo_position === 'bottom') modal.appendChild(logoEl);
        modal.appendChild(powered);
        overlay.appendChild(modal);
        shadow.appendChild(overlay);

        document.body.appendChild(host);

        // ESC to close
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && isOpen) closeForm();
        });

        return overlay;
    }

    // ── Open / Close ───────────────────────────────────────────────────────
    let overlayEl = null;

    function openForm() {
        if (!formConfig || !overlayEl) return;
        if (isOpen) return;

        isOpen = true;
        overlayEl.classList.add('rlf-animating');
        // Trigger reflow then add open class for animation
        void overlayEl.offsetHeight;
        overlayEl.classList.add('rlf-open');
        document.body.style.overflow = 'hidden';
    }

    function closeForm() {
        if (!isOpen) return;
        isOpen = false;

        overlayEl.classList.remove('rlf-open');
        document.body.style.overflow = '';

        // Remove after animation
        setTimeout(() => {
            overlayEl.classList.remove('rlf-animating');
        }, 250);
    }

    // ── Escape HTML ────────────────────────────────────────────────────────
    function escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str || '';
        return div.innerHTML;
    }

    // ── Init ───────────────────────────────────────────────────────────────
    async function init() {
        formConfig = await fetchFormConfig();
        if (!formConfig || !formConfig.fields || formConfig.fields.length === 0) {
            console.warn('[RagenazerLeadForm] No form config returned. Widget will not render.');
            return;
        }

        overlayEl = buildWidget();

        // Bind trigger buttons if selector is provided
        if (triggerSelector) {
            // Use event delegation on document for dynamically created buttons
            document.addEventListener('click', (e) => {
                if (e.target.closest(triggerSelector)) {
                    e.preventDefault();
                    openForm();
                }
            });
        }

        // Expose global API
        window.RagenazerLeadForm = {
            open: openForm,
            close: closeForm,
            isOpen: () => isOpen
        };
    }

    // Run init when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
