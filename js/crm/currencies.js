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

    global.CRM_CURRENCIES = CRM_CURRENCIES;
    global.populateCurrencySelect = populateCurrencySelect;
})(window);
