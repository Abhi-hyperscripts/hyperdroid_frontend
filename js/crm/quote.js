/**
 * The quote page.
 *
 * ⭐ WHY THIS EXISTS RATHER THAN A PANEL IN THE DEAL DRAWER.
 *
 * The lines were only ever shown inside the deal slide-panel, which is 438px
 * wide. Measured there: the table needed 573px, so the TOTAL and REMOVE columns
 * were cut off, the description truncated mid-word, and the "Choose product"
 * button — the entire catalogue feature — was never reachable at all. A quote
 * has a description, a product, a unit, a quantity, a price, an account and a
 * total per line; that is a document, and a document needs a page.
 *
 * The panel stays where it is. This page mounts the SAME LineItemsPanel rather
 * than a second implementation, because two editors for one set of lines is how
 * the two of them start disagreeing about rounding, validation or what a
 * catalogue line means.
 */
(function () {
    'use strict';

    const esc = (t) => String(t ?? '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

    let deal = null;

    function dealIdFromUrl() {
        return new URLSearchParams(location.search).get('deal');
    }

    function money(amount, currency) {
        // One formatter, from currencies.js — the same one the panel and the
        // deal card use. A second local formatter is how one screen starts
        // showing ₹ and another $ for the same number.
        if (typeof formatMoney === 'function') return formatMoney(amount, currency);
        return `${currency || ''} ${Number(amount || 0).toLocaleString()}`.trim();
    }

    function banner(message, kind) {
        const el = document.getElementById('qtBanner');
        if (!el) return;
        if (!message) { el.hidden = true; el.textContent = ''; return; }
        el.hidden = false;
        el.className = `qt-banner qt-banner-${kind || 'info'}`;
        el.textContent = message;
    }

    function renderHead() {
        document.getElementById('qtTitle').textContent = deal.deal_name || 'Quote';
        document.getElementById('qtSubtitle').textContent =
            'Everything this deal is priced for. Saving these lines sets the deal value.';

        const link = document.getElementById('qtDealLink');
        if (link) {
            link.textContent = deal.deal_name || 'Deal';
            link.href = `deals.html?deal=${encodeURIComponent(deal.id)}`;
        }

        const facts = [
            // company_name_resolved is what the API actually calls it — the
            // join's alias, not the column. Reading `company_name` printed a
            // dash for every deal and made a working backend look broken.
            ['Customer', deal.company_name_resolved || deal.company_name || '—'],
            ['Contact', deal.contact_name || '—'],
            ['Currency', deal.currency || '—'],
            ['Deal value', money(deal.deal_value, deal.currency)],
        ];
        document.getElementById('qtFacts').innerHTML = facts.map(([k, v]) => `
            <div class="qt-fact">
                <span class="qt-fact-k">${esc(k)}</span>
                <span class="qt-fact-v">${esc(v)}</span>
            </div>`).join('');
    }

    async function reserveStock() {
        const btn = document.getElementById('qtReserve');
        btn.disabled = true;
        try {
            const res = await api.request(
                `/crm/deals/${encodeURIComponent(deal.id)}/reserve-stock`, { method: 'POST' });

            // A partial hold is NOT a success. Saying "reserved" when two of
            // five lines could not be held tells a rep their goods are safe
            // when they are not.
            if (res && res.warning) {
                banner(res.warning, 'warn');
                Toast.warning('Some of this could not be reserved');
            } else {
                banner('The goods on this quote are reserved against this deal.', 'ok');
                Toast.success('Stock reserved');
            }
        } catch (e) {
            // An outage leaves the quote untouched and says so — it is not
            // "those products are gone".
            banner(e.message || 'The catalogue did not answer. Nothing has been reserved.', 'warn');
            Toast.error(e.message || 'Could not reserve stock');
        } finally {
            btn.disabled = false;
        }
    }

    async function showReserveIfSellingGoods() {
        // The button appears only when there is something to reserve: a quote
        // made of services has no stock, and offering the action would be a
        // control that can only ever do nothing.
        try {
            const lines = await api.request(`/crm/deals/${encodeURIComponent(deal.id)}/line-items`);
            const hasGoods = (lines.lines || []).some(l => l.item_id);
            document.getElementById('qtActions').hidden = !hasGoods;
        } catch {
            document.getElementById('qtActions').hidden = true;
        }
    }

    /**
     * The CRM team role for this user, resolved the same way every other
     * standalone CRM page resolves it.
     *
     * Fails CLOSED: any error leaves the quote read-only rather than editable.
     * The server is the real gate, but a panel that offers an edit which is
     * then refused is worse than one that never offered it.
     */
    async function isAtLeastTeamLead() {
        try {
            const user = api.getUser();
            if (user?.roles?.includes('CRM_ADMIN') || user?.roles?.includes('SUPERADMIN')) return true;
            const res = await api.request('/crm/leads/my-role');
            return ['admin', 'manager', 'teamlead'].includes(res?.role || 'member');
        } catch {
            return false;
        }
    }

    async function init() {
        const dealId = dealIdFromUrl();
        if (!dealId) {
            banner('No deal was given, so there is nothing to quote.', 'warn');
            return;
        }

        if (typeof Navigation !== 'undefined') Navigation.init('crm', '../');

        try {
            deal = await api.request(`/crm/deals/${encodeURIComponent(dealId)}`);
        } catch (e) {
            banner('That deal could not be opened. It may have been removed, or you may not have access to it.', 'warn');
            return;
        }

        renderHead();

        // canEdit mirrors the deal drawer's gate: the lines set the deal value,
        // so a member who cannot change the value cannot change the lines. The
        // server refuses either way; this only stops the panel offering an edit
        // that is going to be rejected.
        //
        // Resolved HERE rather than borrowed from deals.js. isMember() lives in
        // that file and is not loaded on this page, so `typeof isMember` would
        // be 'undefined' and the fallback would hand every member an editable
        // quote — a permission decided by which script happened to load.
        const canEdit = await isAtLeastTeamLead();

        LineItemsPanel.mount(document.getElementById('qtLineItems'), deal, {
            canEdit,
            showOpenFull: false,   // this IS the full quote
            onSaved: () => { showReserveIfSellingGoods(); },
        });

        showReserveIfSellingGoods();
        document.getElementById('qtReserve')?.addEventListener('click', reserveStock);
    }

    // ⭐⭐ THE HEADER MUST FOLLOW THE LINES IT PROMISED TO FOLLOW.
    //
    // This page says, in its own subtitle, that saving the lines sets the deal
    // value — and then showed $400,000.00 in the Deal value chip beside a line
    // total of $415,000.00, because nothing re-rendered the header after a save.
    // Two numbers disagreeing on one screen is the fastest way to make a rep
    // stop trusting either of them.
    //
    // LineItemsPanel already announces the move on 'crm:deal-value-changed';
    // the deals drawer listened and this page did not. Listening here rather
    // than adding a second mechanism means a third surface gets it for free.
    //
    // Bound at module scope so it is attached exactly once, matching the
    // drawer's binding — a per-render binding would fire N times per save.
    document.addEventListener('crm:deal-value-changed', (e) => {
        const detail = e.detail || {};
        if (!deal || detail.dealId !== deal.id) return;

        const value = Number(detail.dealValue);
        if (!isFinite(value)) return;

        // Mutate the deal we already hold rather than re-reading it: the value
        // in the event is the one the server just computed and the panel is
        // already showing, so the chip cannot end up disagreeing with the total
        // it is meant to mirror.
        deal.deal_value = value;
        if (detail.currency) deal.currency = detail.currency;
        renderHead();
    });

    document.addEventListener('DOMContentLoaded', init);
})();
