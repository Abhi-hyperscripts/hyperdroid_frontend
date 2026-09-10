/**
 * Customer quick-add
 * ----------------------------------------------------------------------------
 * Create a customer without leaving the invoice / proforma form.
 *
 * WIRING. Put `data-quick-add="openCustomerQuickAdd"` on the customer <select>.
 * js/auto-searchable-select.js reads that attribute and renders the "+" button
 * inside the SearchableDropdown it builds over the select. The native <select>
 * stays in the DOM and stays the source of truth, so the ~11 existing
 * `getElementById('invoiceCustomerId').value` reads and writes keep working
 * untouched.
 *
 * ⭐ WHY THIS IS A MODAL AND NOT AN INLINE PANEL. The customer picker sits
 * inside <form id="invoiceForm">. Inputs added there become part of THAT form:
 * a `required` customer field silently blocks the INVOICE submit — the browser
 * returns from reportValidity() with no toast and no request, which reads as
 * "the button does nothing" — and Enter submits the wrong form. Appending to
 * document.body sidesteps both, and matches the five quick-adds already in the
 * codebase (accounts, salts).
 *
 * ⭐ WHY THE FORM IS NOT SHORT. BusinessLayer_Customers.cs:43-73 rejects a
 * customer missing name, email, address line 1, city or country; plus phone,
 * state and state_code unless overseas; plus GSTIN when registered. A
 * three-field panel would only produce a chain of 400s, so this collects the
 * real required set — 9 fields for a registered B2B buyer, 8 for B2C, 5 for
 * an overseas one.
 *
 * ⭐ WHY GST TREATMENT LEADS. BusinessLayer_CustomerInvoices.cs:269 resolves
 * the sales GST from customer.state_code AND customer.gst_treatment, and :378
 * zero-rates the whole invoice when the treatment is 'overseas'. A customer
 * saved with the wrong state produces a wrong CGST/SGST-vs-IGST split on a
 * real tax invoice and nothing downstream flags it. Making customer creation
 * fast is exactly the change that makes that mistake likelier, so treatment
 * and state are the first things asked for, never tucked behind "advanced".
 *
 * CONTRACT. On success this dispatches `accounts:customer-created` on document
 * with detail { customer, customers, sourceSelectId }. The module does NOT
 * touch the select itself: only the page knows its own module-scope `customers`
 * array, and that array is what feeds zero-rating, price-list lookup and the
 * HSN warning. A page that repopulated the <select> but left its array stale
 * would show the new customer and then silently mis-handle it.
 */
(function () {
    'use strict';

    const MODAL_ID = 'customerQuickAddModal';
    let regionPicker = null;
    let sourceSelect = null;
    let knownCustomers = [];

    // ── duplicate detection ──────────────────────────────────────────────
    // The whole premise of this feature is "the customer isn't in the list",
    // which is the exact moment somebody types "Acme Pvt Ltd" over an existing
    // "Acme Private Limited". The backend uniques only on the auto-generated
    // customer_code (DatabaseLayer_Customers.cs:47) — never on name or GSTIN —
    // so nothing else stops a duplicate, and a split ledger makes AR ageing
    // stop adding up.
    const SUFFIXES = /\b(pvt|private|ltd|limited|llp|inc|incorporated|corp|corporation|co|company|and|&)\b/g;

    function normaliseName(s) {
        return String(s || '')
            .toLowerCase()
            .replace(SUFFIXES, ' ')
            .replace(/[^a-z0-9]+/g, '')
            .trim();
    }

    function findGstinTwin(gstin) {
        const g = String(gstin || '').trim().toUpperCase();
        if (!g) return null;
        return knownCustomers.find(c => String(c.tax_id || '').trim().toUpperCase() === g) || null;
    }

    function findNameTwin(name) {
        const n = normaliseName(name);
        if (n.length < 3) return null;
        return knownCustomers.find(c => normaliseName(c.name) === n) || null;
    }

    // ── markup ───────────────────────────────────────────────────────────

    function buildModal() {
        const m = document.createElement('div');
        m.id = MODAL_ID;
        m.className = 'modal';
        m.innerHTML = `
            <!-- The width goes on the DIALOG, not the content: .modal-dialog
                 caps at 520px in the shared modal CSS, so a max-width on
                 .modal-content alone is silently overridden and the two-column
                 rows end up cramped enough to scroll sideways. -->
            <div class="modal-dialog modal-dialog-centered" style="max-width: 860px; width: min(94vw, 860px);">
                <div class="modal-content" style="max-width: none; width: 100%;">
                    <div class="modal-header">
                        <h5 class="modal-title">Add Customer</h5>
                        <button class="close-btn" type="button" data-cqa-close aria-label="Close">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                        </button>
                    </div>
                    <div class="modal-body">

                        <div class="form-row">
                            <div class="form-group">
                                <label for="cqaTreatment">GST Treatment <span class="req">*</span></label>
                                <select id="cqaTreatment" class="form-control">
                                    <option value="registered">Registered (has GSTIN)</option>
                                    <option value="unregistered">Unregistered / B2C (no GSTIN)</option>
                                    <option value="composition">Composition dealer</option>
                                    <option value="overseas">Overseas / Export</option>
                                </select>
                                <small id="cqaTreatmentHint" class="field-hint">This decides the tax on the invoice — pick it before anything else.</small>
                            </div>
                        </div>

                        <div class="form-row two-col">
                            <div class="form-group">
                                <label for="cqaName">Name <span class="req">*</span></label>
                                <input type="text" id="cqaName" class="form-control" maxlength="200" placeholder="Customer name" autocomplete="off">
                            </div>
                            <div class="form-group">
                                <label for="cqaDisplayName">Display Name <span class="opt">(optional)</span></label>
                                <input type="text" id="cqaDisplayName" class="form-control" maxlength="200" placeholder="Shown on documents">
                            </div>
                        </div>

                        <div id="cqaDupWarn" hidden style="margin:0 0 0.75rem; padding:0.55rem 0.75rem; border-radius:6px; background: color-mix(in srgb, var(--color-warning, #b8860b) 12%, var(--bg-card-hover)); color: var(--text-primary); font-size:0.85rem; line-height:1.45;"></div>

                        <div class="form-row two-col">
                            <div class="form-group">
                                <label for="cqaEmail">Email <span class="req">*</span></label>
                                <input type="email" id="cqaEmail" class="form-control" maxlength="200" placeholder="customer@example.com">
                            </div>
                            <div class="form-group">
                                <label for="cqaPhone">Phone <span class="req" id="cqaPhoneReq">*</span></label>
                                <input type="text" id="cqaPhone" class="form-control" maxlength="50" placeholder="Phone number">
                            </div>
                        </div>

                        <div class="form-row two-col">
                            <div class="form-group">
                                <label for="cqaTaxId">GSTIN / Tax ID <span class="req" id="cqaTaxIdReq">*</span></label>
                                <input type="text" id="cqaTaxId" class="form-control" maxlength="50" placeholder="e.g. 07AABCP7777Q1Z5" autocomplete="off">
                                <small class="field-hint">15 digits. The first two are the state code.</small>
                            </div>
                            <div class="form-group">
                                <label for="cqaTerms">Payment Terms <span class="opt">(days)</span></label>
                                <input type="number" id="cqaTerms" class="form-control" value="30" min="0" placeholder="30">
                            </div>
                        </div>

                        <div class="form-row">
                            <div class="form-group">
                                <label for="cqaAddr1">Address Line 1 <span class="req">*</span></label>
                                <input type="text" id="cqaAddr1" class="form-control" maxlength="500" placeholder="Street address">
                            </div>
                        </div>
                        <div class="form-row">
                            <div class="form-group">
                                <label for="cqaAddr2">Address Line 2 <span class="opt">(optional)</span></label>
                                <input type="text" id="cqaAddr2" class="form-control" maxlength="500" placeholder="Apt, suite, etc.">
                            </div>
                        </div>

                        <div class="form-row two-col">
                            <div class="form-group">
                                <label for="cqaCountryContainer">Country <span class="req">*</span></label>
                                <div class="searchable-dropdown-container" id="cqaCountryContainer"></div>
                                <input type="hidden" id="cqaCountry">
                            </div>
                            <div class="form-group">
                                <label for="cqaStateContainer">State <span class="req" id="cqaStateReq">*</span></label>
                                <div class="searchable-dropdown-container" id="cqaStateContainer"></div>
                                <input type="text" id="cqaStateText" class="form-control" maxlength="100" placeholder="State / Province" style="display:none;">
                                <input type="hidden" id="cqaState">
                                <input type="hidden" id="cqaStateCode">
                                <small class="field-hint">The GST state code fills in from the state — it is the place of supply.</small>
                            </div>
                        </div>

                        <div class="form-row two-col">
                            <div class="form-group">
                                <label for="cqaCity">City <span class="req">*</span></label>
                                <input type="text" id="cqaCity" class="form-control" maxlength="100" placeholder="City">
                            </div>
                            <div class="form-group">
                                <label for="cqaPostal">Postal Code <span class="opt">(optional)</span></label>
                                <input type="text" id="cqaPostal" class="form-control" maxlength="20" placeholder="Postal / ZIP code">
                            </div>
                        </div>

                        <div id="cqaError" hidden style="margin-top:0.5rem; padding:0.5rem 0.75rem; border-radius:6px; background: color-mix(in srgb, var(--color-error, #c33) 12%, var(--bg-card-hover)); color: var(--color-error, #c33); font-size:0.85rem;"></div>
                    </div>
                    <div class="modal-footer">
                        <button class="btn btn-outline" type="button" data-cqa-close>Cancel</button>
                        <button class="btn btn-primary" type="button" id="cqaSaveBtn">Save &amp; select</button>
                    </div>
                </div>
            </div>`;
        document.body.appendChild(m);

        m.querySelectorAll('[data-cqa-close]').forEach(b =>
            b.addEventListener('click', () => AccountsCommon.closeModal(MODAL_ID)));

        // The treatment <select> is auto-converted by auto-searchable-select.js,
        // which mirrors every pick back onto the native element and fires
        // `change` — so listening on the native select works either way.
        document.getElementById('cqaTreatment').addEventListener('change', applyTreatmentRules);

        document.getElementById('cqaName').addEventListener('blur', checkDuplicates);
        document.getElementById('cqaTaxId').addEventListener('blur', checkDuplicates);
        document.getElementById('cqaSaveBtn').addEventListener('click', save);

        regionPicker = AccountsCommon.createRegionPicker({
            countryContainer: 'cqaCountryContainer',
            stateContainer:   'cqaStateContainer',
            stateTextInput:   'cqaStateText',
            hiddenCountry:    'cqaCountry',
            hiddenState:      'cqaState',
            hiddenStateCode:  'cqaStateCode',
            defaultCountry:   'India'
        });

        return m;
    }

    // ── conditional requirements ─────────────────────────────────────────
    // Mirrors onCustomerTreatmentChange() on the Parties form AND the backend
    // rules in BusinessLayer_Customers.cs, so the asterisks tell the truth.

    function treatment() {
        return document.getElementById('cqaTreatment')?.value || 'registered';
    }

    function applyTreatmentRules() {
        const t = treatment();
        const overseas = t === 'overseas';

        const taxReq = document.getElementById('cqaTaxIdReq');
        if (taxReq) taxReq.style.visibility = (t === 'registered') ? 'visible' : 'hidden';

        // Phone and state are waived for an overseas party by the backend.
        const phoneReq = document.getElementById('cqaPhoneReq');
        if (phoneReq) phoneReq.style.visibility = overseas ? 'hidden' : 'visible';
        const stateReq = document.getElementById('cqaStateReq');
        if (stateReq) stateReq.style.visibility = overseas ? 'hidden' : 'visible';

        const hint = document.getElementById('cqaTreatmentHint');
        if (hint) hint.textContent = ({
            registered:   'Registered — GST is charged, and split CGST/SGST or IGST by their state.',
            unregistered: 'Unregistered (B2C) — you still charge GST, by the customer’s state.',
            composition:  'Composition dealer — you still charge normal GST on your sale to them.',
            overseas:     'Overseas — this invoice becomes a zero-rated export. No GST, and no state needed.'
        })[t] || '';

        if (overseas) clearError();
    }

    // ── validation ───────────────────────────────────────────────────────

    function val(id) { return (document.getElementById(id)?.value || '').trim(); }

    function showError(msg, focusId) {
        const el = document.getElementById('cqaError');
        el.textContent = msg;
        el.hidden = false;
        if (focusId) document.getElementById(focusId)?.focus();
    }

    function clearError() {
        const el = document.getElementById('cqaError');
        if (el) el.hidden = true;
    }

    /**
     * Same order and same wording as the backend, so a message the user sees
     * here is the message they would have got from the server.
     */
    function validate() {
        const t = treatment();
        const overseas = t === 'overseas';

        if (!val('cqaName'))   return ['Customer name is required', 'cqaName'];
        if (!overseas && !val('cqaPhone')) return ['Phone is required', 'cqaPhone'];
        if (!val('cqaEmail'))  return ['Email is required', 'cqaEmail'];
        if (!val('cqaAddr1'))  return ['Address Line 1 is required', 'cqaAddr1'];
        if (!val('cqaCity'))   return ['City is required', 'cqaCity'];
        if (!val('cqaCountry'))return ['Country is required', null];
        if (!overseas && !val('cqaState')) return ['State is required', null];

        if (t === 'registered' && !val('cqaTaxId'))
            return ['GSTIN / Tax ID is required for a GST-registered customer — pick Unregistered or Overseas if they have none', 'cqaTaxId'];

        // Place of supply: only a domestic party needs the GST state code, and
        // it is what decides CGST/SGST versus IGST on every line.
        const india = val('cqaCountry').toLowerCase() === 'india';
        if (india && !overseas && !val('cqaStateCode'))
            return ['Pick the customer’s state — it is the place of supply that decides CGST/SGST vs IGST', null];

        return null;
    }

    function checkDuplicates() {
        const warn = document.getElementById('cqaDupWarn');
        if (!warn) return null;

        const twinByGstin = findGstinTwin(val('cqaTaxId'));
        if (twinByGstin) {
            warn.innerHTML =
                `<strong>${AccountsCommon.escapeHtml(twinByGstin.name || 'An existing customer')}</strong> already has this GSTIN. ` +
                `A GSTIN identifies one legal entity, so billing a second record against it splits their ledger and their ageing. ` +
                `<button type="button" class="btn btn-sm btn-outline" id="cqaUseExisting" style="margin-left:0.5rem;">Use that customer</button>`;
            warn.hidden = false;
            document.getElementById('cqaUseExisting')?.addEventListener('click', () => {
                selectCustomer(twinByGstin);
                AccountsCommon.closeModal(MODAL_ID);
                Toast.success(`Selected existing customer ${twinByGstin.name}`);
            });
            return 'gstin';
        }

        const twinByName = findNameTwin(val('cqaName'));
        if (twinByName) {
            warn.innerHTML =
                `There is already a customer called <strong>${AccountsCommon.escapeHtml(twinByName.name)}</strong>. ` +
                `If that is the same business, cancel and pick it from the list instead — two records mean two ledgers.`;
            warn.hidden = false;
            return 'name';
        }

        warn.hidden = true;
        return null;
    }

    // ── save ─────────────────────────────────────────────────────────────

    function selectCustomer(customer) {
        if (!sourceSelect || !customer) return;
        document.dispatchEvent(new CustomEvent('accounts:customer-created', {
            detail: { customer, customers: knownCustomers, sourceSelectId: sourceSelect.id }
        }));
    }

    async function save() {
        clearError();

        const problem = validate();
        if (problem) { showError(problem[0], problem[1]); return; }

        // A GSTIN twin is a hard stop: same GSTIN is always the same entity.
        // A name twin only warns — two real businesses can share a name.
        if (checkDuplicates() === 'gstin') {
            showError('That GSTIN already belongs to an existing customer — use it instead of creating a second record.', 'cqaTaxId');
            return;
        }

        const t = treatment();
        const termsRaw = val('cqaTerms');
        const payload = {
            name: val('cqaName'),
            gst_treatment: t,
            display_name: val('cqaDisplayName') || null,
            email: val('cqaEmail') || null,
            phone: val('cqaPhone') || null,
            billing_address_line1: val('cqaAddr1') || null,
            billing_address_line2: val('cqaAddr2') || null,
            city: val('cqaCity') || null,
            state: val('cqaState') || null,
            state_code: val('cqaStateCode') || null,
            country: val('cqaCountry') || null,
            postal_code: val('cqaPostal') || null,
            tax_id: val('cqaTaxId') || null,
            payment_terms_days: termsRaw === '' ? 30 : (parseInt(termsRaw, 10) || 0)
        };

        if (!AccountsCommon.beginSubmit('customerQuickAdd')) return;
        try {
            const created = await api.request(AccountsCommon.buildUrl('customers'), {
                method: 'POST', body: JSON.stringify(payload)
            });
            const newId = created?.id || created?.data?.id;
            if (!newId) throw new Error('The customer was created but no id came back — reopen the customer list to find it.');

            // Re-read the list so the page's own array (which feeds zero-rating,
            // the price list and the HSN warning) is refreshed from the server
            // rather than patched from the create response.
            const fresh = await api.request(AccountsCommon.buildUrl('customers'), { _skipSpinner: true });
            knownCustomers = Array.isArray(fresh) ? fresh : (fresh?.data || fresh?.items || []);

            const customer = knownCustomers.find(c => c.id === newId) || { ...payload, id: newId };
            selectCustomer(customer);

            AccountsCommon.closeModal(MODAL_ID);
            Toast.success(`Customer “${customer.name}” created and selected`);
        } catch (err) {
            console.error('[CustomerQuickAdd] save failed:', err);
            showError(err.message || 'Could not create the customer.');
        } finally {
            AccountsCommon.endSubmit('customerQuickAdd');
        }
    }

    // ── open ─────────────────────────────────────────────────────────────

    async function open(select) {
        sourceSelect = select || null;

        if (!document.getElementById(MODAL_ID)) buildModal();

        ['cqaName', 'cqaDisplayName', 'cqaEmail', 'cqaPhone', 'cqaTaxId',
         'cqaAddr1', 'cqaAddr2', 'cqaCity', 'cqaPostal'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.value = '';
        });
        document.getElementById('cqaTerms').value = '30';

        const treatSel = document.getElementById('cqaTreatment');
        treatSel.value = 'registered';
        // The native write is mirrored into the SearchableDropdown by the
        // patched value setter in auto-searchable-select.js.
        regionPicker?.reset('India');
        applyTreatmentRules();
        clearError();
        const warn = document.getElementById('cqaDupWarn');
        if (warn) warn.hidden = true;

        AccountsCommon.openModal(MODAL_ID);
        setTimeout(() => document.getElementById('cqaName')?.focus(), 100);

        // Loaded fresh each open, on purpose: the page's array is module-scope
        // and not reachable from here, and duplicate detection is worthless
        // against a stale list.
        try {
            const res = await api.request(AccountsCommon.buildUrl('customers'), { _skipSpinner: true });
            knownCustomers = Array.isArray(res) ? res : (res?.data || res?.items || []);
        } catch {
            knownCustomers = [];
        }
    }

    // Explicitly on window: auto-searchable-select.js resolves the
    // data-quick-add attribute through window[name], and a function declared
    // inside this IIFE is not reachable that way.
    window.openCustomerQuickAdd = function (select) { return open(select); };
})();
