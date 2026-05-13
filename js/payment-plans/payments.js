// PaymentPlans — Record Payment tab
(function () {
    'use strict';

    window.loadPaymentsTab = async function (container) {
        if (!container) container = document.getElementById('tab-payments');
        if (container.dataset.rendered === '1') return;
        container.dataset.rendered = '1';
        container.innerHTML = `
            <details class="pp-helper" open>
                <summary>What is this?</summary>
                <p>Pick a ${window.PP.payerLabel.toLowerCase()}, choose an installment, enter the amount.
                    The system automatically updates the plan total, flips the installment status,
                    and cancels the pending reminder.</p>
            </details>
            <div class="pp-section">
                <h2 class="pp-section-title">Record Payment</h2>
                <form id="ppPayForm">
                    <div class="pp-form-row"><label>${window.PP.payerLabel}</label><div><select name="payer_id" id="ppPayPayer"><option value="">— Pick —</option></select></div></div>
                    <div class="pp-form-row" id="ppPayPlanRow" style="display:none"><label>${window.PP.planLabel}</label><div><select name="plan_id" id="ppPayPlan"></select></div></div>
                    <div class="pp-form-row" id="ppPayInstRow" style="display:none"><label>${window.PP.installmentLabel}</label><div><select name="installment_id" id="ppPayInst"></select></div></div>
                    <div class="pp-form-row"><label>Amount</label><div><input type="number" step="0.01" min="0.01" name="amount" required></div></div>
                    <div class="pp-form-row"><label>Received date</label><div><input type="date" name="received_date" value="${new Date().toISOString().slice(0,10)}"></div></div>
                    <div class="pp-form-row"><label>Source</label>
                        <div><select name="source">
                            <option value="manual">Manual</option><option value="razorpay">Razorpay</option>
                            <option value="cashfree">Cashfree</option><option value="upi">UPI</option>
                            <option value="neft">NEFT</option><option value="cheque">Cheque</option>
                            <option value="cash">Cash</option><option value="other">Other</option>
                        </select></div></div>
                    <div class="pp-form-row"><label>Reference</label><div><input name="reference" placeholder="Txn ID or cheque number"></div></div>
                    <div class="pp-form-row"><label>Notes</label><div><textarea name="notes" rows="2"></textarea></div></div>
                </form>
                <div class="pp-btn-group" style="margin-top:8px;"><button class="btn btn-primary" id="ppPaySubmit">Record Payment</button></div>
            </div>
            <div class="pp-section">
                <h2 class="pp-section-title">Recent payments</h2>
                <div id="ppPayHistory"></div>
            </div>`;
        const payers = await api.request(`/payment-plans/payers?tenantId=${window.PP.tenantId}&limit=500`);
        const sel = container.querySelector('#ppPayPayer');
        payers.forEach(p => sel.insertAdjacentHTML('beforeend', `<option value="${p.id}">${escapeHtml(p.display_name)}</option>`));
        sel.addEventListener('change', () => onPayerChange(container));
        container.querySelector('#ppPayPlan').addEventListener('change', () => onPlanChange(container));
        container.querySelector('#ppPaySubmit').addEventListener('click', () => submitPayment(container));
        loadHistory(container);
    };

    async function onPayerChange(container) {
        const payerId = container.querySelector('#ppPayPayer').value;
        const planRow = container.querySelector('#ppPayPlanRow');
        const instRow = container.querySelector('#ppPayInstRow');
        const planSel = container.querySelector('#ppPayPlan');
        if (!payerId) { planRow.style.display = 'none'; instRow.style.display = 'none'; return; }
        const plans = await api.request(`/payment-plans/plans?tenantId=${window.PP.tenantId}&payerId=${payerId}&limit=50`);
        planSel.innerHTML = `<option value="">— Pick —</option>` + plans.map(p => `<option value="${p.id}">${escapeHtml(p.name)} (${p.currency} ${p.total_amount})</option>`).join('');
        planRow.style.display = '';
        instRow.style.display = 'none';
    }

    async function onPlanChange(container) {
        const planId = container.querySelector('#ppPayPlan').value;
        const instRow = container.querySelector('#ppPayInstRow');
        const instSel = container.querySelector('#ppPayInst');
        if (!planId) { instRow.style.display = 'none'; return; }
        const plan = await api.request(`/payment-plans/plans/${planId}?tenantId=${window.PP.tenantId}`);
        const open = (plan.installments || []).filter(i => i.status !== 'paid' && i.status !== 'cancelled' && i.status !== 'waived');
        instSel.innerHTML = `<option value="">— Whole plan —</option>` + open.map(i => `<option value="${i.id}" data-amount="${(i.amount_due - i.amount_paid)}">#${i.sequence_no} — due ${(i.due_date||'').slice(0,10)} (${plan.currency} ${(i.amount_due - i.amount_paid).toFixed(2)})</option>`).join('');
        instSel.addEventListener('change', () => {
            const opt = instSel.options[instSel.selectedIndex];
            const amt = opt?.dataset?.amount;
            if (amt) container.querySelector('input[name="amount"]').value = parseFloat(amt).toFixed(2);
        });
        instRow.style.display = '';
    }

    async function submitPayment(container) {
        const f = container.querySelector('#ppPayForm');
        const body = {
            tenant_id: window.PP.tenantId,
            plan_id: f.elements['plan_id']?.value || null,
            installment_id: f.elements['installment_id']?.value || null,
            amount: parseFloat(f.elements['amount'].value),
            received_date: f.elements['received_date'].value || null,
            source: f.elements['source'].value,
            reference: f.elements['reference'].value || null,
            notes: f.elements['notes'].value || null
        };
        if (!body.amount || body.amount <= 0) { toast.error?.('Amount must be > 0'); return; }
        if (!body.plan_id && !body.installment_id) { toast.error?.('Pick a plan or installment'); return; }
        try {
            await api.request('/payment-plans/payments', { method: 'POST', body: JSON.stringify(body) });
            toast.success?.('Payment recorded');
            f.reset();
            f.elements['received_date'].value = new Date().toISOString().slice(0,10);
            container.querySelector('#ppPayPlanRow').style.display = 'none';
            container.querySelector('#ppPayInstRow').style.display = 'none';
            loadHistory(container);
        } catch (e) { toast.error?.(parseError(e)); }
    }

    async function loadHistory(container) {
        const h = container.querySelector('#ppPayHistory');
        h.innerHTML = '<div class="pp-skeleton pp-skel-row"></div>';
        try {
            // We piggyback on aging endpoint for "recently changed installments" — payments themselves
            // need a dedicated list endpoint. For now we render the most-recently-paid installments.
            const plans = await api.request(`/payment-plans/plans?tenantId=${window.PP.tenantId}&limit=20`);
            if (!plans.length) { h.innerHTML = `<div class="pp-empty"><p>No payment activity yet.</p></div>`; return; }
            h.innerHTML = `<p style="color:var(--text-secondary);font-size:13px;">Latest plans (most recently updated):</p>
                <table class="table-cards-table"><thead><tr><th>Plan</th><th>Total</th><th>Paid</th><th>Status</th></tr></thead><tbody>
                ${plans.map(p => `<tr><td>${escapeHtml(p.name)}</td><td>${fmt(p.total_amount, p.currency)}</td><td>${fmt(p.paid_amount, p.currency)}</td><td><span class="pp-status">${escapeHtml(p.status)}</span></td></tr>`).join('')}
                </tbody></table>`;
        } catch (e) { h.innerHTML = `<div class="pp-error">${escapeHtml(e.message)}</div>`; }
    }

    function fmt(amt, cur) { const sym = { INR: '₹', USD: '$', EUR: '€', GBP: '£' }[cur] || cur + ' '; return sym + Number(amt || 0).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2}); }
    function parseError(e) { try { const b = e.responseBody && JSON.parse(e.responseBody); return b?.errors?.join('; ') || b?.error || e.message; } catch(_) { return e.message; } }
    function escapeHtml(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])); }
})();
