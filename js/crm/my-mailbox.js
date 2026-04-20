// ─────────────────────────────────────────────────────────────────────────
// CRM / My Mailbox page
//
// Self-serve mailbox connect for every authenticated user (CRM_USER and up).
// Shares the connect-wizard + render logic with js/crm/mailboxes.js — this
// file is just the page-level init and a couple of tweaks to the shared
// UI that only make sense in the per-user view:
//
//   - Forces shareWithTenant = false (personal page never creates shared
//     mailboxes; admins do that from Settings → Mailboxes).
//   - Suppresses the "Disconnect" button on tenant-shared rows so the user
//     can't accidentally nuke the team's shared inbox. (The DELETE API
//     doesn't currently enforce ownership — that's a separate server-side
//     hardening task, tracked with the rest of mailbox CRUD auth.)
// ─────────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
    if (!api.isAuthenticated()) {
        window.location.href = '/index.html';
        return;
    }

    Navigation.init('crm', '../');

    // Make sure the share-with-tenant checkbox (kept in DOM for wizard JS
    // compatibility) can't leak shared scope into user-created mailboxes.
    const shareRow = document.getElementById('connectShareWithTenantRow');
    if (shareRow) shareRow.style.display = 'none';
    const shareCheckbox = document.getElementById('connectShareWithTenant');
    if (shareCheckbox) shareCheckbox.checked = false;

    // Drive the UI off the shared wizard. loadMailboxesTab renders into
    // #mailboxesTableBody / #mailboxesEmpty which we've already placed on
    // this page. It also tries to render #oauthAppsTableBody but returns
    // early when that element is absent — so admin-only chrome stays gone.
    if (typeof window.loadMailboxesTab === 'function') {
        await window.loadMailboxesTab();
    }

    // After mailboxes.js renders rows, walk them and drop the Disconnect
    // button on tenant-shared entries (rows whose Scope cell says
    // "Tenant-shared"). This is a render-hook; we re-run it whenever the
    // table's tbody mutates (e.g., after a successful connect).
    hardenDisconnectButtons();
    const tbody = document.getElementById('mailboxesTableBody');
    if (tbody) {
        const obs = new MutationObserver(hardenDisconnectButtons);
        obs.observe(tbody, { childList: true, subtree: true });
    }
});

function hardenDisconnectButtons() {
    const rows = document.querySelectorAll('#mailboxesTableBody tr');
    rows.forEach(row => {
        const cells = row.querySelectorAll('td');
        // Scope cell is the 3rd (0-indexed 2); "Tenant-shared" marks admin-
        // owned rows the user must not be able to disconnect here.
        if (cells.length >= 3 && /Tenant-shared/i.test(cells[2].textContent || '')) {
            const actionsCell = cells[cells.length - 1];
            const btn = actionsCell && actionsCell.querySelector('button');
            if (btn) {
                btn.replaceWith(Object.assign(document.createElement('span'), {
                    className: 'muted',
                    style: 'font-size:0.8rem; color:var(--text-secondary);',
                    textContent: 'managed by admin',
                }));
            }
        }
    });
}
