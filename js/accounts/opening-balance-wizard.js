/**
 * Opening balance wizard
 * ----------------------------------------------------------------------------
 * The opening-balance grid asks a non-accountant to decide, for thirty accounts,
 * which column a number belongs in. That is the single hardest screen in the
 * product for someone who is not a CA, and it is where a first run stops.
 *
 * This asks the same thing in the words the owner already uses — "do you keep
 * cash in a till?" — and does the bookkeeping itself.
 *
 * ⭐ WHY THERE IS NO "MAKE IT BALANCE" STEP. There does not need to be one.
 * SetOpeningBalancesBulk posts every balance against a contra account (3300
 * Current Year Earnings, see EnsureOpeningBalanceContraAccount), so each row is
 * already a balanced GL entry and the contra accumulates the net. That net IS
 * the owner's stake in the business. The wizard therefore never asks the user
 * to balance anything, and must NOT post its own balancing figure to Capital —
 * doing so would double-count the whole migration. It only SHOWS the number the
 * contra will end up holding, so the user sees where the difference went.
 *
 * ⭐ WHY RECEIVABLES AND PAYABLES DO NOT GO THROUGH THAT ENDPOINT. A lump sum
 * in the AR control account with no invoice behind it is permanent drift: the
 * control says one thing, the customer statements say another, and ageing never
 * adds up. ImportOpeningBalances exists precisely for this — it writes a REAL
 * invoice or bill per party, and excludes them from GSTR-1/3B because the old
 * system already reported those supplies. So AR/AP are collected PER PARTY and
 * posted there instead.
 *
 * Each question is gated yes/no so nobody types 0 into fifteen boxes, and a
 * question whose account does not exist on this tenant's chart is dropped
 * rather than shown and then failing on save.
 */
(function () {
    'use strict';

    const MODAL_ID = 'obWizardModal';

    let accounts = [];       // the tenant's chart
    let customers = [];
    let vendors = [];
    let steps = [];          // resolved question steps, in order
    let stepIndex = 0;
    let asOfDate = '';
    const answers = {};      // key -> { yes: bool, amount: number } | { rows: [...] }

    // ── the questions ────────────────────────────────────────────────────
    // `codes` are tried in order against the chart; `match` is a fallback for
    // charts that number things differently. A question that resolves to no
    // account is dropped — see resolveSteps.
    const QUESTIONS = [
        {
            key: 'bank', side: 'debit', codes: ['1121'], match: /bank/i,
            q: 'Do you have money in a business bank account?',
            help: 'Use the closing balance on your bank statement for the day before you started using Ragenaizer.',
            amountLabel: 'Balance as per the bank statement'
        },
        {
            key: 'cash', side: 'debit', codes: ['1111'], match: /cash in hand/i,
            q: 'Do you keep cash in a till, drawer or safe?',
            help: 'Physical notes and coins the business holds — not your personal money.',
            amountLabel: 'Cash on hand'
        },
        {
            key: 'petty', side: 'debit', codes: ['1112'], match: /petty/i,
            q: 'Do you run a separate petty cash float?',
            help: 'Only if you keep it apart from the main till. If it is all one pot, say no — you have already counted it above.',
            amountLabel: 'Petty cash float'
        },
        {
            key: 'stock', side: 'debit', codes: ['1135'], match: /stock|inventory/i,
            q: 'Do you hold stock you have not sold yet?',
            help: 'Value it at what it COST you, not at the price you will sell it for.',
            amountLabel: 'Cost of stock on hand',
            warn: 'This records a total value only. If you track stock item by item, also run the opening-stock import so quantities match — otherwise your cost of sales will be wrong on the first sale.'
        },
        {
            key: 'equipment', side: 'debit', codes: ['1230'], match: /equipment|computer/i,
            q: 'Do you own computers, equipment or furniture?',
            help: 'What they are realistically worth today, after wear and tear — not what you paid years ago.',
            amountLabel: 'Current value'
        },
        {
            key: 'coldEquip', side: 'debit', codes: ['1240'], match: /refrigerat/i,
            q: 'Any refrigeration or store equipment?',
            help: 'Same idea — what it is worth now.',
            amountLabel: 'Current value'
        },
        {
            key: 'salaryDue', side: 'credit', codes: ['2120'], match: /salary payable/i,
            q: 'Do you owe staff for work they have already done?',
            help: 'Salary earned before your start date but not yet paid out.',
            amountLabel: 'Salary owed'
        },
        {
            key: 'loan', side: 'credit', codes: [], match: /loan/i, group: 'Liabilities',
            q: 'Does the business have a loan still to repay?',
            help: 'The amount still outstanding — not the original loan amount.',
            amountLabel: 'Outstanding loan balance'
        }
    ];

    // GST is asked as one gate and then per head, because a single "input
    // credit" figure cannot be split between CGST/SGST/IGST without guessing,
    // and guessing here quietly misstates the next return. All three are on the
    // owner's GSTR-2B / last filed return, so this is answerable.
    const GST_INPUT = [
        { key: 'gstCgstIn', code: '1160', label: 'CGST input credit' },
        { key: 'gstSgstIn', code: '1161', label: 'SGST input credit' },
        { key: 'gstIgstIn', code: '1162', label: 'IGST input credit' }
    ];
    const GST_OUTPUT = [
        { key: 'gstCgstOut', code: '2160', label: 'CGST collected, not yet paid' },
        { key: 'gstSgstOut', code: '2161', label: 'SGST collected, not yet paid' },
        { key: 'gstIgstOut', code: '2162', label: 'IGST collected, not yet paid' }
    ];

    // ── helpers ──────────────────────────────────────────────────────────

    const esc = (x) => AccountsCommon.escapeHtml(x);
    const money = (n) => AccountsCommon.formatCurrency(Number(n) || 0);
    const num = (id) => {
        const v = (document.getElementById(id)?.value || '').trim();
        const n = parseFloat(v);
        return Number.isFinite(n) && n > 0 ? n : 0;
    };

    function findAccount(codes, match, groupName) {
        for (const c of (codes || [])) {
            const hit = accounts.find(a => String(a.account_code || a.code || '') === c);
            if (hit) return hit;
        }
        if (match) {
            return accounts.find(a => {
                if (!match.test(a.account_name || a.name || '')) return false;
                if (groupName && !String(a.account_type_name || a.type || '').toLowerCase().includes(groupName.toLowerCase())) return false;
                return true;
            }) || null;
        }
        return null;
    }

    /** Drop questions whose account this chart does not have. */
    function resolveSteps() {
        steps = [];
        QUESTIONS.forEach(q => {
            const acct = findAccount(q.codes, q.match, q.group);
            if (acct) steps.push({ ...q, kind: 'amount', account: acct });
        });

        const gstIn = GST_INPUT.map(g => ({ ...g, account: findAccount([g.code]) })).filter(g => g.account);
        const gstOut = GST_OUTPUT.map(g => ({ ...g, account: findAccount([g.code]) })).filter(g => g.account);
        if (gstIn.length || gstOut.length) {
            steps.push({
                key: 'gst', kind: 'gst', gstIn, gstOut,
                q: 'Is the business registered for GST?',
                help: 'If yes, we will ask for the balances on your last return. You can read them off your GSTR-2B or the GST portal.'
            });
        }

        steps.push({
            key: 'ar', kind: 'party', partyType: 'customer',
            q: 'Do any customers still owe you money?',
            help: 'We will create an opening invoice for each one, so their statement and your receivables agree.'
        });
        steps.push({
            key: 'ap', kind: 'party', partyType: 'vendor',
            q: 'Do you still owe any suppliers?',
            help: 'We will create an opening bill for each one, so their ledger and your payables agree.'
        });
    }

    // ── rendering ────────────────────────────────────────────────────────

    function stepHtml(step) {
        const a = answers[step.key] || {};
        const yes = a.yes === true;
        const no = a.yes === false;

        const gate = `
            <div class="obw-gate">
                <button type="button" class="obw-choice ${yes ? 'is-on' : ''}" data-gate="yes">Yes</button>
                <button type="button" class="obw-choice ${no ? 'is-on' : ''}" data-gate="no">No</button>
            </div>`;

        let body = '';
        if (yes && step.kind === 'amount') {
            body = `
                <div class="form-group obw-followup">
                    <label for="obwAmount">${esc(step.amountLabel)} <span class="req">*</span></label>
                    <input type="number" id="obwAmount" class="form-control" min="0" step="0.01"
                           placeholder="0.00" value="${a.amount ? esc(a.amount) : ''}" autocomplete="off">
                    ${step.warn ? `<small class="field-hint obw-warn">${esc(step.warn)}</small>` : ''}
                </div>`;
        } else if (yes && step.kind === 'gst') {
            const row = (g) => `
                <div class="form-group">
                    <label for="obw_${esc(g.key)}">${esc(g.label)}</label>
                    <input type="number" id="obw_${esc(g.key)}" class="form-control" min="0" step="0.01"
                           placeholder="0.00" value="${a[g.key] ? esc(a[g.key]) : ''}">
                </div>`;
            body = `
                <div class="obw-followup">
                    ${step.gstIn.length ? `<div class="obw-subhead">Credit you have not used yet</div>
                        <div class="obw-grid3">${step.gstIn.map(row).join('')}</div>` : ''}
                    ${step.gstOut.length ? `<div class="obw-subhead">GST you have collected but not yet paid</div>
                        <div class="obw-grid3">${step.gstOut.map(row).join('')}</div>` : ''}
                </div>`;
        } else if (yes && step.kind === 'party') {
            const list = step.partyType === 'customer' ? customers : vendors;
            const rows = (a.rows && a.rows.length) ? a.rows : [{ party: '', amount: '', reference: '' }];
            body = `
                <div class="obw-followup">
                    <table class="obw-party-table">
                        <thead><tr>
                            <th>${step.partyType === 'customer' ? 'Customer' : 'Supplier'}</th>
                            <th style="width:150px">Amount</th>
                            <th style="width:150px">Their invoice no.</th>
                            <th style="width:36px"></th>
                        </tr></thead>
                        <tbody id="obwPartyRows">
                            ${rows.map((r, i) => partyRowHtml(list, r, i)).join('')}
                        </tbody>
                    </table>
                    <button type="button" class="btn btn-sm btn-outline" id="obwAddParty" style="margin-top:0.6rem;">+ Add another</button>
                    ${list.length === 0 ? `<small class="field-hint obw-warn">No ${step.partyType === 'customer' ? 'customers' : 'suppliers'} exist yet — add them under Parties first, then come back.</small>` : ''}
                </div>`;
        }

        return `
            <div class="obw-q">${esc(step.q)}</div>
            ${step.help ? `<div class="obw-help">${esc(step.help)}</div>` : ''}
            ${gate}
            ${body}`;
    }

    function partyRowHtml(list, row, i) {
        const opts = ['<option value="">Select…</option>']
            .concat(list.map(p => `<option value="${esc(p.name)}"${p.name === row.party ? ' selected' : ''}>${esc(p.name)}</option>`))
            .join('');
        return `
            <tr data-row="${i}">
                <td><select class="form-control obw-party" data-no-sd="true">${opts}</select></td>
                <td><input type="number" class="form-control obw-amount" min="0" step="0.01" placeholder="0.00" value="${row.amount ? esc(row.amount) : ''}"></td>
                <td><input type="text" class="form-control obw-ref" placeholder="optional" value="${esc(row.reference || '')}"></td>
                <td><button type="button" class="btn-icon btn-icon-danger obw-del" title="Remove">&times;</button></td>
            </tr>`;
    }

    /** Everything the wizard will post, as plain rows a reviewer can check. */
    function buildPlan() {
        const glRows = [];   // -> coa/opening-balances/bulk
        const arRows = [];   // -> import/opening-balances
        const apRows = [];

        steps.forEach(step => {
            const a = answers[step.key];
            if (!a || a.yes !== true) return;

            if (step.kind === 'amount' && a.amount > 0) {
                glRows.push({ account: step.account, amount: a.amount, side: step.side, label: step.amountLabel });
            } else if (step.kind === 'gst') {
                step.gstIn.forEach(g => { if (a[g.key] > 0) glRows.push({ account: g.account, amount: a[g.key], side: 'debit', label: g.label }); });
                step.gstOut.forEach(g => { if (a[g.key] > 0) glRows.push({ account: g.account, amount: a[g.key], side: 'credit', label: g.label }); });
            } else if (step.kind === 'party') {
                (a.rows || []).forEach(r => {
                    if (!r.party || !(r.amount > 0)) return;
                    // due_date is OMITTED, never sent as ''. The backend binds it to
                    // DateTime? and an empty string is not a valid null — it fails
                    // model binding with a 400 before any of our own validation runs,
                    // so the user would see a deserialisation error for a field the
                    // wizard never asked them about.
                    const row = { party_type: step.partyType, party: r.party, amount: r.amount };
                    if (r.reference) row.reference = r.reference;
                    (step.partyType === 'customer' ? arRows : apRows).push(row);
                });
            }
        });

        const debits = glRows.filter(r => r.side === 'debit').reduce((s, r) => s + r.amount, 0)
                     + arRows.reduce((s, r) => s + r.amount, 0);
        const credits = glRows.filter(r => r.side === 'credit').reduce((s, r) => s + r.amount, 0)
                      + apRows.reduce((s, r) => s + r.amount, 0);

        return { glRows, arRows, apRows, debits, credits, stake: debits - credits };
    }

    function reviewHtml() {
        const p = buildPlan();
        const line = (label, acct, amount, side) => `
            <tr>
                <td>${esc(label)}</td>
                <td class="obw-acct">${esc((acct.account_code || acct.code || '') + ' · ' + (acct.account_name || acct.name || ''))}</td>
                <td class="obw-side">${side === 'debit' ? 'Money in / owned' : 'Owed'}</td>
                <td class="obw-amt">${money(amount)}</td>
            </tr>`;

        const partyLine = (r, kind) => `
            <tr>
                <td>${esc(r.party)}</td>
                <td class="obw-acct">${kind === 'ar' ? 'Opening invoice' : 'Opening bill'}${r.reference ? ' · ' + esc(r.reference) : ''}</td>
                <td class="obw-side">${kind === 'ar' ? 'Owed to you' : 'Owed by you'}</td>
                <td class="obw-amt">${money(r.amount)}</td>
            </tr>`;

        if (!p.glRows.length && !p.arRows.length && !p.apRows.length) {
            return `<div class="obw-q">Nothing to record</div>
                    <div class="obw-help">You answered no to everything. Go back if that was not what you meant.</div>`;
        }

        return `
            <div class="obw-q">Here is what we will record</div>
            <div class="obw-help">As at <strong>${esc(asOfDate)}</strong>. Nothing is saved until you press the button below.</div>
            <table class="obw-review">
                <tbody>
                    ${p.glRows.map(r => line(r.label, r.account, r.amount, r.side)).join('')}
                    ${p.arRows.map(r => partyLine(r, 'ar')).join('')}
                    ${p.apRows.map(r => partyLine(r, 'ap')).join('')}
                </tbody>
            </table>
            <div class="obw-stake">
                <div class="obw-stake-row"><span>Everything the business owns</span><strong>${money(p.debits)}</strong></div>
                <div class="obw-stake-row"><span>Everything the business owes</span><strong>${money(p.credits)}</strong></div>
                <div class="obw-stake-row obw-stake-net">
                    <span>So your stake in the business is</span><strong>${money(p.stake)}</strong>
                </div>
                <small class="field-hint">
                    You do not have to make these two match. The difference is recorded for you against
                    Current Year Earnings — that is the accounting name for what the business is worth to you.
                </small>
            </div>`;
    }

    function render() {
        const body = document.getElementById('obwBody');
        const onReview = stepIndex >= steps.length;
        const total = steps.length + 1;
        const shown = Math.min(stepIndex + 1, total);

        document.getElementById('obwProgress').textContent = `Step ${shown} of ${total}`;
        document.getElementById('obwBar').style.width = `${(shown / total) * 100}%`;
        body.innerHTML = onReview ? reviewHtml() : stepHtml(steps[stepIndex]);

        const backBtn = document.getElementById('obwBack');
        const nextBtn = document.getElementById('obwNext');
        backBtn.style.visibility = stepIndex === 0 ? 'hidden' : 'visible';
        nextBtn.textContent = onReview ? 'Save opening balances' : 'Continue';
        nextBtn.classList.toggle('btn-success', onReview);

        if (!onReview) bindStep(steps[stepIndex]);
    }

    function bindStep(step) {
        const body = document.getElementById('obwBody');

        body.querySelectorAll('[data-gate]').forEach(btn => {
            btn.addEventListener('click', () => {
                const yes = btn.dataset.gate === 'yes';
                answers[step.key] = { ...(answers[step.key] || {}), yes };
                if (!yes) { captureNothing(step); advance(); return; }
                render();
                setTimeout(() => body.querySelector('input, select')?.focus(), 60);
            });
        });

        if (step.kind === 'party') {
            const add = document.getElementById('obwAddParty');
            add?.addEventListener('click', () => {
                captureStep(step);
                const a = answers[step.key];
                a.rows = (a.rows || []).concat([{ party: '', amount: '', reference: '' }]);
                render();
            });
            body.querySelectorAll('.obw-del').forEach(b => b.addEventListener('click', (e) => {
                captureStep(step);
                const idx = Number(e.target.closest('tr').dataset.row);
                const a = answers[step.key];
                a.rows = (a.rows || []).filter((_, i) => i !== idx);
                if (!a.rows.length) a.rows = [{ party: '', amount: '', reference: '' }];
                render();
            }));
        }
    }

    function captureNothing(step) {
        answers[step.key] = { yes: false };
    }

    function captureStep(step) {
        const a = answers[step.key] || {};
        if (a.yes !== true) return;
        if (step.kind === 'amount') {
            a.amount = num('obwAmount');
        } else if (step.kind === 'gst') {
            step.gstIn.forEach(g => { a[g.key] = num('obw_' + g.key); });
            step.gstOut.forEach(g => { a[g.key] = num('obw_' + g.key); });
        } else if (step.kind === 'party') {
            a.rows = [...document.querySelectorAll('#obwPartyRows tr')].map(tr => ({
                party: tr.querySelector('.obw-party')?.value || '',
                amount: parseFloat(tr.querySelector('.obw-amount')?.value) || 0,
                reference: (tr.querySelector('.obw-ref')?.value || '').trim()
            }));
        }
        answers[step.key] = a;
    }

    function advance() {
        stepIndex = Math.min(stepIndex + 1, steps.length);
        render();
    }

    // ── save ─────────────────────────────────────────────────────────────

    async function save() {
        const p = buildPlan();
        if (!p.glRows.length && !p.arRows.length && !p.apRows.length) {
            Toast.error('Nothing to save — go back and answer at least one question.');
            return;
        }

        if (!AccountsCommon.beginSubmit('obWizard')) return;
        const btn = document.getElementById('obwNext');
        if (btn) btn.disabled = true;

        try {
            // AR/AP first and as a DRY RUN, because it is the half that can fail
            // on data rather than arithmetic — a party name that does not match,
            // or a party that already carries an opening balance. Finding that
            // out after the GL half is posted would leave a half-migrated set.
            const partyRows = p.arRows.concat(p.apRows);
            if (partyRows.length) {
                const dry = await api.request(AccountsCommon.buildUrl('import/opening-balances'), {
                    method: 'POST',
                    body: JSON.stringify({ rows: partyRows, dry_run: true, as_of_date: asOfDate })
                });
                const bad = (dry?.rows || dry?.results || []).filter(r => r.outcome === 'error');
                if (bad.length) {
                    Toast.error(`Nothing was saved. ${bad.length} party row${bad.length === 1 ? '' : 's'} would fail: ${bad.slice(0, 3).map(b => b.message).join('; ')}`);
                    return;
                }
            }

            if (p.glRows.length) {
                await api.request(AccountsCommon.buildUrl('coa/opening-balances/bulk'), {
                    method: 'POST',
                    body: JSON.stringify({
                        balances: p.glRows.map(r => ({
                            account_id: r.account.id,
                            amount: r.amount,
                            balance_type: r.side,
                            as_of_date: asOfDate
                        }))
                    })
                });
            }

            if (partyRows.length) {
                await api.request(AccountsCommon.buildUrl('import/opening-balances'), {
                    method: 'POST',
                    body: JSON.stringify({ rows: partyRows, dry_run: false, as_of_date: asOfDate })
                });
            }

            AccountsCommon.closeModal(MODAL_ID);
            Toast.success('Opening balances saved');
            if (typeof loadOpeningBalances === 'function') await loadOpeningBalances();
        } catch (err) {
            console.error('[OBWizard] save failed:', err);
            const msg = err.message || 'Could not save the opening balances.';
            Toast.error(msg.includes('NOTHING was saved') ? msg : `Nothing was saved — ${msg}`);
        } finally {
            AccountsCommon.endSubmit('obWizard');
            const b = document.getElementById('obwNext');
            if (b) b.disabled = false;
        }
    }

    // ── shell ────────────────────────────────────────────────────────────

    function buildModal() {
        const m = document.createElement('div');
        m.id = MODAL_ID;
        m.className = 'modal';
        m.innerHTML = `
            <div class="modal-dialog modal-dialog-centered" style="max-width: 720px; width: min(94vw, 720px);">
                <div class="modal-content" style="max-width:none;width:100%;">
                    <div class="modal-header">
                        <h5 class="modal-title">Set up your opening balances</h5>
                        <button class="close-btn" type="button" data-obw-close aria-label="Close">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                        </button>
                    </div>
                    <div class="obw-progress-wrap">
                        <div class="obw-bar"><span id="obwBar"></span></div>
                        <span id="obwProgress" class="obw-progress"></span>
                    </div>
                    <div class="modal-body" id="obwBody"></div>
                    <div class="modal-footer">
                        <button class="btn btn-outline" type="button" id="obwBack">Back</button>
                        <button class="btn btn-primary" type="button" id="obwNext">Continue</button>
                    </div>
                </div>
            </div>`;
        document.body.appendChild(m);

        m.querySelectorAll('[data-obw-close]').forEach(b =>
            b.addEventListener('click', () => AccountsCommon.closeModal(MODAL_ID)));

        document.getElementById('obwBack').addEventListener('click', () => {
            if (stepIndex < steps.length) captureStep(steps[stepIndex]);
            stepIndex = Math.max(0, stepIndex - 1);
            render();
        });

        document.getElementById('obwNext').addEventListener('click', () => {
            if (stepIndex >= steps.length) { save(); return; }
            const step = steps[stepIndex];
            const a = answers[step.key];
            if (!a || a.yes === undefined) { Toast.error('Please answer yes or no.'); return; }
            captureStep(step);
            const captured = answers[step.key];
            if (captured.yes === true && step.kind === 'amount' && !(captured.amount > 0)) {
                Toast.error('Enter an amount, or answer No.');
                return;
            }
            advance();
        });
    }

    async function open(asOf) {
        if (!document.getElementById(MODAL_ID)) buildModal();

        // Refuse rather than default to today: an opening balance dated into the
        // wrong fiscal year puts a whole year's transactions on the wrong side of
        // the line, and it is not obvious afterwards that anything went wrong.
        asOfDate = (asOf || '').slice(0, 10);
        if (!asOfDate) {
            Toast.error('Pick a fiscal year first — opening balances are stated as at the start of one.');
            return;
        }
        stepIndex = 0;
        Object.keys(answers).forEach(k => delete answers[k]);

        AccountsCommon.openModal(MODAL_ID);
        document.getElementById('obwBody').innerHTML = '<div class="obw-help">Loading your chart of accounts…</div>';

        try {
            const [coa, cust, vend] = await Promise.all([
                api.request(AccountsCommon.buildUrl('coa'), { _skipSpinner: true }),
                api.request(AccountsCommon.buildUrl('customers'), { _skipSpinner: true }).catch(() => []),
                api.request(AccountsCommon.buildUrl('vendors'), { _skipSpinner: true }).catch(() => [])
            ]);
            const arr = (x) => Array.isArray(x) ? x : (x?.data || x?.items || []);
            accounts = arr(coa);
            customers = arr(cust);
            vendors = arr(vend);
        } catch (err) {
            console.error('[OBWizard] load failed:', err);
            document.getElementById('obwBody').innerHTML =
                '<div class="obw-help">Could not load your chart of accounts. Close this and try again.</div>';
            return;
        }

        resolveSteps();
        render();
    }

    // Explicitly on window: the Opening Balances tab calls it from an onclick,
    // and a function declared inside this IIFE is not reachable that way.
    window.openOpeningBalanceWizard = function (asOf) { return open(asOf); };
})();
