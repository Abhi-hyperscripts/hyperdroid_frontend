/**
 * How a lead is NAMED on screen — one chain, one place.
 *
 * A lead does not necessarily have a person attached to it. Imported B2B lists
 * routinely carry a company, a phone and a job title with no individual named
 * at all: every one of the 50 leads sampled on the live tenant had an empty
 * first_name and last_name, and every one of them had a company.
 *
 * The chain below already existed — in the LeadDesk row and in the avatar
 * initials, which is why one lead could render as "Digital Ultras" with a "DU"
 * avatar in the list and as "UNKNOWN" in the detail header beside it. Three of
 * roughly ten sites implemented the fallback; the rest stopped at the person's
 * name and printed Unknown, (no name), or — in the convert-to-deal modal — a
 * deal literally named "- Deal".
 *
 * So the chain lives here and every display site calls it. A site that wants a
 * different last resort passes `fallback`; the lead number is NOT in the chain,
 * because several callers print it themselves and would otherwise say it twice.
 */
(function (global) {
    'use strict';

    function _clean(v) {
        return v === null || v === undefined ? '' : String(v).trim();
    }

    /**
     * @param {object} lead               a lead record (list payload or detail)
     * @param {object} [opts]
     * @param {string} [opts.fallback]    shown when there is no person AND no
     *                                    company. Defaults to an em dash; pass
     *                                    e.g. the lead number where that reads
     *                                    better than a dash.
     * @returns {string} never empty, never undefined
     */
    function leadDisplayName(lead, opts) {
        opts = opts || {};
        const fallback = opts.fallback === undefined ? '—' : opts.fallback;
        if (!lead) return fallback;

        const person = [lead.first_name, lead.last_name]
            .map(_clean).filter(Boolean).join(' ');
        if (person) return person;

        // company_name is the field the API returns; `company` is accepted
        // because some list payloads and the importer still use the short key.
        const company = _clean(lead.company_name) || _clean(lead.company);
        if (company) return company;

        return fallback;
    }

    /** Initials for the avatar, derived from the SAME name the row shows. */
    function leadNameInitials(lead) {
        const name = leadDisplayName(lead, { fallback: '' });
        if (!name) return '?';
        return name.split(/\s+/).filter(Boolean)
            .map(w => w[0]).slice(0, 2).join('').toUpperCase() || '?';
    }

    global.leadDisplayName = leadDisplayName;
    global.leadNameInitials = leadNameInitials;
    global.CrmLeadName = { leadDisplayName, leadNameInitials };
})(window);
