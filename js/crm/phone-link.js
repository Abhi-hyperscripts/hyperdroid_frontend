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
     * Build a WhatsApp deep link (https://wa.me/<intl-no-plus>).
     *
     * Opens the WhatsApp app on iOS / Android (PWA or browser); falls back
     * to wa.me web flow on desktop.
     *
     * Format: wa.me/ requires the FULL international number with no "+",
     * no spaces, no leading zeros — opposite of tel: which strips the
     * country code. So "+91 98506 84450" → "wa.me/919850684450".
     */
    function crmWhatsappHref(raw) {
        const norm = crmNormalizePhone(raw); // "+CCNNNN..."
        if (!norm) return '';
        return 'https://wa.me/' + norm.slice(1); // drop the leading "+"
    }

    // Inline SVG of WhatsApp's logo glyph in their official green (#25D366).
    // Used as a contact-method indicator next to phone numbers — this is
    // the standard reduced-mark WhatsApp publishes for "tap to chat" links.
    const _WA_SVG = '<svg viewBox="0 0 24 24" width="14" height="14" fill="#25D366" '
                  + 'aria-hidden="true" style="vertical-align:-2px;">'
                  + '<path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51l-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413"/>'
                  + '</svg>';

    /**
     * Render phone-number contact actions: tap-to-call link + (by default)
     * a WhatsApp button alongside.
     *
     * Output is a single inline group like:
     *   📞 +91 98506 84450  [WA]
     * where the number-with-📞 dials when tapped and [WA] opens WhatsApp.
     *
     * opts:
     *   display       — text to render inside the call anchor. Defaults to
     *                   the ORIGINAL raw input (preserves pretty formatting).
     *   showIcon      — prepend a 📞 emoji to the call anchor. Default true.
     *   emptyFallback — render this when raw is falsy. Default '-'.
     *   className     — extra CSS class on the call anchor.
     *   whatsapp      — also render the WhatsApp button. Default true.
     */
    function crmPhoneLink(raw, opts) {
        opts = opts || {};
        const empty = opts.emptyFallback === undefined ? '-' : opts.emptyFallback;
        if (raw === null || raw === undefined || String(raw).trim() === '') return empty;

        const telHref = crmPhoneHref(raw);
        if (!telHref) return empty;

        const display = opts.display || String(raw);
        const showIcon = opts.showIcon !== false;
        const includeWhatsapp = opts.whatsapp !== false;
        const cls = 'crm-tel-link' + (opts.className ? ' ' + opts.className : '');

        const icon = showIcon
            ? '<span class="crm-tel-icon" aria-hidden="true" style="margin-right:4px;">📞</span>'
            : '';

        const callAnchor =
              '<a href="' + _esc(telHref) + '" class="' + _esc(cls) + '" '
            + 'title="Call ' + _esc(display) + '" '
            + 'style="color:inherit;text-decoration:none;">'
            + icon + _esc(display) + '</a>';

        if (!includeWhatsapp) return callAnchor;

        const waHref = crmWhatsappHref(raw);
        if (!waHref) return callAnchor;

        const waAnchor =
              '<a href="' + _esc(waHref) + '" target="_blank" rel="noopener noreferrer" '
            + 'class="crm-wa-link" title="WhatsApp ' + _esc(display) + '" '
            + 'style="display:inline-flex;align-items:center;justify-content:center;'
            + 'margin-left:6px;text-decoration:none;line-height:0;" '
            + 'onclick="event.stopPropagation();">'
            + _WA_SVG + '</a>';

        return callAnchor + waAnchor;
    }

    global.crmNormalizePhone = crmNormalizePhone;
    global.crmPhoneHref = crmPhoneHref;
    global.crmWhatsappHref = crmWhatsappHref;
    global.crmPhoneLink = crmPhoneLink;
    global.CrmPhoneLink = { crmNormalizePhone, crmPhoneHref, crmWhatsappHref, crmPhoneLink };
})(window);
