/**
 * Custom Tooltip — Instant, no-clip, appended to <body>
 *
 * Works with any element that has [data-tooltip="text"].
 * Appears instantly on hover above the element.
 * Never clips — rendered as a fixed-position overlay on <body>.
 *
 * Usage:
 *   <button class="btn-icon" data-tooltip="Edit">...</button>
 *
 * Auto-initializes via MutationObserver for dynamically rendered content.
 */
(function() {
    'use strict';

    let tooltipEl = null;
    let arrowEl = null;
    let currentTarget = null;
    let showTimeout = null;

    function createTooltip() {
        if (tooltipEl) return;

        tooltipEl = document.createElement('div');
        tooltipEl.className = 'custom-tooltip';
        tooltipEl.style.cssText = `
            position: fixed;
            z-index: 99999;
            padding: 6px 10px;
            border-radius: 6px;
            font-size: 0.72rem;
            font-weight: 500;
            letter-spacing: 0.02em;
            white-space: nowrap;
            pointer-events: none;
            opacity: 0;
            transition: opacity 0.12s ease;
            background: var(--tooltip-bg, var(--bg-tertiary, #1e293b));
            color: var(--tooltip-text, var(--text-primary, #f1f5f9));
            border: 1px solid var(--tooltip-border, var(--border-color-light, #334155));
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        `;

        arrowEl = document.createElement('div');
        arrowEl.style.cssText = `
            position: absolute;
            top: 100%;
            left: 50%;
            transform: translateX(-50%);
            border: 6px solid transparent;
            border-top-color: var(--tooltip-bg, var(--bg-tertiary, #1e293b));
        `;
        tooltipEl.appendChild(arrowEl);

        document.body.appendChild(tooltipEl);
    }

    function showTooltip(target) {
        const text = target.getAttribute('data-tooltip');
        if (!text) return;

        createTooltip();
        currentTarget = target;

        // Set text (arrow is a child, so prepend text node)
        tooltipEl.childNodes.forEach(n => { if (n !== arrowEl) n.remove(); });
        tooltipEl.insertBefore(document.createTextNode(text), arrowEl);

        // Auto-wrap long tooltips so a multi-sentence explanation doesn't
        // stretch into a single 1000px line that's hard to read. Short
        // labels like "Edit" stay nowrap so they don't break onto two lines
        // unnecessarily. Threshold tuned to ~60 chars / explicit newline /
        // explicit data-tooltip-wrap opt-in.
        const wantsWrap =
            target.hasAttribute('data-tooltip-wrap') ||
            text.length > 60 ||
            text.includes('\n');
        if (wantsWrap) {
            tooltipEl.style.whiteSpace = 'normal';
            tooltipEl.style.maxWidth = '320px';
            tooltipEl.style.lineHeight = '1.45';
            tooltipEl.style.textAlign = 'left';
        } else {
            tooltipEl.style.whiteSpace = 'nowrap';
            tooltipEl.style.maxWidth = '';
            tooltipEl.style.lineHeight = '';
            tooltipEl.style.textAlign = '';
        }

        // Position above the element
        const rect = target.getBoundingClientRect();
        tooltipEl.style.opacity = '0';
        tooltipEl.style.display = 'block';

        // Measure tooltip
        const tipRect = tooltipEl.getBoundingClientRect();
        let left = rect.left + rect.width / 2 - tipRect.width / 2;
        let top = rect.top - tipRect.height - 8;

        // Clamp to viewport
        if (left < 4) left = 4;
        if (left + tipRect.width > window.innerWidth - 4) left = window.innerWidth - tipRect.width - 4;
        if (top < 4) {
            // Show below instead
            top = rect.bottom + 8;
            arrowEl.style.top = '';
            arrowEl.style.bottom = '100%';
            arrowEl.style.borderTopColor = 'transparent';
            arrowEl.style.borderBottomColor = 'var(--tooltip-bg, var(--bg-tertiary, #1e293b))';
        } else {
            arrowEl.style.top = '100%';
            arrowEl.style.bottom = '';
            arrowEl.style.borderTopColor = 'var(--tooltip-bg, var(--bg-tertiary, #1e293b))';
            arrowEl.style.borderBottomColor = 'transparent';
        }

        tooltipEl.style.left = left + 'px';
        tooltipEl.style.top = top + 'px';

        // Fade in
        requestAnimationFrame(() => {
            tooltipEl.style.opacity = '1';
        });
    }

    function hideTooltip() {
        if (tooltipEl) {
            tooltipEl.style.opacity = '0';
            currentTarget = null;
        }
    }

    // Event delegation — works for dynamic content automatically
    document.addEventListener('mouseover', function(e) {
        const target = e.target.closest('[data-tooltip]');
        if (target && target !== currentTarget) {
            clearTimeout(showTimeout);
            showTooltip(target);
        }
    });

    document.addEventListener('mouseout', function(e) {
        const target = e.target.closest('[data-tooltip]');
        if (target) {
            clearTimeout(showTimeout);
            hideTooltip();
        }
    });

    // Hide on scroll
    document.addEventListener('scroll', hideTooltip, true);
})();
