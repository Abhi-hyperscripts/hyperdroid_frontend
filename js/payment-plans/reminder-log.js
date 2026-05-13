// PaymentPlans — Reminder Log tab.
// Shows the inbound reminder log (idempotency table) which records every
// reminder fire response (SENT / SKIPPED / ERROR). Useful for debugging
// reminder delivery.
(function () {
    'use strict';

    window.loadReminderLogTab = async function (container) {
        if (!container) container = document.getElementById('tab-reminder-log');
        if (container.dataset.rendered === '1') return;
        container.dataset.rendered = '1';
        container.innerHTML = `
            <details class="pp-helper" open>
                <summary>What is this?</summary>
                <p>Every reminder fire that ReminderService dispatches to PaymentPlans is recorded here.
                    <code>SENT</code> = NotificationService accepted the message.
                    <code>SKIPPED</code> = handler decided not to send (e.g., installment already paid).
                    <code>ERROR</code> = something went wrong; check the reason for retry guidance.</p>
            </details>
            <div class="pp-section">
                <div class="pp-section-header">
                    <div><h2 class="pp-section-title">Reminder activity</h2></div>
                    <div class="pp-toolbar-right">
                        <select id="ppRLStatus" class="form-control" style="min-width:140px;">
                            <option value="">All</option>
                            <option value="SENT">Sent</option>
                            <option value="SKIPPED">Skipped</option>
                            <option value="ERROR">Error</option>
                        </select>
                        <button class="btn btn-link" id="ppRLRefresh">↻ Refresh</button>
                    </div>
                </div>
                <div id="ppRLBody"></div>
            </div>`;
        container.querySelector('#ppRLRefresh').addEventListener('click', () => refresh(container));
        container.querySelector('#ppRLStatus').addEventListener('change', () => refresh(container));
        await refresh(container);
    };

    async function refresh(container) {
        const body = container.querySelector('#ppRLBody');
        body.innerHTML = '<div class="pp-skeleton pp-skel-row"></div>';
        // No dedicated GET endpoint exists yet — read the table directly
        // through the audit_log + reminder_inbound_log union via a forthcoming
        // endpoint. For now we render an instructional placeholder that
        // links to the Aging dashboard and tells the user where the data lives.
        body.innerHTML = `
            <div class="pp-empty">
                <h3>Reminder log endpoint coming soon</h3>
                <p>Once <code>GET /api/payment-plans/reminder-log</code> ships, this tab will show every fire event with its outcome.
                    Until then, see <b>Aging Dashboard</b> for the live state and the backend logs for delivery diagnostics.</p>
            </div>`;
    }
})();
