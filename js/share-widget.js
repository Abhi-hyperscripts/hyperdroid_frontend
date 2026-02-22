// ══════════════════════════════════════════════════════════════
// ShareWidget — Simple share dropdown (Email Card, Copy Link, WhatsApp, LinkedIn)
// Usage:
//   ShareWidget.float({ url, title, description, ogImage })    → fixed floating button
//   ShareWidget.openAt(anchorEl, { items: [...] })              → show dropdown
// ══════════════════════════════════════════════════════════════

const ShareWidget = (() => {
    let _cssInjected = false;
    let _activePopover = null;
    let _activeTrigger = null;

    // ── Inject CSS once ──
    function _injectCSS() {
        if (_cssInjected) return;
        _cssInjected = true;

        const style = document.createElement('style');
        style.textContent = `
/* ── ShareWidget styles (.sw- prefix) ── */

/* Floating bubble */
.sw-float-btn {
    position: fixed;
    bottom: 24px;
    left: 24px;
    z-index: 2147483646;
    width: 48px;
    height: 48px;
    border-radius: 50%;
    border: none;
    cursor: pointer;
    background: rgba(30, 30, 40, 0.85);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    box-shadow: 0 4px 20px rgba(0,0,0,0.3);
    display: flex;
    align-items: center;
    justify-content: center;
    transition: transform 0.2s, box-shadow 0.2s;
    color: #e2e8f0;
}
.sw-float-btn:hover {
    transform: scale(1.08);
    box-shadow: 0 6px 28px rgba(0,0,0,0.4);
    background: rgba(37, 99, 235, 0.85);
}

/* ── Dropdown — fixed, positioned via JS near anchor ── */
.sw-dropdown {
    position: fixed !important;
    z-index: 2147483647;
    background: #1e293b;
    border: 1px solid rgba(255,255,255,0.15);
    border-radius: 12px;
    padding: 6px;
    min-width: 210px;
    width: max-content;
    max-width: 300px;
    box-shadow: 0 12px 40px rgba(0,0,0,0.5);
    opacity: 0;
    transition: opacity 0.15s;
    pointer-events: none;
}
.sw-dropdown.sw-open {
    opacity: 1;
    pointer-events: auto;
}

/* Mobile: full-width action sheet at bottom */
@media (max-width: 600px) {
    .sw-dropdown {
        left: 12px !important;
        right: 12px !important;
        top: auto !important;
        bottom: 12px !important;
        width: auto;
        min-width: auto;
        max-width: none;
        border-radius: 16px;
        padding: 8px;
    }
}

/* Items */
.sw-dropdown-item {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 14px;
    border-radius: 8px;
    cursor: pointer;
    font-size: 13px;
    font-weight: 500;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    color: #e2e8f0;
    background: none;
    border: none;
    width: 100%;
    text-align: left;
    transition: background 0.12s;
    white-space: nowrap;
}
.sw-dropdown-item:hover {
    background: rgba(255,255,255,0.08);
}
.sw-dropdown-item svg { flex-shrink: 0; }

.sw-dropdown-sep {
    height: 1px;
    background: rgba(255,255,255,0.08);
    margin: 4px 8px;
}
.sw-dropdown-label {
    padding: 6px 14px 2px;
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: #64748b;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
}

/* Toast */
.sw-toast {
    position: fixed;
    bottom: 24px;
    left: 50%;
    transform: translateX(-50%) translateY(20px);
    z-index: 2147483647;
    background: var(--bg-secondary, #1e293b);
    color: var(--text-primary, #e2e8f0);
    border: 1px solid var(--border-primary, rgba(255,255,255,0.1));
    border-radius: 10px;
    padding: 10px 20px;
    font-size: 13px;
    font-weight: 500;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    box-shadow: 0 8px 30px rgba(0,0,0,0.3);
    opacity: 0;
    transition: opacity 0.2s, transform 0.2s;
    pointer-events: none;
}
.sw-toast.sw-toast-show {
    opacity: 1;
    transform: translateX(-50%) translateY(0);
}
`;
        document.head.appendChild(style);
    }

    // ── SVG Icons ──
    const ICONS = {
        share: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>`,
        link: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>`,
        guest: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/></svg>`,
        whatsapp: `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>`,
        linkedin: `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>`,
        mail: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>`
    };

    // ── Toast helper ──
    function _showToast(msg) {
        if (typeof Toast !== 'undefined' && Toast.success) { Toast.success(msg); return; }
        const el = document.createElement('div');
        el.className = 'sw-toast';
        el.textContent = msg;
        document.body.appendChild(el);
        requestAnimationFrame(() => el.classList.add('sw-toast-show'));
        setTimeout(() => { el.classList.remove('sw-toast-show'); setTimeout(() => el.remove(), 250); }, 2500);
    }

    // ── Build rich email card HTML ──
    function _buildEmailCard(opts) {
        const { url, title, description, ogImage, btnText } = opts;
        const btnLabel = btnText || (ogImage ? 'View Demo \u2192' : 'Join Meeting \u2192');
        return `<div style="max-width:600px;font-family:Arial,Helvetica,sans-serif;">
    <a href="${url}" target="_blank" style="text-decoration:none;color:inherit;">
        ${ogImage ? `<img src="${ogImage}" alt="${_escHtml(title)}" style="width:100%;border-radius:10px 10px 0 0;display:block;" />` : ''}
        <div style="background:#f8fafc;padding:20px 24px 24px;border:1px solid #e2e8f0;${ogImage ? 'border-top:none;' : ''}border-radius:${ogImage ? '0 0' : '10px 10px'} 10px 10px;">
            <h2 style="margin:0 0 8px;font-size:20px;font-weight:700;color:#0f172a;">${_escHtml(title)}</h2>
            <p style="margin:0 0 18px;font-size:14px;color:#475569;line-height:1.5;">${_escHtml(description)}</p>
            <a href="${url}" target="_blank" style="display:inline-block;padding:12px 28px;background:#2563eb;color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;border-radius:8px;">${btnLabel}</a>
        </div>
    </a>
</div>`;
    }

    function _escHtml(str) {
        const d = document.createElement('div');
        d.textContent = str || '';
        return d.innerHTML;
    }

    // ── Close any active dropdown ──
    function _closePopover() {
        if (_activePopover) {
            const old = _activePopover;
            _activePopover = null;
            _activeTrigger = null;
            old.classList.remove('sw-open');
            setTimeout(() => { if (old.parentNode) old.remove(); }, 180);
        }
    }

    // Click-outside listener (registered once)
    let _listenerAdded = false;
    let _openedThisFrame = false;
    function _ensureClickOutside() {
        if (_listenerAdded) return;
        _listenerAdded = true;
        document.addEventListener('click', (e) => {
            if (_openedThisFrame) return;
            if (_activePopover && !_activePopover.contains(e.target) &&
                !e.target.closest('.sw-float-btn') && !e.target.closest('[data-sw-trigger]')) {
                _closePopover();
            }
        });
    }

    // ── Build default items (for demo/generic pages) ──
    function _defaultItems(opts) {
        const { url, title, description, ogImage } = opts;
        return [
            { icon: ICONS.link, label: 'Copy Link', action: () => {
                navigator.clipboard.writeText(url).then(() => _showToast('Link copied!')).catch(() => _showToast('Could not copy'));
                _closePopover();
            }},
            { icon: ICONS.whatsapp, label: 'WhatsApp', action: () => {
                window.open('https://wa.me/?text=' + encodeURIComponent(title + '\n' + url), '_blank');
                _closePopover();
            }},
            { icon: ICONS.linkedin, label: 'LinkedIn', action: () => {
                window.open('https://www.linkedin.com/sharing/share-offsite/?url=' + encodeURIComponent(url), '_blank');
                _closePopover();
            }},
            { icon: ICONS.mail, label: 'Email Card', action: () => {
                const html = _buildEmailCard({ url, title, description, ogImage, btnText: opts.btnText });
                _copyRichHtml(html, 'Email card copied \u2014 paste into Outlook or Gmail!');
                _closePopover();
            }}
        ];
    }

    // ── Copy rich HTML to clipboard ──
    async function _copyRichHtml(html, toastMsg) {
        try {
            await navigator.clipboard.write([
                new ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }), 'text/plain': new Blob([html], { type: 'text/plain' }) })
            ]);
            _showToast(toastMsg);
        } catch (e) {
            try { await navigator.clipboard.writeText(html); _showToast(toastMsg); }
            catch (e2) { _showToast('Could not copy'); }
        }
    }

    // ═══════════════════════════
    // PUBLIC API
    // ═══════════════════════════

    /**
     * openAt(anchorEl, opts) — show dropdown (fixed bottom-right, no positioning math)
     */
    function openAt(anchorEl, opts) {
        _injectCSS();
        _ensureClickOutside();

        // Toggle off if same trigger
        if (_activePopover && _activeTrigger === anchorEl) { _closePopover(); return; }
        _closePopover();

        const items = opts.items || _defaultItems(opts);
        const pop = document.createElement('div');
        pop.className = 'sw-dropdown';

        items.forEach(item => {
            if (item.type === 'separator') { const s = document.createElement('div'); s.className = 'sw-dropdown-sep'; pop.appendChild(s); return; }
            if (item.type === 'label') { const l = document.createElement('div'); l.className = 'sw-dropdown-label'; l.textContent = item.text; pop.appendChild(l); return; }
            const btn = document.createElement('button');
            btn.className = 'sw-dropdown-item';
            btn.innerHTML = item.icon + '<span>' + item.label + '</span>';
            btn.addEventListener('click', (e) => { e.stopPropagation(); item.action(); });
            pop.appendChild(btn);
        });

        // Add to DOM to measure, then position near anchor
        document.body.appendChild(pop);
        _activePopover = pop;
        _activeTrigger = anchorEl;

        // Position: right-aligned below the button, flip above if no space
        const r = anchorEl.getBoundingClientRect();
        const pH = pop.offsetHeight;
        const pW = pop.offsetWidth;
        const spaceBelow = window.innerHeight - r.bottom - 8;
        const top = spaceBelow >= pH ? r.bottom + 4 : r.top - pH - 4;
        const left = Math.min(r.right - pW, window.innerWidth - pW - 8);

        pop.style.top = Math.max(8, top) + 'px';
        pop.style.left = Math.max(8, left) + 'px';

        _openedThisFrame = true;
        requestAnimationFrame(() => { _openedThisFrame = false; pop.classList.add('sw-open'); });
    }

    /**
     * float({ url, title, description, ogImage }) — fixed floating share bubble (bottom-left)
     */
    function float(opts) {
        _injectCSS();
        _ensureClickOutside();

        const btn = document.createElement('button');
        btn.className = 'sw-float-btn';
        btn.innerHTML = ICONS.share;
        btn.title = 'Share';
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            openAt(btn, Object.assign({ _float: true }, opts));
        });

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => document.body.appendChild(btn));
        } else {
            document.body.appendChild(btn);
        }
    }

    return { float, openAt, ICONS, buildEmailCard: _buildEmailCard, closePopover: _closePopover, showToast: _showToast };
})();
