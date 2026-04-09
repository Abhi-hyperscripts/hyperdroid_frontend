/**
 * Accounts Dashboard — Main entry point
 *
 * Loads financial summary stats, bank accounts, recent GL entries,
 * and pending approvals count.
 */

document.addEventListener('DOMContentLoaded', async function () {
    if (!await AccountsCommon.initPage('accounts', '../')) return;
    await loadDashboard();
});

// ============================================================================
// Dashboard Orchestrator
// ============================================================================

async function loadDashboard() {
    try {
        await Promise.all([
            loadGLSummary(),
            loadBankingSummary(),
            loadRecentEntries(),
            loadPendingApprovals()
        ]);
    } catch (err) {
        console.error('[Accounts:Dashboard] loadDashboard error:', err);
    }
}

function refreshDashboard() {
    const btn = document.getElementById('refreshBtn');
    if (btn) btn.classList.add('spinning');
    loadDashboard().finally(() => {
        if (btn) btn.classList.remove('spinning');
    });
}

// ============================================================================
// GL Summary (Stats Cards)
// ============================================================================

async function loadGLSummary() {
    try {
        const url = AccountsCommon.buildUrl('system/gl-summary');
        const data = await api.request(url, { _skipSpinner: true });

        const rows = data.by_type_and_status || [];
        const totalEntries = data.total_entries ?? rows.reduce((s, r) => s + (r.entry_count || 0), 0);
        const postedEntries = data.posted_entries ?? rows.filter(r => r.status === 'posted').reduce((s, r) => s + (r.entry_count || 0), 0);
        const draftEntries = rows.filter(r => r.status === 'draft').reduce((s, r) => s + (r.entry_count || 0), 0);
        const totalDebit = rows.reduce((s, r) => s + (parseFloat(r.total_debit) || 0), 0);
        const totalCredit = rows.reduce((s, r) => s + (parseFloat(r.total_credit) || 0), 0);
        const postedDebit = rows.filter(r => r.status === 'posted').reduce((s, r) => s + (parseFloat(r.total_debit) || 0), 0);
        const postedCredit = rows.filter(r => r.status === 'posted').reduce((s, r) => s + (parseFloat(r.total_credit) || 0), 0);

        setText('totalEntries', totalEntries);
        setText('postedEntries', postedEntries);
        setText('draftEntries', draftEntries);
        setCurrency('totalDebit', postedDebit);
        setCurrency('totalCredit', postedCredit);
        setCurrency('netBalance', postedDebit - postedCredit);
    } catch (err) {
        console.error('[Accounts:Dashboard] loadGLSummary error:', err);
        ['totalEntries', 'postedEntries', 'draftEntries', 'totalDebit', 'totalCredit', 'netBalance']
            .forEach(id => setText(id, '-'));
    }
}

// ============================================================================
// Banking Summary
// ============================================================================

async function loadBankingSummary() {
    const grid = document.getElementById('bankAccountsGrid');
    if (!grid) return;

    try {
        const url = AccountsCommon.buildUrl('bank/accounts');
        const res = await api.request(url, { _skipSpinner: true });
        const accounts = Array.isArray(res) ? res : (res?.data || res?.items || []);

        if (!accounts.length) {
            grid.innerHTML = '<div class="empty-state"><p>No bank accounts configured</p></div>';
            return;
        }

        grid.innerHTML = accounts.map(acc => {
            const name = AccountsCommon.escapeHtml(acc.account_name || acc.accountName || 'Unnamed');
            const bank = AccountsCommon.escapeHtml(acc.bank_name || acc.bankName || '');
            const balance = AccountsCommon.formatCurrency(acc.balance ?? acc.current_balance ?? 0);
            const isNeg = (acc.balance ?? acc.current_balance ?? 0) < 0;
            return `
                <div class="bank-account-card glass-card">
                    <div class="bank-card-header">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20">
                            <line x1="3" y1="22" x2="21" y2="22"/>
                            <line x1="6" y1="18" x2="6" y2="11"/>
                            <line x1="10" y1="18" x2="10" y2="11"/>
                            <line x1="14" y1="18" x2="14" y2="11"/>
                            <line x1="18" y1="18" x2="18" y2="11"/>
                            <polygon points="12 2 2 8 22 8"/>
                        </svg>
                        <span class="bank-card-name">${name}</span>
                    </div>
                    ${bank ? `<div class="bank-card-bank">${bank}</div>` : ''}
                    <div class="bank-card-balance ${isNeg ? 'negative' : ''}">${balance}</div>
                </div>`;
        }).join('');
    } catch (err) {
        console.error('[Accounts:Dashboard] loadBankingSummary error:', err);
        grid.innerHTML = '<div class="empty-state"><p>Failed to load bank accounts</p></div>';
    }
}

// ============================================================================
// Recent GL Entries
// ============================================================================

async function loadRecentEntries() {
    const tbody = document.getElementById('recentEntriesBody');
    if (!tbody) return;

    try {
        const url = AccountsCommon.buildUrl('gl', { limit: 10, offset: 0 });
        const res = await api.request(url, { _skipSpinner: true });
        const entries = Array.isArray(res) ? res : (res?.data || res?.items || []);

        if (!entries.length) {
            tbody.innerHTML = '<tr><td colspan="4" class="text-center">No entries yet</td></tr>';
            return;
        }

        tbody.innerHTML = entries.map(e => {
            const date = AccountsCommon.formatDate(e.entry_date || e.entryDate || e.date);
            const desc = AccountsCommon.escapeHtml(e.description || e.memo || '-');
            const debit = e.total_debit ?? e.debit_amount ?? e.debitAmount ?? 0;
            const credit = e.total_credit ?? e.credit_amount ?? e.creditAmount ?? 0;
            return `<tr>
                <td>${date}</td>
                <td class="desc-cell">${desc}</td>
                <td class="text-right">${debit ? AccountsCommon.formatCurrency(debit) : '-'}</td>
                <td class="text-right">${credit ? AccountsCommon.formatCurrency(credit) : '-'}</td>
            </tr>`;
        }).join('');
    } catch (err) {
        console.error('[Accounts:Dashboard] loadRecentEntries error:', err);
        tbody.innerHTML = '<tr><td colspan="4" class="text-center">Failed to load entries</td></tr>';
    }
}

// ============================================================================
// Pending Approvals
// ============================================================================

async function loadPendingApprovals() {
    const badge = document.getElementById('pendingApprovalsBadge');
    const desc = document.getElementById('pendingApprovalsDesc');

    try {
        const url = AccountsCommon.buildUrl('audit/approvals/pending');
        const res = await api.request(url, { _skipSpinner: true });
        // Backend returns { expense_claims: [...], total_pending }. Was reading res.total
        // (doesn't exist) → badge always showed 0. Fixed in Phase 4 Tier 1.
        const count = res?.total_pending
            ?? (Array.isArray(res?.expense_claims) ? res.expense_claims.length : 0);

        if (badge) {
            badge.textContent = count;
            badge.style.display = count > 0 ? 'inline-block' : 'none';
        }
        if (desc) {
            desc.textContent = count > 0
                ? `${count} item${count !== 1 ? 's' : ''} awaiting your approval`
                : 'Audit logs, approvals & year-end closing';
        }
    } catch (err) {
        console.error('[Accounts:Dashboard] loadPendingApprovals error:', err);
        if (badge) badge.textContent = '0';
        if (desc) desc.textContent = 'Unable to load approvals';
    }
}

// ============================================================================
// Helpers
// ============================================================================

function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
}

function setCurrency(id, amount) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = AccountsCommon.formatCurrency(amount ?? 0);
    if ((amount ?? 0) < 0) {
        el.classList.add('negative');
    } else {
        el.classList.remove('negative');
    }
}
