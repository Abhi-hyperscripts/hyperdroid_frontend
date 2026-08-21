/**
 * The currencies the product trades in — one list for the whole CRM UI.
 *
 * There were three, all different: AccountsService denominates invoices in 41,
 * the CRM settings page offered 12, and the deal form offered 7. A tenant
 * trading in SGD, CHF or SAR could not pick their own currency on a deal, and
 * the deal API validated nothing at all — so the field was simultaneously too
 * narrow in the UI and wide open at the API.
 *
 * Keep in step with CRM/Services/CurrencyCodes.cs, which is checked on write,
 * and with AccountsService/BusinessLayers/BusinessLayer_Currency.cs, which is
 * the authority. CurrencyVocabularyTests asserts the count so the backend copy
 * cannot drift silently; this file has no such tripwire, so a currency added
 * downstream must be added here by hand.
 */
(function (global) {
    'use strict';

    // code, symbol, name — ordered as AccountsService lists them, so the
    // currencies most tenants want are at the top rather than alphabetised.
    const CRM_CURRENCIES = [
        ['INR', '₹', 'Indian Rupee'],
        ['USD', '$', 'US Dollar'],
        ['EUR', '€', 'Euro'],
        ['GBP', '£', 'British Pound'],
        ['AED', 'د.إ', 'UAE Dirham'],
        ['SGD', 'S$', 'Singapore Dollar'],
        ['AUD', 'A$', 'Australian Dollar'],
        ['CAD', 'C$', 'Canadian Dollar'],
        ['JPY', '¥', 'Japanese Yen'],
        ['CHF', 'CHF', 'Swiss Franc'],
        ['SAR', '﷼', 'Saudi Riyal'],
        ['QAR', '﷼', 'Qatari Riyal'],
        ['KWD', 'د.ك', 'Kuwaiti Dinar'],
        ['BHD', '.د.ب', 'Bahraini Dinar'],
        ['OMR', '﷼', 'Omani Rial'],
        ['HKD', 'HK$', 'Hong Kong Dollar'],
        ['NZD', 'NZ$', 'New Zealand Dollar'],
        ['ZAR', 'R', 'South African Rand'],
        ['MYR', 'RM', 'Malaysian Ringgit'],
        ['THB', '฿', 'Thai Baht'],
        ['IDR', 'Rp', 'Indonesian Rupiah'],
        ['PHP', '₱', 'Philippine Peso'],
        ['BDT', '৳', 'Bangladeshi Taka'],
        ['LKR', 'Rs', 'Sri Lankan Rupee'],
        ['NPR', 'Rs', 'Nepalese Rupee'],
        ['CNY', '¥', 'Chinese Yuan'],
        ['KRW', '₩', 'South Korean Won'],
        ['SEK', 'kr', 'Swedish Krona'],
        ['NOK', 'kr', 'Norwegian Krone'],
        ['DKK', 'kr', 'Danish Krone'],
        ['PLN', 'zł', 'Polish Zloty'],
        ['CZK', 'Kč', 'Czech Koruna'],
        ['ILS', '₪', 'Israeli Shekel'],
        ['TRY', '₺', 'Turkish Lira'],
        ['MXN', 'Mex$', 'Mexican Peso'],
        ['BRL', 'R$', 'Brazilian Real'],
        ['KES', 'KSh', 'Kenyan Shilling'],
        ['NGN', '₦', 'Nigerian Naira'],
        ['EGP', 'E£', 'Egyptian Pound'],
        ['MUR', 'Rs', 'Mauritian Rupee'],
        ['MVR', 'Rf', 'Maldivian Rufiyaa'],
    ];

    /**
     * Fills a <select> with the currency list.
     *
     * @param {string} selectId    element id
     * @param {boolean} withName   "INR (₹) - Indian Rupee" vs plain "INR"
     * @param {string} [selected]  code to preselect; the current value is kept
     *                             when it is still a currency we offer
     */
    function populateCurrencySelect(selectId, withName, selected) {
        const el = document.getElementById(selectId);
        if (!el) return;

        // Preserve whatever was chosen — this runs on page load, and a deal
        // being edited may already hold a currency.
        const keep = selected || el.value;

        el.innerHTML = CRM_CURRENCIES.map(function (c) {
            const label = withName
                ? c[0] + ' (' + c[1] + ') - ' + c[2]
                : c[0];
            return '<option value="' + c[0] + '">' + label + '</option>';
        }).join('');

        if (keep && CRM_CURRENCIES.some(function (c) { return c[0] === keep; })) el.value = keep;
    }

    /**
     * Format money for display — ONE implementation for the whole CRM UI.
     *
     * ⭐ THE LOCALE MUST FOLLOW THE CURRENCY, NOT THE OTHER WAY ROUND.
     *
     * Four separate copies of this helper had 'en-IN' hard-coded, so every
     * amount in every currency was grouped Indian-style: a $400,000 deal in a
     * USD workspace rendered as "$4,00,000.00". That is not a near-miss — lakh
     * grouping reads as a different NUMBER to anybody outside South Asia, and
     * the figure appears on deal values, commission, quotations and instalment
     * schedules.
     *
     * Indian grouping is correct for INR and wrong for everything else, so the
     * rule is exactly that. Other currencies use en-US grouping, which is
     * pinned rather than left to the browser so two people looking at the same
     * deal see the same string.
     *
     * @param {number|string} amount
     * @param {string} [code] ISO currency code; defaults to INR
     * @returns {string} formatted amount, or an em dash when there is no number
     */
    function formatMoney(amount, code) {
        if (amount === null || amount === undefined || amount === '') return '\u2014';
        const n = Number(amount);
        if (!isFinite(n)) return '\u2014';

        const currency = code || 'INR';
        const locale = currency === 'INR' ? 'en-IN' : 'en-US';
        try {
            return new Intl.NumberFormat(locale, {
                style: 'currency', currency: currency, maximumFractionDigits: 2,
            }).format(n);
        } catch (_) {
            // An unrecognised ISO code makes Intl THROW rather than degrade, and
            // a deal can carry any three letters somebody typed.
            return (currency + ' ' + n.toFixed(2)).trim();
        }
    }

    /**
     * The tenant's own currency, fetched once and remembered.
     *
     * ⭐ A LEAD HAS NO CURRENCY COLUMN. estimated_value and won_deal_value are
     * bare decimals, so every screen showing them was left to guess — and three
     * of them guessed by writing a rupee sign into the template. A USD-base
     * tenant read "₹4,00,000" against a deal stored as USD 400,000, on the card
     * a rep opens to recall what was agreed.
     *
     * The tenant setting is the honest answer for a value with no currency of
     * its own, and it already existed: deals.js and dashboard.js each fetched
     * it separately. One cached promise means one request per page instead of
     * one per caller, and one place to change when leads gain a currency of
     * their own.
     */
    let tenantCurrencyPromise = null;
    let tenantCurrency = null;

    function loadTenantCurrency() {
        if (tenantCurrencyPromise) return tenantCurrencyPromise;
        tenantCurrencyPromise = (async () => {
            try {
                const res = await api.request('/crm/crm-settings/default_currency');
                if (res && res.value) tenantCurrency = String(res.value).toUpperCase();
            } catch (_) {
                // Not configured, or the caller lacks the settings scope. The
                // formatter's own default applies; a missing setting must not
                // stop a page rendering its numbers.
            }
            return tenantCurrency;
        })();
        return tenantCurrencyPromise;
    }

    /**
     * Synchronous, for use inside a render.
     *
     * Returns null until loadTenantCurrency() has resolved, and formatMoney
     * falls back to its own default for null — so a first paint is never
     * blocked on a settings request.
     */
    function tenantMoney(amount) {
        return formatMoney(amount, tenantCurrency);
    }

    global.CRM_CURRENCIES = CRM_CURRENCIES;
    global.populateCurrencySelect = populateCurrencySelect;
    global.formatMoney = formatMoney;
    global.loadTenantCurrency = loadTenantCurrency;
    global.tenantMoney = tenantMoney;
})(window);
