// PaymentPlans — Mailboxes tab stub.
// Mailboxes are platform-wide (one tenant has one set across all services).
// CRM owns the rich UI for IMAP/SMTP/OAuth setup, so we link there.
(function () {
    'use strict';

    window.loadPPMailboxesTab = function (container) {
        if (!container) container = document.getElementById('tab-mailboxes');
        if (container.dataset.rendered === '1') return;
        container.dataset.rendered = '1';
        container.innerHTML = `
            <details class="pp-helper" open>
                <summary>What is this?</summary>
                <p>Mailboxes (Gmail / Outlook / IMAP) are configured once per tenant and shared
                    across every service that sends email — CRM, PaymentPlans, HRMS, Vision recordings.</p>
            </details>
            <div class="pp-section">
                <div class="pp-empty">
                    <h3>Mailboxes are configured in CRM Settings</h3>
                    <p>Mailboxes you set up there are automatically available for PaymentPlans reminders.
                        Once you've connected at least one mailbox, the channel selector under
                        <b>Reminder Templates</b> will work.</p>
                    <a class="btn btn-primary" href="../crm/settings.html#mailboxes">Open CRM Settings → Mailboxes</a>
                </div>
            </div>`;
    };

    window.loadPPEmailTemplatesTab = function (container) {
        if (!container) container = document.getElementById('tab-email-templates');
        if (container.dataset.rendered === '1') return;
        container.dataset.rendered = '1';
        container.innerHTML = `
            <details class="pp-helper" open>
                <summary>What is this?</summary>
                <p>Email templates are tenant-wide content libraries. CRM owns the rich editor with
                    placeholder preview, attachments, and shared-mailbox attachment lists. PaymentPlans
                    consumes those same templates via the <b>Reminder Templates</b> mapping tab.</p>
            </details>
            <div class="pp-section">
                <div class="pp-empty">
                    <h3>Email templates are managed in CRM Settings</h3>
                    <p>Templates you create there are automatically available to PaymentPlans for installment
                        reminders, overdue notices, and escalations. Map a template to a reminder event under
                        the <b>Reminder Templates</b> tab.</p>
                    <a class="btn btn-primary" href="../crm/settings.html#templates">Open CRM Settings → Email Templates</a>
                </div>
            </div>`;
    };
})();
