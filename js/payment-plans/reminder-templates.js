// PaymentPlans — Reminder Template Mapping tab.
// Maps (event, channel) → notification template.
(function () {
    'use strict';
    const EVENTS = [
        { k: 'pre_due',   l: 'Pre-due (before due date)' },
        { k: 'due_today', l: 'Due today' },
        { k: 'overdue',   l: 'Overdue (post-due)' },
        { k: 'escalation',l: 'Escalation' }
    ];
    const CHANNELS = ['email', 'whatsapp', 'sms'];

    window.loadReminderTemplatesTab = async function (container) {
        if (!container) container = document.getElementById('tab-reminder-templates');
        if (container.dataset.rendered === '1') { await refresh(container); return; }
        container.dataset.rendered = '1';
        container.innerHTML = `
            <details class="pp-helper" open>
                <summary>What is this?</summary>
                <p>This page tells PaymentPlans which notification template to use when a reminder fires.
                    Create your templates under <b>Email Templates</b> first, then map them here per event &amp; channel.</p>
            </details>
            <div class="pp-section">
                <div class="pp-section-header">
                    <div><h2 class="pp-section-title">Reminder Templates</h2></div>
                </div>
                <div id="ppRTMatrix"></div>
            </div>`;
        await refresh(container);
    };

    async function refresh(container) {
        const matrix = container.querySelector('#ppRTMatrix');
        matrix.innerHTML = '<div class="pp-skeleton pp-skel-row"></div>';
        try {
            const [templates, mappings] = await Promise.all([
                api.request(`/payment-plans/notification-templates?tenantId=${window.PP.tenantId}`),
                api.request(`/payment-plans/reminder-template-mapping?tenantId=${window.PP.tenantId}`)
            ]);
            const lookup = (event, channel) => mappings.find(m => m.event === event && m.channel === channel && (m.phase || '') === '');
            matrix.innerHTML = `
                <table class="table-cards-table">
                    <thead><tr><th>Event</th>${CHANNELS.map(c => `<th>${c[0].toUpperCase() + c.slice(1)}</th>`).join('')}</tr></thead>
                    <tbody>
                    ${EVENTS.map(e => `
                        <tr>
                            <td><b>${e.l}</b><br><code style="font-size:11px;color:var(--text-secondary)">${e.k}</code></td>
                            ${CHANNELS.map(ch => {
                                const m = lookup(e.k, ch);
                                const opts = templates.filter(t => t.channel === ch);
                                return `<td>
                                    <select class="pp-rt-sel form-control" data-event="${e.k}" data-channel="${ch}">
                                        <option value="">— Not mapped —</option>
                                        ${opts.map(t => `<option value="${t.id}" ${m && m.template_id === t.id ? 'selected' : ''}>${escapeHtml(t.name)}</option>`).join('')}
                                    </select>
                                </td>`;
                            }).join('')}
                        </tr>`).join('')}
                    </tbody></table>`;
            matrix.querySelectorAll('.pp-rt-sel').forEach(sel => {
                sel.addEventListener('change', async () => {
                    const event = sel.dataset.event;
                    const channel = sel.dataset.channel;
                    const tplId = sel.value;
                    try {
                        if (!tplId) {
                            const existing = mappings.find(m => m.event === event && m.channel === channel && (m.phase || '') === '');
                            if (existing) {
                                await api.request(`/payment-plans/reminder-template-mapping/${existing.id}?tenantId=${window.PP.tenantId}`, { method: 'DELETE' });
                            }
                            toast.success?.('Unmapped');
                        } else {
                            await api.request('/payment-plans/reminder-template-mapping', {
                                method: 'PUT',
                                body: JSON.stringify({
                                    tenant_id: window.PP.tenantId, event, phase: '', channel,
                                    template_id: tplId, is_active: true
                                })
                            });
                            toast.success?.('Mapped');
                        }
                        refresh(container);
                    } catch (e) {
                        toast.error?.(parseError(e));
                        refresh(container);
                    }
                });
            });
        } catch (e) {
            matrix.innerHTML = `<div class="pp-error">Failed: ${escapeHtml(e.message)}</div>`;
        }
    }
    function parseError(e) { try { const b = e.responseBody && JSON.parse(e.responseBody); return b?.error || e.message; } catch(_) { return e.message; } }
    function escapeHtml(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])); }
})();
