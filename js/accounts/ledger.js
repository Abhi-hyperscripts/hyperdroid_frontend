/**
 * AccountsService — General Ledger Page
 *
 * Handles 3 sidebar tabs:
 *   1. GL Entries              2. Create Entry
 *   3. Journal Entries
 */

// ============================================================================
// GLOBAL STATE
// ============================================================================

let glEntries = [];
let journalTypes = [];
let coaAccounts = [];
let glLines = [];
let currentGlPage = 1;
let journalPage = 1;
const GL_PAGE_SIZE = 50;
let editingGlId = null;
let glSaveInFlight = false; // double-submit guard for saveGlEntry (each save can create + post an entry)
let glEditNavigating = false; // true while editGlEntry is switching to the create tab (it repopulates itself)

// Dropdown instances
let glAccountFilterDropdown = null;
let glJournalFilterDropdown = null;
let journalTypeFilterDropdown = null;
let glJournalTypeDropdown = null; // Create Entry form journal type
let glLineDropdowns = new Map(); // lineIdx → SearchableDropdown instance

// ============================================================================
// PAGE INIT
// ============================================================================

document.addEventListener('DOMContentLoaded', async function () {
    if (!await AccountsCommon.initPage('ledger', '../')) return;

    const tabNames = {
        'gl-entries': 'GL Entries',
        'create-gl': 'Create Entry',
        'journal-entries': 'Journal Entries'
    };

    AccountsCommon.setupSidebar('sidebarToggle', 'accountsSidebar', 'sidebarOverlay', tabNames);
    AccountsCommon.setupTabs(tabNames, onTabSwitch);
    accountsRoles.applyRBAC();

    await loadInitialData();
    AccountsCommon.initSearchableDropdownsWithRetry(initDropdowns);
    setupSearchListeners();
    AccountsCommon.initDatePickers([
        { id: 'glFromDate', onChange: () => { currentGlPage = 1; loadGlEntries(); } },
        { id: 'glToDate', onChange: () => { currentGlPage = 1; loadGlEntries(); } },
        { id: 'journalFromDate', onChange: () => { journalPage = 1; loadJournalEntries(); } },
        { id: 'journalToDate', onChange: () => { journalPage = 1; loadJournalEntries(); } },
        'glEntryDate', 'reversalDate'
    ]);
});

// ============================================================================
// TAB SWITCH HANDLER
// ============================================================================

function onTabSwitch(tabId) {
    switch (tabId) {
        case 'gl-entries':       loadGlEntries(); break;
        case 'create-gl':       initCreateGlTab(); break;
        case 'journal-entries':  loadJournalEntries(); break;
    }
}

function initCreateGlTab() {
    // editGlEntry navigates here and repopulates the form itself — don't wipe its data.
    if (glEditNavigating) { glEditNavigating = false; return; }
    // Any other way of entering the Create Entry tab is a fresh create: reset unconditionally so a
    // leftover editingGlId / line rows from an abandoned edit can't make the next save PUT the old entry.
    resetGlForm();
}

// ============================================================================
// INITIAL DATA LOAD
// ============================================================================

async function loadInitialData() {
    try {
        const [journalRes, coaRes] = await Promise.all([
            api.request(AccountsCommon.buildUrl('journals/types'), { _skipSpinner: true }).catch(() => []),
            api.request(AccountsCommon.buildUrl('coa'), { _skipSpinner: true }).catch(() => [])
        ]);

        journalTypes = Array.isArray(journalRes) ? journalRes : (journalRes?.data || journalRes?.items || []);
        coaAccounts = Array.isArray(coaRes) ? coaRes : (coaRes?.data || coaRes?.items || []);

        populateJournalTypeSelect();
        await loadGlEntries();
    } catch (err) {
        console.error('[Ledger] loadInitialData error:', err);
    }
}

function resolveUserName(userId) {
    const stored = typeof getStoredUser === 'function' ? getStoredUser() : null;
    if (stored && stored.userId === userId) {
        return [stored.firstName, stored.lastName].filter(Boolean).join(' ') || stored.email || userId;
    }
    return userId; // TODO: resolve via Auth gRPC on backend
}

function populateJournalTypeSelect() {
    const container = document.getElementById('glJournalTypeContainer');
    if (!container || typeof SearchableDropdown === 'undefined') return;
    container.innerHTML = ''; // Clear previous dropdown
    const opts = [{ value: '', label: 'Select Journal Type...' }].concat(
        journalTypes.map(j => ({ value: j.id, label: j.name || j.journal_type_name || j.type }))
    );
    glJournalTypeDropdown = new SearchableDropdown(container, {
        id: 'glJournalType',
        options: opts,
        placeholder: 'Select Journal Type...'
    });
}

// ============================================================================
// SEARCH LISTENERS
// ============================================================================

function setupSearchListeners() {
    const debounce = (fn, ms = 300) => {
        let timer;
        return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); };
    };

    const glSearch = document.getElementById('glSearch');
    if (glSearch) glSearch.addEventListener('input', debounce(() => { currentGlPage = 1; loadGlEntries(); }));

    const journalSearch = document.getElementById('journalSearch');
    if (journalSearch) journalSearch.addEventListener('input', debounce(() => { journalPage = 1; loadJournalEntries(); }));
}

// ============================================================================
// 1. GL ENTRIES — LIST
// ============================================================================

async function loadGlEntries() {
    try {
        const accountId = glAccountFilterDropdown?.getValue?.() || '';
        const journalType = glJournalFilterDropdown?.getValue?.() || '';
        const statusSel = document.getElementById('glStatusFilter')?.value || '';
        // 'reversed' is not a real backend status — ReverseGlEntry sets
        // is_reversed=true while status stays 'posted', and GET /gl has no
        // is_reversed filter param (backend gap: QueryGlEntries only filters
        // g.status). Query posted entries and filter is_reversed client-side
        // over the loaded page (the option is labelled accordingly).
        const filterReversed = statusSel === 'reversed';
        const status = filterReversed ? 'posted' : statusSel;
        const fromDate = document.getElementById('glFromDate')?.value || '';
        const toDate = document.getElementById('glToDate')?.value || '';
        const search = document.getElementById('glSearch')?.value || '';

        const params = { limit: GL_PAGE_SIZE, offset: (currentGlPage - 1) * GL_PAGE_SIZE };
        if (accountId) params.accountId = accountId;
        if (journalType) params.journalTypeId = journalType;
        if (status) params.status = status;
        if (fromDate) params.fromDate = fromDate;
        if (toDate) params.toDate = toDate;
        if (search) params.search = search;
        const refType = document.getElementById('glRefTypeFilter')?.value;
        if (refType) params.referenceType = refType;

        const url = AccountsCommon.buildUrl('gl', params);
        const res = await api.request(url, { _skipSpinner: true });
        const data = res?.data || res?.items || (Array.isArray(res) ? res : []);
        glEntries = filterReversed ? data.filter(e => e.is_reversed) : data;

        // ?? not || — a real total of 0 must not fall back to the page length.
        // Note: when filterReversed, total/pages still track the posted set —
        // the reversed subset is a per-page client-side view.
        const total = res?.total ?? res?.totalCount ?? glEntries.length;
        const totalPages = Math.ceil(total / GL_PAGE_SIZE) || 1;
        // Clamp if actioning the last row on a page left us past the end (else an empty "No … found").
        if (currentGlPage > totalPages) { currentGlPage = totalPages; return loadGlEntries(); }

        renderGlTable();
        AccountsCommon.renderPagination('glPagination', currentGlPage, totalPages, (page) => {
            currentGlPage = page;
            loadGlEntries();
        });
    } catch (err) {
        console.error('[Ledger] loadGlEntries error:', err);
        Toast.error('Failed to load GL entries');
    }
}

function renderGlTable() {
    const tbody = document.getElementById('glEntriesTable');
    if (!tbody) return;
    if (!glEntries.length) {
        tbody.innerHTML = `<tr class="empty-state"><td colspan="8"><div class="empty-message">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg><p>No GL entries found</p></div></td></tr>`;
        return;
    }

    const journalMap = {};
    journalTypes.forEach(j => { journalMap[j.id] = j.name || j.journal_type_name || j.type; });
    const esc = AccountsCommon.escapeHtml, fmt = AccountsCommon.formatCurrency, fmtD = AccountsCommon.formatDate;
    const isAdmin = accountsRoles.isAdmin();

    const viewSvg = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
    const editSvg = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>';
    const postSvg = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>';
    const lockSvg = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>';
    const unlockSvg = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/></svg>';
    const reverseSvg = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>';
    const deleteSvg = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>';

    tbody.innerHTML = glEntries.map(e => {
        let actions = `<button class="btn-icon" onclick="viewGlEntry('${e.id}')" data-tooltip="View">${viewSvg}</button>`;
        if (isAdmin && e.status === 'draft') {
            actions += `<button class="btn-icon" onclick="editGlEntry('${e.id}')" data-tooltip="Edit">${editSvg}</button>`;
            actions += `<button class="btn-icon" onclick="postGlEntry('${e.id}')" data-tooltip="Post">${postSvg}</button>`;
            actions += `<button class="btn-icon" onclick="lockGlEntry('${e.id}')" data-tooltip="Lock">${lockSvg}</button>`;
            actions += `<button class="btn-icon" onclick="unlockGlEntry('${e.id}')" data-tooltip="Unlock">${unlockSvg}</button>`;
            actions += `<button class="btn-icon danger" onclick="deleteGlEntry('${e.id}')" data-tooltip="Delete">${deleteSvg}</button>`;
        }
        if (isAdmin && e.status === 'posted' && !e.is_reversed && e.reference_type !== 'reversal') {
            actions += `<button class="btn-icon" onclick="reverseGlEntry('${e.id}')" data-tooltip="Reverse">${reverseSvg}</button>`;
        }

        const entryNum = (e.entry_number || e.gl_number || '-');
        const entryNumDisplay = entryNum.length > 16 ? entryNum.substring(0, 14) + '...' : entryNum;

        return `<tr>
            <td data-tooltip="${esc(entryNum)}"><code>${esc(entryNumDisplay)}</code></td>
            <td>${fmtD(e.entry_date || e.date)}</td>
            <td>${esc(journalMap[e.journal_type_id] || e.journal_type_name || e.journal_type || '-')}</td>
            <td>${esc(e.description || '-')}</td>
            <td class="text-right">${fmt(e.total_debit)}</td>
            <td class="text-right">${fmt(e.total_credit)}</td>
            <td>${AccountsCommon.statusBadge(e.is_reversed ? 'reversed' : e.status)}</td>
            <td class="actions-cell">${actions}</td>
        </tr>`;
    }).join('');
}

// ============================================================================
// GL ENTRY — VIEW DETAIL
// ============================================================================

async function viewGlEntry(id) {
    try {
        const res = await api.request(AccountsCommon.buildUrl(`gl/${id}`));
        const entry = res?.data || res;
        if (!entry) { Toast.error('Entry not found'); return; }

        const esc = AccountsCommon.escapeHtml, fmt = AccountsCommon.formatCurrency, fmtD = AccountsCommon.formatDate;
        const lines = entry.lines || entry.line_items || [];

        const acctMap = {};
        coaAccounts.forEach(a => { const c = a.account_code || a.code || ''; const n = a.account_name || a.name || ''; acctMap[a.id] = c ? c + ' - ' + n : n; });

        const journalMap = {};
        journalTypes.forEach(j => { journalMap[j.id] = j.name || j.journal_type_name || j.type; });

        const linesHtml = lines.length ? lines.map(l => `<tr>
            <td>${esc(l.account_code ? l.account_code + ' - ' + (l.account_name || '') : (acctMap[l.account_id] || l.account_name || '-'))}</td>
            <td>${esc(l.description || '-')}</td>
            <td class="text-right">${fmt(l.debit_amount || l.debit || 0)}</td>
            <td class="text-right">${fmt(l.credit_amount || l.credit || 0)}</td>
        </tr>`).join('') : '<tr><td colspan="4" style="text-align:center;padding:1rem;">No line items</td></tr>';

        let reversalInfo = '';
        if (entry.is_reversed && entry.reversed_by) {
            reversalInfo = `<div style="margin-top:1rem; padding:0.75rem; background:var(--bg-tertiary); border-radius:8px;">
                <strong>Reversed</strong> — Reversal Entry: <code>${esc(entry.reversed_by)}</code>
            </div>`;
        }
        if (entry.reversal_of) {
            reversalInfo = `<div style="margin-top:1rem; padding:0.75rem; background:var(--bg-tertiary); border-radius:8px;">
                <strong>Reversal of:</strong> <code>${esc(entry.reversal_of)}</code>
            </div>`;
        }

        document.getElementById('glDetailTitle').textContent = `GL Entry: ${entry.entry_number || entry.gl_number || id}`;
        document.getElementById('glDetailBody').innerHTML = `
            <div class="form-row two-col" style="margin-bottom:1rem;">
                <div><strong>Entry #:</strong> ${esc(entry.entry_number || entry.gl_number || '-')}</div>
                <div><strong>Date:</strong> ${fmtD(entry.entry_date || entry.date)}</div>
            </div>
            <div class="form-row two-col" style="margin-bottom:1rem;">
                <div><strong>Journal Type:</strong> ${esc(journalMap[entry.journal_type_id] || entry.journal_type || '-')}</div>
                <div><strong>Status:</strong> ${AccountsCommon.statusBadge(entry.status)}</div>
            </div>
            <div style="margin-bottom:1rem;"><strong>Description:</strong> ${esc(entry.description || '-')}</div>
            <div style="margin-bottom:1rem;"><strong>Reference:</strong> ${entry.reference_type
                ? esc(String(entry.reference_type).replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()))
                    + (entry.reference_id ? ` <code style="font-size:0.75rem">${esc(entry.reference_id)}</code>` : '')
                : '-'}</div>
            ${entry.posted_by ? `<div style="margin-bottom:1rem;"><strong>Posted:</strong> ${esc(resolveUserName(entry.posted_by))} on ${fmtD(entry.posted_at)}</div>` : ''}
            <div class="data-table-container" style="margin-top:1rem;">
                <table class="data-table">
                    <thead><tr><th>Account</th><th>Description</th><th>Debit</th><th>Credit</th></tr></thead>
                    <tbody>${linesHtml}</tbody>
                    <tfoot><tr style="font-weight:600;">
                        <td colspan="2" class="text-right">Totals</td>
                        <td class="text-right">${fmt(entry.total_debit)}</td>
                        <td class="text-right">${fmt(entry.total_credit)}</td>
                    </tr></tfoot>
                </table>
            </div>
            ${reversalInfo}`;

        AccountsCommon.openModal('glDetailModal');
    } catch (err) {
        console.error('[Ledger] viewGlEntry error:', err);
        Toast.error('Failed to load entry details');
    }
}

// ============================================================================
// GL ENTRY — POST
// ============================================================================

async function postGlEntry(id) {
    const ok = await Confirm.show({ title: 'Post GL Entry', message: 'Post this GL entry? Posted entries cannot be edited.', confirmText: 'Post', type: 'warning' });
    if (!ok) return;
    try {
        await api.request(AccountsCommon.buildUrl(`gl/${id}/post`), { method: 'POST' });
        Toast.success('GL entry posted');
        await loadGlEntries();
    } catch (err) {
        console.error('[Ledger] postGlEntry error:', err);
        Toast.error(err.message || 'Failed to post GL entry');
    }
}

// ============================================================================
// GL ENTRY — REVERSE
// ============================================================================

function reverseGlEntry(id) {
    document.getElementById('reverseGlId').value = id;
    AccountsCommon.setDateField('reversalDate', AccountsCommon.todayLocal());
    document.getElementById('reversalReason').value = '';
    AccountsCommon.openModal('reverseGlModal');
}

async function confirmReverse() {
    const id = document.getElementById('reverseGlId').value;
    const reversalDate = document.getElementById('reversalDate').value;
    const reason = document.getElementById('reversalReason').value.trim();

    if (!reversalDate || !reason) {
        Toast.error('Reversal date and reason are required');
        return;
    }

    try {
        await api.request(AccountsCommon.buildUrl(`gl/${id}/reverse`), {
            method: 'POST',
            body: JSON.stringify({ reversal_date: reversalDate, reason })
        });
        Toast.success('GL entry reversed');
        AccountsCommon.closeModal('reverseGlModal');
        await loadGlEntries();
    } catch (err) {
        console.error('[Ledger] confirmReverse error:', err);
        Toast.error(err.message || 'Failed to reverse GL entry');
    }
}

// ============================================================================
// GL ENTRY — DELETE
// ============================================================================

async function deleteGlEntry(id) {
    const ok = await Confirm.danger('Delete this draft GL entry? This cannot be undone.', 'Delete GL Entry');
    if (!ok) return;
    try {
        await api.request(AccountsCommon.buildUrl(`gl/${id}`), { method: 'DELETE' });
        Toast.success('GL entry deleted');
        await loadGlEntries();
    } catch (err) {
        console.error('[Ledger] deleteGlEntry error:', err);
        Toast.error(err.message || 'Failed to delete GL entry');
    }
}

// ============================================================================
// GL ENTRY — EDIT DRAFT
// ============================================================================

async function editGlEntry(id) {
    try {
        const res = await api.request(AccountsCommon.buildUrl(`gl/${id}`));
        const entry = res?.data || res;
        if (!entry) { Toast.error('Entry not found'); return; }

        // Switch to Create Entry tab (Tab 2). Flag the navigation so initCreateGlTab doesn't reset
        // the form we're about to populate (and so a plain tab click still resets for a fresh create).
        glEditNavigating = true;
        const btn = document.querySelector('[data-tab="create-gl"]');
        if (btn) btn.click();

        // Wait a tick for the tab to render, then populate
        await new Promise(r => setTimeout(r, 100));

        editingGlId = id;

        // Populate form fields
        if (glJournalTypeDropdown && entry.journal_type_id) {
            glJournalTypeDropdown.setValue(entry.journal_type_id);
        }
        const dateEl = document.getElementById('glEntryDate');
        if (dateEl) dateEl.value = (entry.entry_date || entry.date || '').split('T')[0];
        const descEl = document.getElementById('glDescription');
        if (descEl) descEl.value = entry.description || '';

        // Clear existing lines and populate from entry
        clearGlLines();
        const lines = entry.lines || entry.line_items || [];
        if (lines.length) {
            lines.forEach(l => {
                addGlLine({
                    account_id: l.account_id || '',
                    description: l.description || '',
                    debit: l.debit_amount || l.debit || 0,
                    credit: l.credit_amount || l.credit || 0
                });
            });
        } else {
            addGlLine();
            addGlLine();
        }
        calculateGlTotals();

        // Update form title/button to indicate editing
        const formTitle = document.getElementById('glFormTitle');
        if (formTitle) formTitle.textContent = `Edit GL Entry: ${entry.entry_number || entry.gl_number || id}`;

        Toast.info('Editing draft GL entry — make changes and save');
    } catch (err) {
        console.error('[Ledger] editGlEntry error:', err);
        Toast.error(err.message || 'Failed to load entry for editing');
    }
}

// ============================================================================
// GL ENTRY — LOCK DRAFT
// ============================================================================

async function lockGlEntry(id) {
    const ok = await Confirm.show({ title: 'Lock GL Entry', message: 'Lock this draft GL entry? It will not be editable until unlocked.', confirmText: 'Lock', type: 'warning' });
    if (!ok) return;
    try {
        await api.request(AccountsCommon.buildUrl(`gl/${id}/lock`), { method: 'POST' });
        Toast.success('GL entry locked');
        await loadGlEntries();
    } catch (err) {
        console.error('[Ledger] lockGlEntry error:', err);
        Toast.error(err.message || 'Failed to lock GL entry');
    }
}

// ============================================================================
// GL ENTRY — UNLOCK DRAFT
// ============================================================================

async function unlockGlEntry(id) {
    const ok = await Confirm.show({ title: 'Unlock GL Entry', message: 'Unlock this GL entry? It will become editable again.', confirmText: 'Unlock', type: 'warning' });
    if (!ok) return;
    try {
        await api.request(AccountsCommon.buildUrl(`gl/${id}/unlock`), { method: 'POST' });
        Toast.success('GL entry unlocked');
        await loadGlEntries();
    } catch (err) {
        console.error('[Ledger] unlockGlEntry error:', err);
        Toast.error(err.message || 'Failed to unlock GL entry');
    }
}

// ============================================================================
// GL ENTRY — CREATE FORM (LINE ITEMS)
// ============================================================================

function resetGlForm() {
    editingGlId = null;
    const form = document.getElementById('glForm');
    if (form) form.reset();
    AccountsCommon.setDateField('glEntryDate', AccountsCommon.todayLocal());
    populateJournalTypeSelect();
    clearGlLines();
    addGlLine();
    addGlLine();
    calculateGlTotals();
    const formTitle = document.getElementById('glFormTitle');
    if (formTitle) formTitle.textContent = 'Create GL Entry';
}

function clearGlLines() {
    glLines = [];
    glLineDropdowns.clear();
    const tbody = document.getElementById('glLinesBody');
    if (tbody) tbody.innerHTML = '';
}

function addGlLine(data) {
    const idx = glLines.length;
    glLines.push(data || { account_id: '', description: '', debit: 0, credit: 0 });

    const tbody = document.getElementById('glLinesBody');
    if (!tbody) return;

    const d = glLines[idx];

    const row = document.createElement('tr');
    row.dataset.lineIdx = idx;
    row.innerHTML = `
        <td><div class="line-account-container" id="lineAcct_${idx}"></div></td>
        <td><input type="text" class="form-control form-control-sm line-desc" value="${AccountsCommon.escapeHtml(d.description || '')}" placeholder="Line description"></td>
        <td><input type="number" class="form-control form-control-sm line-debit" value="${d.debit || ''}" min="0" step="0.01" placeholder="0.00" oninput="onGlAmountInput(this, 'debit')" onchange="calculateGlTotals()"></td>
        <td><input type="number" class="form-control form-control-sm line-credit" value="${d.credit || ''}" min="0" step="0.01" placeholder="0.00" oninput="onGlAmountInput(this, 'credit')" onchange="calculateGlTotals()"></td>
        <td><button type="button" class="btn-icon danger" onclick="removeGlLine(${idx})" data-tooltip="Remove"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button></td>`;
    tbody.appendChild(row);

    // Initialize SearchableDropdown for account selection
    const acctOpts = [{ value: '', label: 'Select Account...' }].concat(
        coaAccounts.map(a => {
            const c = a.account_code || a.code || '';
            const n = a.account_name || a.name || '';
            return { value: a.id, label: c ? c + ' - ' + n : n };
        })
    );
    const container = document.getElementById(`lineAcct_${idx}`);
    if (container && typeof SearchableDropdown !== 'undefined') {
        const dd = new SearchableDropdown(container, {
            id: `lineAcctDD_${idx}`,
            options: acctOpts,
            placeholder: 'Select Account...',
            compact: true,
            virtualScroll: coaAccounts.length > 50
        });
        if (d.account_id) dd.setValue(d.account_id);
        glLineDropdowns.set(idx, dd);
    }
}

function onGlAmountInput(input, type) {
    // If user enters debit, clear credit and vice versa (optional UX helper)
    const row = input.closest('tr');
    if (!row) return;
    const val = parseFloat(input.value) || 0;
    if (val > 0) {
        const opposite = type === 'debit' ? '.line-credit' : '.line-debit';
        const otherInput = row.querySelector(opposite);
        if (otherInput && (parseFloat(otherInput.value) || 0) > 0) {
            otherInput.value = '';
        }
    }
    calculateGlTotals();
}

function removeGlLine(index) {
    const tbody = document.getElementById('glLinesBody');
    if (!tbody) return;
    const row = tbody.querySelector(`tr[data-line-idx="${index}"]`);
    if (row) row.remove();
    glLines[index] = null;
    glLineDropdowns.delete(index);
    calculateGlTotals();
}

function calculateGlTotals() {
    const tbody = document.getElementById('glLinesBody');
    if (!tbody) return;
    let totalDebit = 0, totalCredit = 0;

    tbody.querySelectorAll('tr').forEach(row => {
        totalDebit += parseFloat(row.querySelector('.line-debit')?.value) || 0;
        totalCredit += parseFloat(row.querySelector('.line-credit')?.value) || 0;
    });

    const elDebit = document.getElementById('glTotalDebit');
    const elCredit = document.getElementById('glTotalCredit');
    const elDiff = document.getElementById('glDifference');

    if (elDebit) elDebit.textContent = totalDebit.toFixed(2);
    if (elCredit) elCredit.textContent = totalCredit.toFixed(2);

    const diff = Math.abs(totalDebit - totalCredit);
    if (elDiff) {
        elDiff.textContent = diff.toFixed(2);
        elDiff.className = 'gl-totals-value ' + (diff < 0.005 ? 'balanced' : 'unbalanced');
    }
}

// ============================================================================
// GL ENTRY — SAVE
// ============================================================================

async function saveGlEntry(post = false) {
    const journalTypeId = glJournalTypeDropdown ? glJournalTypeDropdown.getValue() : '';
    const entryDate = document.getElementById('glEntryDate').value;
    const description = document.getElementById('glDescription').value.trim();

    if (!journalTypeId || !entryDate || !description) {
        Toast.error('Journal Type, Entry Date, and Description are required');
        return;
    }

    // Collect line items from DOM. Fully blank rows are skipped, but a row
    // with an amount and no account (or an account and no amount) must BLOCK
    // the save — silently dropping it could post a partial entry (two
    // forgotten-account lines that balance each other would just vanish).
    const tbody = document.getElementById('glLinesBody');
    const lines = [];
    const incompleteRows = [];
    tbody?.querySelectorAll('tr').forEach((row, rowNum) => {
        const lineIdx = parseInt(row.dataset.lineIdx);
        const dd = glLineDropdowns.get(lineIdx);
        const account_id = dd ? (dd.getValue() || '') : '';
        const lineDesc = row.querySelector('.line-desc')?.value.trim() || '';
        const debit = parseFloat(row.querySelector('.line-debit')?.value) || 0;
        const credit = parseFloat(row.querySelector('.line-credit')?.value) || 0;
        const hasAmount = debit > 0 || credit > 0;
        if (account_id && hasAmount) {
            lines.push({ account_id, description: lineDesc, debit_amount: debit, credit_amount: credit });
        } else if (account_id || hasAmount) {
            incompleteRows.push(rowNum + 1);
        }
    });

    if (incompleteRows.length) {
        Toast.error(`Line${incompleteRows.length > 1 ? 's' : ''} ${incompleteRows.join(', ')} incomplete — each line needs both an account and a debit or credit amount`);
        return;
    }

    if (lines.length < 2) {
        Toast.error('At least two line items are required');
        return;
    }

    // Validate balanced
    const totalDebit = lines.reduce((s, l) => s + l.debit_amount, 0);
    const totalCredit = lines.reduce((s, l) => s + l.credit_amount, 0);
    if (Math.abs(totalDebit - totalCredit) >= 0.005) {
        Toast.error('Entry must be balanced — total debits must equal total credits');
        return;
    }

    const payload = {
        journal_type_id: journalTypeId,
        entry_date: entryDate,
        description,
        reference_type: 'manual',
        reference_id: null,
        lines
    };

    // Guard against a double-click creating (and posting) the same GL entry twice.
    if (glSaveInFlight) return;
    glSaveInFlight = true;
    document.querySelectorAll('#glSaveDraftBtn, #glSavePostBtn').forEach(b => b.disabled = true);
    try {
        let saved;
        if (editingGlId) {
            saved = await api.request(AccountsCommon.buildUrl(`gl/${editingGlId}`), { method: 'PUT', body: JSON.stringify(payload) });
            if (post) {
                const entryId = saved?.id || editingGlId;
                await api.request(AccountsCommon.buildUrl(`gl/${entryId}/post`), { method: 'POST' });
            }
            Toast.success(post ? 'GL entry updated and posted' : 'GL entry updated');
        } else {
            saved = await api.request(AccountsCommon.buildUrl('gl'), { method: 'POST', body: JSON.stringify(payload) });
            if (post && saved?.id) {
                await api.request(AccountsCommon.buildUrl(`gl/${saved.id}/post`), { method: 'POST' });
            }
            Toast.success(post ? 'GL entry created and posted' : 'GL entry saved as draft');
        }
        resetGlForm();

        // Switch to GL entries tab to see the new/updated entry
        const btn = document.querySelector('[data-tab="gl-entries"]');
        if (btn) btn.click();
    } catch (err) {
        console.error('[Ledger] saveGlEntry error:', err);
        Toast.error(err.message || 'Failed to save GL entry');
    } finally {
        glSaveInFlight = false;
        document.querySelectorAll('#glSaveDraftBtn, #glSavePostBtn').forEach(b => b.disabled = false);
    }
}

// ============================================================================
// 3. JOURNAL ENTRIES
// ============================================================================

async function loadJournalEntries() {
    try {
        const journalTypeId = journalTypeFilterDropdown?.getValue?.() || '';
        const fromDate = document.getElementById('journalFromDate')?.value || '';
        const toDate = document.getElementById('journalToDate')?.value || '';
        const search = document.getElementById('journalSearch')?.value?.trim() || '';

        const params = { limit: GL_PAGE_SIZE, offset: (journalPage - 1) * GL_PAGE_SIZE };
        if (journalTypeId) params.journalTypeId = journalTypeId;
        if (fromDate) params.fromDate = fromDate;
        if (toDate) params.toDate = toDate;
        if (search) params.search = search;

        const url = AccountsCommon.buildUrl('journals/entries', params);
        const res = await api.request(url, { _skipSpinner: true });
        const entries = Array.isArray(res) ? res : (res?.data || res?.items || []);
        const total = res?.total ?? res?.totalCount ?? entries.length;
        const totalPages = Math.ceil(total / GL_PAGE_SIZE) || 1;
        if (journalPage > totalPages) { journalPage = totalPages; return loadJournalEntries(); }
        renderJournalEntriesTable(entries);
        AccountsCommon.renderPagination('journalEntriesPagination', journalPage, totalPages, p => { journalPage = p; loadJournalEntries(); });
    } catch (err) {
        console.error('[Ledger] loadJournalEntries error:', err);
        Toast.error('Failed to load journal entries');
    }
}

function renderJournalEntriesTable(entries) {
    const tbody = document.getElementById('journalEntriesTable');
    if (!tbody) return;
    if (!entries.length) {
        tbody.innerHTML = `<tr class="empty-state"><td colspan="7"><div class="empty-message">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg><p>No journal entries found</p></div></td></tr>`;
        return;
    }

    const journalMap = {};
    journalTypes.forEach(j => { journalMap[j.id] = j.name || j.journal_type_name || j.type; });
    const esc = AccountsCommon.escapeHtml, fmt = AccountsCommon.formatCurrency, fmtD = AccountsCommon.formatDate;
    const viewSvg = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
    const postSvg = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 19V5"/><path d="M5 12l7-7 7 7"/></svg>';
    const reverseSvg = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>';
    const lockSvg = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>';
    const isAdmin = accountsRoles.isAdmin();

    tbody.innerHTML = entries.map(e => {
        const entryNum = (e.entry_number || e.gl_number || '-');
        const entryNumDisplay = entryNum.length > 16 ? entryNum.substring(0, 14) + '...' : entryNum;
        let actions = `<button class="btn-icon" onclick="viewGlEntry('${e.id}')" data-tooltip="View">${viewSvg}</button>`;
        if (isAdmin) {
            if (e.status === 'draft') {
                actions += `<button class="btn-icon" onclick="postGlEntry('${e.id}')" data-tooltip="Post">${postSvg}</button>`;
            }
            if (e.status === 'posted') {
                actions += `<button class="btn-icon" onclick="lockGlEntry('${e.id}')" data-tooltip="Lock">${lockSvg}</button>`;
                // Same guard as the GL Entries tab — never offer Reverse on an
                // already-reversed entry or on a reversal entry itself.
                if (!e.is_reversed && e.reference_type !== 'reversal') {
                    actions += `<button class="btn-icon danger" onclick="reverseGlEntry('${e.id}')" data-tooltip="Reverse">${reverseSvg}</button>`;
                }
            }
        }
        return `<tr>
        <td data-tooltip="${esc(entryNum)}"><code>${esc(entryNumDisplay)}</code></td>
        <td>${esc(journalMap[e.journal_type_id] || e.journal_type || '-')}</td>
        <td>${fmtD(e.entry_date || e.date)}</td>
        <td>${esc(e.description || '-')}</td>
        <td class="text-right">${fmt(e.total_debit || e.total_amount || 0)}</td>
        <td>${AccountsCommon.statusBadge(e.status)}</td>
        <td class="actions-cell">${actions}</td>
    </tr>`;
    }).join('');
}

// ============================================================================
// SEARCHABLE DROPDOWNS INIT
// ============================================================================

function initDropdowns() {
    const accountOpts = [
        { value: '', label: 'All Accounts' },
        ...coaAccounts.map(a => { const c = a.account_code || a.code || ''; const n = a.account_name || a.name || ''; return { value: a.id, label: c ? c + ' - ' + n : n }; })
    ];
    const journalOpts = [
        { value: '', label: 'All Journal Types' },
        ...journalTypes.map(j => ({ value: j.id, label: j.name || j.journal_type_name || j.type }))
    ];

    // GL entries — account filter
    const glAcctContainer = document.getElementById('glAccountFilterContainer');
    if (glAcctContainer) {
        glAccountFilterDropdown = new SearchableDropdown(glAcctContainer, {
            id: 'glAccountFilter',
            options: accountOpts,
            placeholder: 'Filter by Account',
            compact: true,
            onChange: () => { currentGlPage = 1; loadGlEntries(); }
        });
    }

    // GL entries — journal type filter
    const glJournalContainer = document.getElementById('glJournalFilterContainer');
    if (glJournalContainer) {
        glJournalFilterDropdown = new SearchableDropdown(glJournalContainer, {
            id: 'glJournalFilter',
            options: journalOpts,
            placeholder: 'Filter by Journal',
            compact: true,
            onChange: () => { currentGlPage = 1; loadGlEntries(); }
        });
    }

    // Journal entries — type filter
    const journalTypeContainer = document.getElementById('journalTypeFilterContainer');
    if (journalTypeContainer) {
        journalTypeFilterDropdown = new SearchableDropdown(journalTypeContainer, {
            id: 'journalTypeFilter',
            options: journalOpts,
            placeholder: 'Filter by Type',
            compact: true,
            onChange: () => { journalPage = 1; loadJournalEntries(); }
        });
    }
}
