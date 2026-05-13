// PaymentPlans — Aging Dashboard tab
(function () {
    'use strict';

    window.loadAgingTab = async function (container) {
        if (!container) container = document.getElementById('tab-aging');
        if (container.dataset.rendered === '1') { await refresh(container); return; }
        container.dataset.rendered = '1';
        container.innerHTML = `
            <details class="pp-helper" open>
                <summary>What is this?</summary>
                <p>Aging shows you all unpaid installments bucketed by how late they are.
                    Use this to focus collections effort on the most overdue cases.</p>
            </details>
            <div id="ppAgKPIs" class="pp-kpi-grid"></div>
            <div class="pp-section">
                <div class="pp-section-header">
                    <h2 class="pp-section-title">Aging buckets</h2>
                    <button class="btn btn-link" id="ppAgRefresh">↻ Refresh</button>
                </div>
                <div id="ppAgBody"></div>
            </div>`;
        container.querySelector('#ppAgRefresh').addEventListener('click', () => refresh(container));
        await refresh(container);
    };

    async function refresh(container) {
        const body = container.querySelector('#ppAgBody');
        const kpis = container.querySelector('#ppAgKPIs');
        body.innerHTML = '<div class="pp-skeleton pp-skel-row"></div>';
        kpis.innerHTML = '';
        try {
            const resp = await api.request(`/payment-plans/aging?tenantId=${window.PP.tenantId}&limit=500`);
            const items = resp.data || [];
            const today = new Date(); today.setHours(0,0,0,0);
            const buckets = { current: [], b30: [], b60: [], b90: [], b90p: [] };
            let totalOutstanding = 0;
            items.forEach(i => {
                const due = new Date(i.due_date);
                const lateDays = Math.floor((today - due) / (1000 * 60 * 60 * 24));
                const balance = (i.amount_due || 0) - (i.amount_paid || 0);
                totalOutstanding += balance;
                if (lateDays <= 0)      buckets.current.push({ ...i, lateDays, balance });
                else if (lateDays <= 30) buckets.b30.push({ ...i, lateDays, balance });
                else if (lateDays <= 60) buckets.b60.push({ ...i, lateDays, balance });
                else if (lateDays <= 90) buckets.b90.push({ ...i, lateDays, balance });
                else                     buckets.b90p.push({ ...i, lateDays, balance });
            });
            const sum = (arr) => arr.reduce((s, x) => s + x.balance, 0);
            const cur = (window.PP.config?.default_currency) || 'INR';
            kpis.innerHTML = `
                ${kpi('Total outstanding', fmt(totalOutstanding, cur), `${items.length} installments`)}
                ${kpi('Current (not yet due)', fmt(sum(buckets.current), cur), `${buckets.current.length} installments`)}
                ${kpi('1–30 days', fmt(sum(buckets.b30), cur), `${buckets.b30.length} installments`)}
                ${kpi('31–60 days', fmt(sum(buckets.b60), cur), `${buckets.b60.length} installments`)}
                ${kpi('61–90 days', fmt(sum(buckets.b90), cur), `${buckets.b90.length} installments`)}
                ${kpi('90+ days', fmt(sum(buckets.b90p), cur), `${buckets.b90p.length} installments`, '#ef4444')}`;
            const all = items.map(i => ({
                ...i,
                lateDays: Math.floor((today - new Date(i.due_date)) / (1000 * 60 * 60 * 24)),
                balance: (i.amount_due || 0) - (i.amount_paid || 0)
            })).filter(i => i.balance > 0).sort((a, b) => b.lateDays - a.lateDays);
            if (!all.length) { body.innerHTML = `<div class="pp-empty"><h3>Nothing outstanding 🎉</h3></div>`; return; }
            body.innerHTML = `
                <table class="table-cards-table">
                    <thead><tr><th>Due date</th><th>Late (days)</th><th>Bucket</th><th>Status</th><th>Balance</th></tr></thead>
                    <tbody>
                    ${all.slice(0, 200).map(i => `
                        <tr>
                            <td>${(i.due_date || '').slice(0,10)}</td>
                            <td>${i.lateDays > 0 ? i.lateDays : '—'}</td>
                            <td>${bucketLabel(i.lateDays)}</td>
                            <td><span class="pp-status">${escapeHtml(i.status)}</span></td>
                            <td>${fmt(i.balance, cur)}</td>
                        </tr>`).join('')}
                    </tbody></table>
                ${all.length > 200 ? `<p style="text-align:center;color:var(--text-secondary);margin-top:8px;">Showing 200 of ${all.length}</p>` : ''}`;
        } catch (e) {
            body.innerHTML = `<div class="pp-error">Failed: ${escapeHtml(e.message)}</div>`;
        }
    }

    function kpi(label, value, foot, accent) {
        const style = accent ? `color:${accent};` : '';
        return `<div class="pp-kpi-card">
            <div class="pp-kpi-label">${escapeHtml(label)}</div>
            <div class="pp-kpi-value" style="${style}">${escapeHtml(value)}</div>
            <div class="pp-kpi-foot">${escapeHtml(foot)}</div>
        </div>`;
    }
    function bucketLabel(d) {
        if (d <= 0) return 'Current';
        if (d <= 30) return '1–30 days';
        if (d <= 60) return '31–60 days';
        if (d <= 90) return '61–90 days';
        return '90+ days';
    }
    function fmt(amt, cur) { const sym = { INR: '₹', USD: '$', EUR: '€', GBP: '£' }[cur] || cur + ' '; return sym + Number(amt || 0).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2}); }
    function escapeHtml(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])); }
})();
