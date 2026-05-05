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

    function _defaultCountryCode() {
        return (document.body && document.body.dataset.defaultCountryCode)
            || (document.documentElement && document.documentElement.dataset.defaultCountryCode)
            || '91';
    }

    /**
     * Normalize a raw phone string to "+CCNNNNNNN..." form.
     *
     * - Strips spaces, parens, dashes, dots.
     * - Numbers with leading "+" are trusted as already-international.
     * - Pure 10-digit local numbers get the tenant default country code
     *   prepended (e.g. "9850684450" → "+919850684450").
     * - 11+ digit numbers without "+" are assumed to already include a
     *   country code; "+" is just prepended.
     *
     * Override the default country code via
     *   <body data-default-country-code="44">
     * so a UK tenant gets +44 prefixed instead of +91.
     */
    function crmNormalizePhone(raw) {
        if (raw === null || raw === undefined) return '';
        let s = String(raw).trim();
        if (!s) return '';

        if (s.startsWith('+')) {
            return '+' + s.slice(1).replace(/[^\d]/g, '');
        }

        let digits = s.replace(/[^\d]/g, '');
        if (!digits) return '';

        // Strip leading zeros — covers two common dial-out prefixes:
        //   "0" before a national mobile number (India STD trunk, UK
        //       trunk: "08586084450" → "8586084450").
        //   "00" international dial-out prefix used in many countries
        //       ("00919858608450" → "919858608450").
        // Without this, "08586084450" was 11 digits → fell through to the
        // "already has country code" branch → tel:+08586084450 → dialer
        // rings a literal "+0..." that fails on most networks.
        digits = digits.replace(/^0+/, '');
        if (!digits) return '';

        if (digits.length === 10) {
            return '+' + _defaultCountryCode() + digits;
        }
        return '+' + digits;
    }

    /**
     * Build the tel: href.
     *
     * IMPORTANT: when the normalized number begins with the tenant's default
     * country code, we STRIP that prefix from what the dialer rings — so a
     * lead stored as "+91 98506 84450" hands the user's phone "9850684450"
     * to call locally (cheaper, avoids weird roaming/carrier interpretations,
     * matches what users would dial themselves). Numbers from a different
     * country (e.g. "+1 415 555 2671" when the tenant is +91) keep their
     * country code so they still route as international calls.
     *
     * The visible display string is untouched — still shows "+91 98506 84450".
     */
    function crmPhoneHref(raw) {
        const norm = crmNormalizePhone(raw);
        if (!norm) return '';
        const cc = _defaultCountryCode();
        const ccPrefix = '+' + cc;
        if (norm.startsWith(ccPrefix)) {
            // Strip the default country code; trailing digits go to the dialer.
            return 'tel:' + norm.slice(ccPrefix.length);
        }
        return 'tel:' + norm;
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
