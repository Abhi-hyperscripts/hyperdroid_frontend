/**
 * Accounts hero wave — the suite's signature data-wave as a header backdrop
 * for selected Accounts pages (Lead Desk pattern). Self-contained add-on:
 * include this script and set <body data-hero-wave="receivables|banking">.
 * Fetches its own data, hides itself when the window has nothing to show.
 * No coupling to the page's own JS.
 */
(function () {
    'use strict';

    const MODES = {
        // Invoiced value per day (brand line) with the slice that is NOW
        // overdue re-plotted in red — collections pressure at a glance.
        receivables: async () => {
            const res = await api.request(
                AccountsCommon.buildUrl('invoices', { limit: 1000, offset: 0 }),
                { _skipSpinner: true });
            const rows = res.items || res.data || res || [];
            const today = startOfDay(new Date());
            const series = [
                { color: 'var(--brand-primary)', fill: true, values: {} },
                { color: 'var(--color-error, #ef4444)', fill: false, values: {} }
            ];
            rows.forEach(r => {
                const d = startOfDay(new Date(r.invoice_date || r.created_at));
                if (isNaN(d)) return;
                const k = d.getTime();
                const total = parseFloat(r.total_amount) || 0;
                series[0].values[k] = (series[0].values[k] || 0) + total;
                const overdue = String(r.status || '').toLowerCase() === 'overdue' ||
                    ((parseFloat(r.balance_due) || 0) > 0 && new Date(r.due_date) < today);
                if (overdue) series[1].values[k] = (series[1].values[k] || 0) + (parseFloat(r.balance_due) || 0);
            });
            return { series, caption: 'Invoiced/day · red = now overdue' };
        },

        // Net cash movement per day across the default bank account.
        // Transactions only exist once statements are imported — the wave
        // stays hidden until then.
        banking: async () => {
            const dash = await api.request(AccountsCommon.buildUrl('bank/dashboard'), { _skipSpinner: true });
            const first = (dash.accounts || [])[0];
            if (!first) return null;
            const tx = await api.request(
                AccountsCommon.buildUrl(`bank/accounts/${first.id}/transactions`, { limit: 1000 }),
                { _skipSpinner: true }).catch(() => []);
            const rows = tx.items || tx.data || tx || [];
            const series = [{ color: 'var(--brand-primary)', fill: true, values: {} }];
            rows.forEach(r => {
                const d = startOfDay(new Date(r.transaction_date || r.txn_date || r.date || r.created_at));
                if (isNaN(d)) return;
                const k = d.getTime();
                const amt = Math.abs(parseFloat(r.amount) || 0);
                series[0].values[k] = (series[0].values[k] || 0) + amt;
            });
            return { series, caption: 'Cash movement/day · ' + escapeText(first.account_name || 'bank') };
        }
    };

    function startOfDay(d) { d.setHours(0, 0, 0, 0); return d; }
    function escapeText(s) { return String(s).replace(/[<>&"]/g, ''); }

    function smoothPath(buckets, x, y) {
        const pts = buckets.map((v, i) => [x(i), y(v)]);
        const n = pts.length;
        const dx = [], m = [];
        for (let i = 0; i < n - 1; i++) { dx.push(pts[i + 1][0] - pts[i][0]); m.push((pts[i + 1][1] - pts[i][1]) / dx[i]); }
        const t = [m[0]];
        for (let i = 1; i < n - 1; i++) t.push((m[i - 1] * m[i] <= 0) ? 0 : (m[i - 1] + m[i]) / 2);
        t.push(m[n - 2]);
        for (let i = 0; i < n - 1; i++) {
            if (m[i] === 0) { t[i] = 0; t[i + 1] = 0; }
            else {
                const a = t[i] / m[i], b = t[i + 1] / m[i];
                const s = a * a + b * b;
                if (s > 9) { const tau = 3 / Math.sqrt(s); t[i] = tau * a * m[i]; t[i + 1] = tau * b * m[i]; }
            }
        }
        let d = 'M' + pts[0][0].toFixed(1) + ',' + pts[0][1].toFixed(1);
        for (let i = 0; i < n - 1; i++) {
            const h = dx[i];
            d += ' C' + (pts[i][0] + h / 3).toFixed(1) + ',' + (pts[i][1] + t[i] * h / 3).toFixed(1) +
                 ' ' + (pts[i + 1][0] - h / 3).toFixed(1) + ',' + (pts[i + 1][1] - t[i + 1] * h / 3).toFixed(1) +
                 ' ' + pts[i + 1][0].toFixed(1) + ',' + pts[i + 1][1].toFixed(1);
        }
        return d;
    }

    async function render() {
        const mode = document.body && document.body.dataset.heroWave;
        const build = MODES[mode];
        const header = document.querySelector('.hrms-header');
        if (!build || !header) return;
        if (typeof api === 'undefined' || typeof AccountsCommon === 'undefined') return;

        let data;
        try { data = await build(); } catch (_) { return; }
        if (!data || !data.series || !data.series.length) return;

        const today = startOfDay(new Date());
        const dayKey = off => { const d = new Date(today); d.setDate(today.getDate() - off); return d.getTime(); };
        const countIn = days => data.series.some(s => {
            for (let i = 0; i < days; i++) if (s.values[dayKey(i)]) return true;
            return false;
        });
        const DAYS = countIn(30) ? 30 : (countIn(90) ? 90 : 0);
        if (!DAYS) return;

        const W = 1200, H = 96, padT = 50, padB = 6;
        const ih = H - padT - padB;
        const start = new Date(today); start.setDate(today.getDate() - (DAYS - 1));
        const bands = data.series.map(s => {
            const buckets = new Array(DAYS).fill(0);
            for (let i = 0; i < DAYS; i++) {
                const d = new Date(start); d.setDate(start.getDate() + i);
                buckets[i] = s.values[d.getTime()] || 0;
            }
            return { ...s, buckets };
        }).filter(b => b.buckets.some(v => v > 0) || b.fill);
        if (!bands.length || bands.every(b => b.buckets.every(v => v === 0))) return;

        const yMax = Math.max(...bands.flatMap(b => b.buckets)) * 1.15 || 1;
        const x = i => (i / (DAYS - 1)) * W;
        const y = v => padT + ih - (v / yMax) * ih;

        const paths = bands.map(b => {
            const nonzero = b.buckets.reduce((n, v) => n + (v > 0 ? 1 : 0), 0);
            // A sparse accent series (one or two active days) would draw as a
            // flat baseline-hugging line — render dots at the active days
            // instead so it reads as markers, not an underline.
            if (!b.fill && nonzero <= 2) {
                return b.buckets.map((v, i) => v > 0
                    ? `<circle cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="3.5" fill="${b.color}"/>`
                    : '').join('');
            }
            const line = smoothPath(b.buckets, x, y);
            const fill = b.fill
                ? `<path d="${line} L${W},${H} L0,${H} Z" fill="url(#askWaveFill)" stroke="none"/>`
                : '';
            return fill + `<path d="${line}" fill="none" stroke="${b.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" opacity="0.9"/>`;
        }).join('');

        const band = document.createElement('div');
        band.className = 'ask-wavebg';
        band.setAttribute('aria-hidden', 'true');
        band.innerHTML =
            `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">` +
            `<defs><linearGradient id="askWaveFill" x1="0" y1="0" x2="0" y2="1">` +
            `<stop offset="0" stop-color="var(--brand-primary)" stop-opacity="0.2"/>` +
            `<stop offset="1" stop-color="var(--brand-primary)" stop-opacity="0"/>` +
            `</linearGradient></defs>` + paths + `</svg>` +
            `<span class="ask-wavecap">${escapeText(data.caption)} · ${DAYS}d</span>`;
        header.appendChild(band);
        header.classList.add('has-wave');
    }

    document.addEventListener('DOMContentLoaded', () => { render(); });
})();
