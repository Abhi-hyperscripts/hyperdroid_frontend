/**
 * Tap-to-call helper for CRM.
 *
 * Wraps a phone number in a <a href="tel:..."> anchor so a tap on mobile
 * (PWA on iOS / Android) opens the dialer. On desktop browsers the OS
 * decides what to do (Skype / FaceTime / nothing) — the anchor is a
 * harmless no-op when no handler is registered.
 *
 * Why a shared helper instead of inlining `<a href="tel:...">` at every
 * call site: number normalization is non-trivial (strip spaces / parens /
 * dashes / dots, prepend "+" when looks-international). Doing it in one
 * place means a future fix (e.g. fall back to whatsapp:// for some
 * countries) lands once.
 *
 * Public API (all on window.CrmPhoneLink, since CRM JS isn't bundled):
 *   crmPhoneLink(rawPhone, opts?)  → HTML string with anchor + 📞 icon,
 *                                     or "-" if rawPhone is empty/null.
 *   crmPhoneHref(rawPhone)         → just the "tel:..." string for cases
 *                                     where you need the href yourself.
 *   crmNormalizePhone(rawPhone)    → cleaned digits-only string with "+".
 */
(function (global) {
    'use strict';

    function _esc(s) {
        return String(s).replace(/[&<>"']/g, c => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        }[c]));
    }

    /**
     * Strip every char that isn't a digit or "+", and ensure exactly one
     * leading "+". Numbers without a leading "+" but >= 10 digits are
     * treated as already-international and just have "+" prepended; pure
     * 10-digit local numbers (most Indian leads) get "+91" prepended so
     * the dialer always has enough info.
     *
     * Override the default country code via `<body data-default-country-code="44">`
     * (or any data-default-country-code attr on <html>/<body>) so a UK
     * tenant gets +44 prefixed instead of +91.
     */
    function crmNormalizePhone(raw) {
        if (raw === null || raw === undefined) return '';
        let s = String(raw).trim();
        if (!s) return '';

        // Has a "+"? Trust it as international, just strip non-digits after.
        if (s.startsWith('+')) {
            return '+' + s.slice(1).replace(/[^\d]/g, '');
        }

        // No "+". Strip everything except digits.
        const digits = s.replace(/[^\d]/g, '');
        if (!digits) return '';

        // 10 digits → assume local, prepend tenant default country code.
        if (digits.length === 10) {
            const cc = (document.body && document.body.dataset.defaultCountryCode)
                    || (document.documentElement && document.documentElement.dataset.defaultCountryCode)
                    || '91';
            return '+' + cc + digits;
        }

        // 11+ digits → assume already includes country code, just prepend "+".
        return '+' + digits;
    }

    function crmPhoneHref(raw) {
        const norm = crmNormalizePhone(raw);
        return norm ? 'tel:' + norm : '';
    }

    /**
     * Render a phone number as a tap-to-call anchor.
     *
     * opts:
     *   display       — text to render inside the anchor. Defaults to the
     *                   ORIGINAL raw input (preserves pretty formatting like
     *                   "+91 98506 84450" the user entered).
     *   showIcon      — prepend a 📞 emoji. Default true.
     *   emptyFallback — what to render when raw is falsy. Default '-'.
     *   className     — extra CSS class on the anchor.
     */
    function crmPhoneLink(raw, opts) {
        opts = opts || {};
        const empty = opts.emptyFallback === undefined ? '-' : opts.emptyFallback;
        if (raw === null || raw === undefined || String(raw).trim() === '') return empty;

        const href = crmPhoneHref(raw);
        if (!href) return empty;

        const display = opts.display || String(raw);
        const showIcon = opts.showIcon !== false;
        const cls = 'crm-tel-link' + (opts.className ? ' ' + opts.className : '');

        const icon = showIcon
            ? '<span class="crm-tel-icon" aria-hidden="true" style="margin-right:4px;">📞</span>'
            : '';

        return '<a href="' + _esc(href) + '" class="' + _esc(cls) + '" '
             + 'title="Call ' + _esc(display) + '" '
             + 'style="color:inherit;text-decoration:none;">'
             + icon + _esc(display) + '</a>';
    }

    global.crmNormalizePhone = crmNormalizePhone;
    global.crmPhoneHref = crmPhoneHref;
    global.crmPhoneLink = crmPhoneLink;
    global.CrmPhoneLink = { crmNormalizePhone, crmPhoneHref, crmPhoneLink };
})(window);
