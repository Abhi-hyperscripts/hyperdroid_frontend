/**
 * "Mark complete" asks how it went — in ONE place, for every button that offers it.
 *
 * The badge beside a lead's status is its last recorded CALL OUTCOME, not its
 * last action. Completing a follow-up used to send only a note, so the newest
 * event on a lead carried no outcome and the badge kept showing an older call's
 * result: LD-0000568 advertised "Not Responding" beside a follow-up completed
 * two days afterwards. The rep knew the answer. Nothing asked them.
 *
 * There are two Mark complete buttons — the My Day list and the lead timeline —
 * which is exactly the shape that drifts: the backend had four doors recording
 * work and only one applied the rule. So the prompt lives here and both call it.
 *
 * Outcome is OPTIONAL on purpose. A rep ticking off a batch should not be forced
 * to classify each one, and completing without an outcome leaves the existing
 * disposition untouched rather than treating silence as evidence.
 */
(function (global) {
    'use strict';

    // Mirrors ContactOutcomes.All in the backend, which refuses anything else by
    // name. Kept in the same order as the Log Activity picker so a rep sees one
    // vocabulary across the app.
    const OUTCOMES = [
        ['',                   'Not recorded'],
        ['connected',          'Connected'],
        ['not_reachable',      'Not Reachable'],
        ['voicemail',          'Voicemail'],
        ['busy',               'Busy'],
        ['callback_requested', 'Callback Requested'],
        ['meeting_set',        'Meeting Set'],
        ['wrong_number',       'Wrong Number'],
        ['call_disconnected',  'Call Disconnected'],
    ];

    function esc(s) {
        const d = document.createElement('div');
        d.textContent = s == null ? '' : String(s);
        return d.innerHTML.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    let openEl = null;

    function close(result, resolve) {
        if (openEl) { openEl.remove(); openEl = null; }
        document.removeEventListener('keydown', onKey, true);
        resolve(result);
    }

    let _resolve = null;
    function onKey(e) {
        if (e.key === 'Escape' && _resolve) { e.stopPropagation(); close(null, _resolve); }
    }

    /**
     * @param {object} [opts]
     * @param {string} [opts.defaultNotes] what to send when the rep adds nothing
     * @returns {Promise<null|{completed_notes:string, contact_outcome?:string}>}
     *          null means the rep cancelled — the caller must not complete.
     */
    function prompt(opts) {
        opts = opts || {};
        if (openEl) openEl.remove();

        return new Promise(resolve => {
            _resolve = resolve;
            const el = document.createElement('div');
            el.className = 'fuc-overlay';
            el.innerHTML =
                '<div class="fuc-modal" role="dialog" aria-modal="true" aria-label="Complete follow-up">' +
                  '<h3 class="fuc-title">How did it go?</h3>' +
                  '<p class="fuc-sub">Recording the outcome keeps the lead’s status badge honest. ' +
                     'Leave it unset and nothing about the lead changes.</p>' +
                  '<label class="fuc-label" for="fucOutcome">Outcome</label>' +
                  '<select id="fucOutcome" class="form-select" data-no-sd="true">' +
                     OUTCOMES.map(o => '<option value="' + esc(o[0]) + '">' + esc(o[1]) + '</option>').join('') +
                  '</select>' +
                  '<label class="fuc-label" for="fucNotes">Notes <span class="fuc-opt">optional</span></label>' +
                  '<textarea id="fucNotes" class="form-control" rows="2" ' +
                     'placeholder="What was said?"></textarea>' +
                  '<div class="fuc-actions">' +
                    '<button type="button" class="btn btn-outline-secondary" data-fuc="cancel">Cancel</button>' +
                    '<button type="button" class="btn btn-primary" data-fuc="ok">Mark complete</button>' +
                  '</div>' +
                '</div>';
            document.body.appendChild(el);
            openEl = el;

            el.querySelector('[data-fuc="cancel"]').addEventListener('click', () => close(null, resolve));
            // Clicking the backdrop cancels; clicking INSIDE must not.
            el.addEventListener('mousedown', e => { if (e.target === el) close(null, resolve); });
            el.querySelector('[data-fuc="ok"]').addEventListener('click', () => {
                const outcome = el.querySelector('#fucOutcome').value;
                const notes = el.querySelector('#fucNotes').value.trim();
                const body = { completed_notes: notes || opts.defaultNotes || 'Marked complete' };
                if (outcome) body.contact_outcome = outcome;
                close(body, resolve);
            });
            document.addEventListener('keydown', onKey, true);
            setTimeout(() => el.querySelector('#fucOutcome')?.focus(), 0);
        });
    }

    global.CrmFollowupComplete = { prompt, OUTCOMES };
})(window);
