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
    let items = [];           // inventory items, for the stock step
    let assetCategories = [];  // fixed-asset categories, for the asset step
    let bankAccounts = [];     // existing bank accounts, each already on its own ledger
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
            key: 'cash', side: 'debit', codes: ['1111'], match: /cash in hand/i, expectType: 'Assets',
            q: 'Do you keep cash in a till, drawer or safe?',
            help: 'Physical notes and coins the business holds — not your personal money.',
            amountLabel: 'Cash on hand'
        },
        {
            key: 'petty', side: 'debit', codes: ['1112'], match: /petty/i, expectType: 'Assets',
            q: 'Do you run a separate petty cash float?',
            help: 'Only if you keep it apart from the main till. If it is all one pot, say no — you have already counted it above.',
            amountLabel: 'Petty cash float'
        },
        {
            key: 'salaryDue', side: 'credit', codes: ['2120'], match: /salary payable/i, expectType: 'Liabilities',
            q: 'Do you owe staff for work they have already done?',
            help: 'Salary earned before your start date but not yet paid out.',
            amountLabel: 'Salary owed'
        },
        {
            key: 'loan', side: 'credit', codes: [], match: /loan/i, expectType: 'Liabilities',
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

    /**
     * Resolve a question to a real account: by code first, then by name.
     *
     * ⭐ THE NAME FALLBACK MUST FILTER BY POSTABILITY AND TYPE. It did not, and
     * on a standard chart that was invisible because the code always hit first.
     * On a TRIMMED chart with no 1121, /bank/i matched in array order and the
     * first hit is "1120 Bank Accounts" — a non-postable HEADER row — with
     * "5410 Bank Charges", an EXPENSE, right behind it. So the fallback could
     * silently aim an opening bank balance at a header (refused on save, with a
     * message about an account the user never chose) or at an expense account
     * (accepted, and wrong). `expectType` is checked against the account's own
     * type rather than a group name, because the group is what made the header
     * look acceptable in the first place.
     */
    function findAccount(codes, match, expectType) {
        const postable = (a) => a.allow_direct_posting !== false && a.is_active !== false;
        const typeOk = (a) => !expectType
            || String(a.account_type_name || a.type || '').toLowerCase() === expectType.toLowerCase();

        for (const c of (codes || [])) {
            const hit = accounts.find(a => String(a.account_code || a.code || '') === c);
            // A code is an exact instruction, but still must not name a header —
            // a chart that moved 1121 to a parent row would otherwise break the
            // same way, just less obviously.
            if (hit && postable(hit)) return hit;
        }
        if (match) {
            return accounts.find(a =>
                match.test(a.account_name || a.name || '') && postable(a) && typeOk(a)) || null;
        }
        return null;
    }

    /** Drop questions whose account this chart does not have. */
    function resolveSteps() {
        steps = [];

        // ⭐ BANKS ARE REPEATABLE, not one question. Every ACTIVE bank must have
        // its OWN ledger — uq_bank_accounts_active_gl is a partial unique index on
        // (tenant_id, gl_account_id), and bank_accounts.current_balance is a cache
        // synced from that ledger, so two banks on one ledger drift both caches and
        // make per-bank reconciliation impossible. A single "money in the bank"
        // question mapped to 1121 therefore could not express a business with three
        // banks: it silently recorded one and dropped the rest, which is worse than
        // refusing, because the totals still look plausible.
        steps.push({
            key: 'banks', kind: 'banks',
            q: 'Do you have money in a business bank account?',
            help: 'One row per account, using the closing balance on each statement for the day before you started here. Accounts you have not set up yet can be added right here.'
        });
        QUESTIONS.forEach(q => {
            const acct = findAccount(q.codes, q.match, q.expectType);
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

        // ⭐ STOCK AND ASSETS ARE ITEMISED, for the same reason AR/AP are: a total
        // value with nothing behind it is drift that nothing downstream notices.
        //   - A stock VALUE with no per-item quantities makes cost of sales wrong
        //     on the very first sale, because there is no cost layer to consume.
        //   - An equipment VALUE with no register row cannot depreciate, so the
        //     balance sheet slowly overstates assets for the rest of the company's
        //     life and nobody is told.
        // Both of these post their OWN ledger entries (against the same contra), so
        // neither may also be sent as a coa/opening-balances row — that would double
        // the whole figure. See buildPlan, which keeps them out of glRows.
        if (items.length) {
            steps.push({
                key: 'stock', kind: 'stock',
                q: 'Do you hold stock you have not sold yet?',
                help: 'Enter it item by item at what it COST you, not the selling price. Per-item quantities are what make your cost of sales right on the first sale.'
            });
        }
        // Asked even with no asset categories set up: dropping the question would
        // mean a tenant never learns they could have recorded assets at all, and
        // silently carrying none is the outcome this whole step exists to stop. The
        // follow-up explains the prerequisite instead.
        steps.push({
            key: 'assets', kind: 'assets',
            q: 'Do you own equipment, computers, furniture or vehicles?',
            help: 'One line per thing, at what it is realistically worth TODAY after wear and tear. Each becomes a real asset record that depreciates from here on.'
        });

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
        } else if (yes && step.kind === 'banks') {
            const rows = (a.rows && a.rows.length) ? a.rows
                : (bankAccounts.length
                    ? bankAccounts.map(b => ({ bankId: b.id, newName: '', amount: '' }))
                    : [{ bankId: '__new__', newName: '', amount: '' }]);
            body = `
                <div class="obw-followup">
                    <table class="obw-party-table">
                        <thead><tr>
                            <th>Account</th><th style="width:200px">Name it</th>
                            <th style="width:150px">Balance</th><th style="width:36px"></th>
                        </tr></thead>
                        <tbody id="obwBankRows">${rows.map((r, i) => bankRowHtml(r, i)).join('')}</tbody>
                    </table>
                    <button type="button" class="btn btn-sm btn-outline" id="obwAddBank" style="margin-top:0.6rem;">+ Add another account</button>
                    <small class="field-hint">Each account gets its own ledger — two accounts cannot share one, or neither could be reconciled against its statement.</small>
                </div>`;
        } else if (yes && step.kind === 'stock') {
            const rows = (a.rows && a.rows.length) ? a.rows : [{ sku: '', quantity: '', unit_cost: '' }];
            body = `
                <div class="obw-followup">
                    <table class="obw-party-table">
                        <thead><tr>
                            <th>Item</th><th style="width:110px">Quantity</th>
                            <th style="width:140px">Cost each</th><th style="width:36px"></th>
                        </tr></thead>
                        <tbody id="obwStockRows">${rows.map((r, i) => stockRowHtml(r, i)).join('')}</tbody>
                    </table>
                    <button type="button" class="btn btn-sm btn-outline" id="obwAddStock" style="margin-top:0.6rem;">+ Add another</button>
                </div>`;
        } else if (yes && step.kind === 'assets') {
            const rows = (a.rows && a.rows.length) ? a.rows : [{ name: '', category: '', value: '' }];
            body = `
                <div class="obw-followup">
                    <table class="obw-party-table">
                        <thead><tr>
                            <th>What is it</th><th style="width:190px">Kind</th>
                            <th style="width:140px">Worth today</th><th style="width:36px"></th>
                        </tr></thead>
                        <tbody id="obwAssetRows">${rows.map((r, i) => assetRowHtml(r, i)).join('')}</tbody>
                    </table>
                    <button type="button" class="btn btn-sm btn-outline" id="obwAddAsset" style="margin-top:0.6rem;">+ Add another</button>
                    ${assetCategories.length === 0 ? `<small class="field-hint obw-warn">No asset kinds are set up yet. Create at least one under Assets &rsaquo; Categories (it decides the depreciation rate), then come back — assets cannot be recorded without one.</small>` : ''}
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

    function bankRowHtml(row, i) {
        const opts = bankAccounts.map(b =>
            `<option value="${esc(b.id)}"${b.id === row.bankId ? ' selected' : ''}>${esc(b.account_name || b.bank_name || 'Bank')}</option>`)
            .concat([`<option value="__new__"${row.bankId === '__new__' ? ' selected' : ''}>＋ An account not set up yet…</option>`])
            .join('');
        const isNew = row.bankId === '__new__';
        return `
            <tr data-row="${i}">
                <td><select class="form-control obw-bank" data-no-sd="true">${opts}</select></td>
                <td><input type="text" class="form-control obw-bankname" placeholder="${isNew ? 'e.g. HDFC Current' : '—'}"
                           value="${esc(row.newName || '')}" ${isNew ? '' : 'disabled'}></td>
                <td><input type="number" class="form-control obw-bankamt" min="0" step="0.01" placeholder="0.00" value="${row.amount ? esc(row.amount) : ''}"></td>
                <td><button type="button" class="btn-icon btn-icon-danger obw-del" title="Remove">&times;</button></td>
            </tr>`;
    }

    function stockRowHtml(row, i) {
        const opts = ['<option value="">Select…</option>']
            .concat(items.map(it => {
                const sku = it.sku || it.code || '';
                const label = sku ? `${sku} — ${it.name || ''}` : (it.name || '');
                return `<option value="${esc(sku)}"${sku === row.sku ? ' selected' : ''}>${esc(label)}</option>`;
            })).join('');
        return `
            <tr data-row="${i}">
                <td><select class="form-control obw-sku" data-no-sd="true">${opts}</select></td>
                <td><input type="number" class="form-control obw-qty" min="0" step="any" placeholder="0" value="${row.quantity ? esc(row.quantity) : ''}"></td>
                <td><input type="number" class="form-control obw-cost" min="0" step="0.01" placeholder="0.00" value="${row.unit_cost ? esc(row.unit_cost) : ''}"></td>
                <td><button type="button" class="btn-icon btn-icon-danger obw-del" title="Remove">&times;</button></td>
            </tr>`;
    }

    function assetRowHtml(row, i) {
        const opts = ['<option value="">Select…</option>']
            .concat(assetCategories.map(c => `<option value="${esc(c.id)}"${c.id === row.category ? ' selected' : ''}>${esc(c.name)}</option>`))
            .join('');
        return `
            <tr data-row="${i}">
                <td><input type="text" class="form-control obw-aname" placeholder="e.g. Billing counter PC" value="${esc(row.name || '')}"></td>
                <td><select class="form-control obw-acat" data-no-sd="true">${opts}</select></td>
                <td><input type="number" class="form-control obw-aval" min="0" step="0.01" placeholder="0.00" value="${row.value ? esc(row.value) : ''}"></td>
                <td><button type="button" class="btn-icon btn-icon-danger obw-del" title="Remove">&times;</button></td>
            </tr>`;
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
        const glRows = [];    // -> coa/opening-balances/bulk
        const arRows = [];    // -> import/opening-balances
        const apRows = [];
        const stockRows = []; // -> import/opening-stock   (posts its own GL)
        const assetRows = []; // -> assets                 (posts its own GL)
        const bankRows = [];  // existing bank -> glRows; new bank -> created first

        steps.forEach(step => {
            const a = answers[step.key];
            if (!a || a.yes !== true) return;

            if (step.kind === 'amount' && a.amount > 0) {
                glRows.push({ account: step.account, amount: a.amount, side: step.side, label: step.amountLabel });
            } else if (step.kind === 'gst') {
                step.gstIn.forEach(g => { if (a[g.key] > 0) glRows.push({ account: g.account, amount: a[g.key], side: 'debit', label: g.label }); });
                step.gstOut.forEach(g => { if (a[g.key] > 0) glRows.push({ account: g.account, amount: a[g.key], side: 'credit', label: g.label }); });
            } else if (step.kind === 'banks') {
                (a.rows || []).forEach(r => {
                    if (!(r.amount > 0)) return;
                    if (r.bankId === '__new__') {
                        if (r.newName) bankRows.push({ isNew: true, name: r.newName, amount: r.amount });
                    } else {
                        const bank = bankAccounts.find(b => b.id === r.bankId);
                        if (bank) bankRows.push({ isNew: false, bank, amount: r.amount });
                    }
                });
            } else if (step.kind === 'stock') {
                (a.rows || []).forEach(r => {
                    if (r.sku && r.quantity > 0 && r.unit_cost > 0) {
                        stockRows.push({ sku: r.sku, quantity: r.quantity, unit_cost: r.unit_cost });
                    }
                });
            } else if (step.kind === 'assets') {
                (a.rows || []).forEach(r => {
                    if (r.name && r.category && r.value > 0) assetRows.push(r);
                });
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

        // Stock and assets are debits too — they post their own entries, but they are
        // still things the business OWNS and belong in the figure shown to the user.
        // Leaving them out would understate the stake by exactly their value.
        // An existing bank already has a ledger, so it can go through the same
        // atomic bulk post as everything else. A NEW one has no ledger yet, so it
        // is created during save and its balance appended to that same call —
        // which is why bankRows is carried separately rather than merged here.
        bankRows.filter(r => !r.isNew).forEach(r => {
            const acct = accounts.find(a => a.id === r.bank.gl_account_id);
            if (acct) glRows.push({ account: acct, amount: r.amount, side: 'debit', label: r.bank.account_name || 'Bank' });
        });

        const bankNewValue = bankRows.filter(r => r.isNew).reduce((s, r) => s + r.amount, 0);
        const stockValue = stockRows.reduce((s, r) => s + r.quantity * r.unit_cost, 0);
        const assetValue = assetRows.reduce((s, r) => s + r.value, 0);

        const debits = glRows.filter(r => r.side === 'debit').reduce((s, r) => s + r.amount, 0)
                     + arRows.reduce((s, r) => s + r.amount, 0)
                     + stockValue + assetValue + bankNewValue;
        const credits = glRows.filter(r => r.side === 'credit').reduce((s, r) => s + r.amount, 0)
                      + apRows.reduce((s, r) => s + r.amount, 0);

        return { glRows, arRows, apRows, stockRows, assetRows, bankRows, stockValue, assetValue,
                 debits, credits, stake: debits - credits };
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

        const stockLine = (r) => `
            <tr>
                <td>${esc(r.sku)}</td>
                <td class="obw-acct">Opening stock · ${esc(r.quantity)} &times; ${money(r.unit_cost)}</td>
                <td class="obw-side">Money in / owned</td>
                <td class="obw-amt">${money(r.quantity * r.unit_cost)}</td>
            </tr>`;
        const assetLine = (r) => {
            const cat = assetCategories.find(c => c.id === r.category);
            return `
            <tr>
                <td>${esc(r.name)}</td>
                <td class="obw-acct">Asset register${cat ? ' · ' + esc(cat.name) : ''}</td>
                <td class="obw-side">Money in / owned</td>
                <td class="obw-amt">${money(r.value)}</td>
            </tr>`;
        };

        const newBankLine = (r) => `
            <tr>
                <td>${esc(r.name)}</td>
                <td class="obw-acct">New bank + its own ledger</td>
                <td class="obw-side">Money in / owned</td>
                <td class="obw-amt">${money(r.amount)}</td>
            </tr>`;

        if (!p.glRows.length && !p.arRows.length && !p.apRows.length && !p.stockRows.length && !p.assetRows.length && !p.bankRows.length) {
            return `<div class="obw-q">Nothing to record</div>
                    <div class="obw-help">You answered no to everything. Go back if that was not what you meant.</div>`;
        }

        return `
            <div class="obw-q">Here is what we will record</div>
            <div class="obw-help">As at <strong>${esc(asOfDate)}</strong>. Nothing is saved until you press the button below.</div>
            <table class="obw-review">
                <tbody>
                    ${p.glRows.map(r => line(r.label, r.account, r.amount, r.side)).join('')}
                    ${p.bankRows.filter(r => r.isNew).map(newBankLine).join('')}
                    ${p.stockRows.map(stockLine).join('')}
                    ${p.assetRows.map(assetLine).join('')}
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

        if (step.kind === 'banks') {
            // The name box only applies to a NEW account, so flipping the picker
            // has to re-render — otherwise it stays disabled and the row cannot
            // be completed, with nothing on screen saying why.
            body.querySelectorAll('.obw-bank').forEach(sel => sel.addEventListener('change', () => {
                captureStep(step);
                render();
            }));
            document.getElementById('obwAddBank')?.addEventListener('click', () => {
                captureStep(step);
                const a2 = answers[step.key];
                a2.rows = (a2.rows || []).concat([{ bankId: '__new__', newName: '', amount: '' }]);
                render();
            });
            body.querySelectorAll('.obw-del').forEach(b => b.addEventListener('click', (e) => {
                captureStep(step);
                const idx = Number(e.target.closest('tr').dataset.row);
                const a2 = answers[step.key];
                a2.rows = (a2.rows || []).filter((_, i) => i !== idx);
                if (!a2.rows.length) a2.rows = [{ bankId: '__new__', newName: '', amount: '' }];
                render();
            }));
        }

        if (step.kind === 'stock' || step.kind === 'assets') {
            const blank = step.kind === 'stock'
                ? { sku: '', quantity: '', unit_cost: '' }
                : { name: '', category: '', value: '' };
            document.getElementById(step.kind === 'stock' ? 'obwAddStock' : 'obwAddAsset')
                ?.addEventListener('click', () => {
                    captureStep(step);
                    const a2 = answers[step.key];
                    a2.rows = (a2.rows || []).concat([{ ...blank }]);
                    render();
                });
            body.querySelectorAll('.obw-del').forEach(b => b.addEventListener('click', (e) => {
                captureStep(step);
                const idx = Number(e.target.closest('tr').dataset.row);
                const a2 = answers[step.key];
                a2.rows = (a2.rows || []).filter((_, i) => i !== idx);
                if (!a2.rows.length) a2.rows = [{ ...blank }];
                render();
            }));
        }

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
        } else if (step.kind === 'banks') {
            a.rows = [...document.querySelectorAll('#obwBankRows tr')].map(tr => ({
                bankId: tr.querySelector('.obw-bank')?.value || '',
                newName: (tr.querySelector('.obw-bankname')?.value || '').trim(),
                amount: parseFloat(tr.querySelector('.obw-bankamt')?.value) || 0
            }));
        } else if (step.kind === 'stock') {
            a.rows = [...document.querySelectorAll('#obwStockRows tr')].map(tr => ({
                sku: tr.querySelector('.obw-sku')?.value || '',
                quantity: parseFloat(tr.querySelector('.obw-qty')?.value) || 0,
                unit_cost: parseFloat(tr.querySelector('.obw-cost')?.value) || 0
            }));
        } else if (step.kind === 'assets') {
            a.rows = [...document.querySelectorAll('#obwAssetRows tr')].map(tr => ({
                name: (tr.querySelector('.obw-aname')?.value || '').trim(),
                category: tr.querySelector('.obw-acat')?.value || '',
                value: parseFloat(tr.querySelector('.obw-aval')?.value) || 0
            }));
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
        if (!p.glRows.length && !p.arRows.length && !p.apRows.length && !p.stockRows.length && !p.assetRows.length && !p.bankRows.length) {
            Toast.error('Nothing to save — go back and answer at least one question.');
            return;
        }

        if (!AccountsCommon.beginSubmit('obWizard')) return;
        const btn = document.getElementById('obwNext');
        if (btn) btn.disabled = true;

        // ⭐ THIS SPANS FOUR SUBSYSTEMS AND CANNOT BE ONE TRANSACTION. The GL bulk
        // is atomic within itself; the stock import, the asset register and the
        // AR/AP import each commit separately. So the order below is chosen to make
        // a failure as harmless as possible, and `written` exists so a failure tells
        // the truth about what DID land rather than claiming nothing did — which is
        // the lie the first version of this told, and the one that would send a user
        // to re-enter figures that are already in the ledger.
        //
        //  1. Dry-run everything that CAN be dry-run, before writing anything.
        //  2. Assets next: the register has no dry run, so it is the one that can
        //     still surprise us — better it fails with nothing else written.
        //  3. Then the GL bulk, stock and parties, whose dry runs already passed.
        const written = [];
        try {
            const partyRows = p.arRows.concat(p.apRows);

            if (partyRows.length) {
                const dry = await api.request(AccountsCommon.buildUrl('import/opening-balances'), {
                    method: 'POST',
                    body: JSON.stringify({ rows: partyRows, dry_run: true, as_of_date: asOfDate })
                });
                const bad = (dry?.rows || dry?.results || []).filter(r => r.outcome === 'error');
                if (bad.length) {
                    Toast.error(`Nothing was saved. ${bad.length} customer/supplier row${bad.length === 1 ? '' : 's'} would fail: ${bad.slice(0, 3).map(b => b.message).join('; ')}`);
                    return;
                }
            }

            if (p.stockRows.length) {
                const dry = await api.request(AccountsCommon.buildUrl('import/opening-stock'), {
                    method: 'POST',
                    body: JSON.stringify({ rows: p.stockRows, dry_run: true, as_of_date: asOfDate })
                });
                const bad = (dry?.rows || []).filter(r => r.outcome === 'error');
                if (bad.length) {
                    Toast.error(`Nothing was saved. ${bad.length} stock row${bad.length === 1 ? '' : 's'} would fail: ${bad.slice(0, 3).map(b => b.message).join('; ')}`);
                    return;
                }
            }

            // Assets first among the writes — no dry run available for the register.
            // funding_source 'opening' credits the same contra as everything else
            // here: 'bank' would drain the opening bank balance just keyed in, and
            // 'payable' would invent a supplier debt for a desk bought years ago.
            // See AssetOpeningBalanceFundingTests.
            for (const r of p.assetRows) {
                await api.request(AccountsCommon.buildUrl('assets'), {
                    method: 'POST',
                    body: JSON.stringify({
                        asset_code: 'OB-' + Math.random().toString(36).slice(2, 8).toUpperCase(),
                        name: r.name,
                        asset_category_id: r.category,
                        purchase_date: asOfDate,
                        purchase_cost: r.value,
                        salvage_value: 0,
                        funding_source: 'opening'
                    })
                });
                written.push(`asset "${r.name}"`);
            }

            // New banks first: each needs a LEDGER OF ITS OWN before any balance
            // can point at it (uq_bank_accounts_active_gl forbids sharing one).
            // Their balances are folded into the SAME bulk call below, so the
            // whole set of opening balances still posts atomically rather than
            // the new banks landing in a second, separate post.
            const extraBalances = [];
            for (const r of p.bankRows.filter(x => x.isNew)) {
                const gl = await AccountsCommon.createBankGlAccount(r.name);
                written.push(`ledger ${gl.account_code} for "${r.name}"`);
                await api.request(AccountsCommon.buildUrl('bank/accounts'), {
                    method: 'POST',
                    body: JSON.stringify({ account_name: r.name, bank_name: r.name, account_type: 'bank', gl_account_id: gl.id })
                });
                written.push(`bank account "${r.name}"`);
                extraBalances.push({ account_id: gl.id, amount: r.amount, balance_type: 'debit', as_of_date: asOfDate });
            }

            if (p.glRows.length || extraBalances.length) {
                await api.request(AccountsCommon.buildUrl('coa/opening-balances/bulk'), {
                    method: 'POST',
                    body: JSON.stringify({
                        balances: extraBalances.concat(p.glRows.map(r => ({
                            account_id: r.account.id,
                            amount: r.amount,
                            balance_type: r.side,
                            as_of_date: asOfDate
                        })))
                    })
                });
                const n = p.glRows.length + extraBalances.length;
                written.push(`${n} account balance${n === 1 ? '' : 's'}`);
            }

            if (p.stockRows.length) {
                await api.request(AccountsCommon.buildUrl('import/opening-stock'), {
                    method: 'POST',
                    body: JSON.stringify({ rows: p.stockRows, dry_run: false, as_of_date: asOfDate })
                });
                written.push(`${p.stockRows.length} stock line${p.stockRows.length === 1 ? '' : 's'}`);
            }

            if (partyRows.length) {
                await api.request(AccountsCommon.buildUrl('import/opening-balances'), {
                    method: 'POST',
                    body: JSON.stringify({ rows: partyRows, dry_run: false, as_of_date: asOfDate })
                });
                written.push(`${partyRows.length} customer/supplier balance${partyRows.length === 1 ? '' : 's'}`);
            }

            AccountsCommon.closeModal(MODAL_ID);
            Toast.success('Opening balances saved');
            if (typeof loadOpeningBalances === 'function') await loadOpeningBalances();
        } catch (err) {
            console.error('[OBWizard] save failed:', err);
            const msg = err.message || 'Could not save the opening balances.';
            // Say exactly what landed. Telling someone "nothing was saved" when half
            // of it was is worse than the failure: they re-enter it and the ledger
            // doubles.
            Toast.error(written.length
                ? `Stopped after saving ${written.join(', ')}. The rest was NOT saved — ${msg} Re-run the wizard for the remaining items only.`
                : `Nothing was saved — ${msg}`);
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
            const [coa, cust, vend, inv, cats, banks] = await Promise.all([
                api.request(AccountsCommon.buildUrl('coa'), { _skipSpinner: true }),
                api.request(AccountsCommon.buildUrl('customers'), { _skipSpinner: true }).catch(() => []),
                api.request(AccountsCommon.buildUrl('vendors'), { _skipSpinner: true }).catch(() => []),
                api.request(AccountsCommon.buildUrl('inventory/items'), { _skipSpinner: true }).catch(() => []),
                api.request(AccountsCommon.buildUrl('assets/categories'), { _skipSpinner: true }).catch(() => []),
                api.request(AccountsCommon.buildUrl('bank/accounts'), { _skipSpinner: true }).catch(() => [])
            ]);
            const arr = (x) => Array.isArray(x) ? x : (x?.data || x?.items || []);
            accounts = arr(coa);
            customers = arr(cust);
            vendors = arr(vend);
            items = arr(inv);
            assetCategories = arr(cats);
            bankAccounts = arr(banks);
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
