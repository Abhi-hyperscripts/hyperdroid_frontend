/**
 * The Pulse hero wave — a monotone-cubic sparkline behind a page title.
 * ----------------------------------------------------------------------------
 * ⭐ EXTRACTED RATHER THAN COPIED A FIFTH TIME.
 *
 * MEASURED, not guessed: `grep -rln 's2 > 9' js/` finds this builder, character
 * for character, in SIX other files —
 *
 *     js/crm/analytics.js   js/crm/contacts.js     js/crm/deals.js
 *     js/hrms/dashboard.js  js/pms/dashboard.js    js/vision/dashboard.js
 *
 * — and js/crm/leads.js plus js/crm/dashboard.js carry a DIFFERENT monotone
 * wave without the clamp. Pasting it once more would have made a seventh copy
 * of ~60 lines of curve maths, across three apps.
 *
 * Companies uses this. The six copies are untouched on purpose: they are live
 * pages in three different apps, and migrating them is a separate change with
 * its own verification. This is where they land when someone does that.
 *
 * The curve is monotone cubic (Fritsch–Carlson) rather than a plain bezier
 * because a naive spline OVERSHOOTS between points — on a count that can never
 * be negative, that draws a dip below zero on the way into a spike, which reads
 * as data the page does not have.
 */
const CrmHeroWave = (() => {
    'use strict';

    /**
     * @param {object}   opts
     * @param {string}   opts.bandId    element the svg is written into
     * @param {string}   opts.capId     element that gets the caption
     * @param {object[]} opts.rows      records to bucket
     * @param {string}   opts.dateField field holding the ISO timestamp
     * @param {string}   opts.caption   e.g. "New companies/day"
     */
    function render({ bandId, capId, rows, dateField = 'created_at', caption }) {
        const band = document.getElementById(bandId);
        const capEl = capId ? document.getElementById(capId) : null;
        if (!band) return;

        const hide = () => { band.hidden = true; if (capEl) capEl.textContent = ''; };

        const today = new Date(); today.setHours(0, 0, 0, 0);
        const countIn = (days) => {
            const from = new Date(today); from.setDate(today.getDate() - (days - 1));
            return rows.filter(r => r[dateField] && new Date(r[dateField]) >= from).length;
        };

        // 30 days if anything happened, else widen to 90 before giving up — a
        // page with one record a month should still show a line, not a blank.
        const DAYS = countIn(30) > 0 ? 30 : (countIn(90) > 0 ? 90 : 0);
        if (DAYS === 0) return hide();

        const start = new Date(today); start.setDate(today.getDate() - (DAYS - 1));
        const buckets = new Array(DAYS).fill(0);
        rows.forEach((r) => {
            if (!r[dateField]) return;
            const d = new Date(r[dateField]); d.setHours(0, 0, 0, 0);
            const idx = Math.round((d - start) / 86400000);
            if (idx >= 0 && idx < DAYS) buckets[idx]++;
        });
        if (buckets.every(v => v === 0)) return hide();

        // padT keeps the line in the LOWER half so the title above stays legible
        // over it — the wave is a backdrop, not a chart the reader studies.
        const W = 1200, H = 100, padT = 56, padB = 6;
        const ih = H - padT - padB;
        const yMax = Math.max(...buckets) * 1.15 || 1;
        const x = i => (i / (DAYS - 1)) * W;
        const y = v => padT + ih - (v / yMax) * ih;
        const pts = buckets.map((v, i) => [x(i), y(v)]);
        const n = pts.length;

        const dx = [], m = [];
        for (let i = 0; i < n - 1; i++) {
            dx.push(pts[i + 1][0] - pts[i][0]);
            m.push((pts[i + 1][1] - pts[i][1]) / dx[i]);
        }
        const t = [m[0]];
        for (let i = 1; i < n - 1; i++) t.push((m[i - 1] * m[i] <= 0) ? 0 : (m[i - 1] + m[i]) / 2);
        t.push(m[n - 2]);
        for (let i = 0; i < n - 1; i++) {
            if (m[i] === 0) { t[i] = 0; t[i + 1] = 0; }
            else {
                const a = t[i] / m[i], b = t[i + 1] / m[i];
                const s2 = a * a + b * b;
                if (s2 > 9) { const tau = 3 / Math.sqrt(s2); t[i] = tau * a * m[i]; t[i + 1] = tau * b * m[i]; }
            }
        }

        let d = 'M' + pts[0][0].toFixed(1) + ',' + pts[0][1].toFixed(1);
        for (let i = 0; i < n - 1; i++) {
            const h = dx[i];
            d += ' C' + (pts[i][0] + h / 3).toFixed(1) + ',' + (pts[i][1] + t[i] * h / 3).toFixed(1) +
                 ' ' + (pts[i + 1][0] - h / 3).toFixed(1) + ',' + (pts[i + 1][1] - t[i + 1] * h / 3).toFixed(1) +
                 ' ' + pts[i + 1][0].toFixed(1) + ',' + pts[i + 1][1].toFixed(1);
        }
        const area = d + ' L' + W + ',' + H + ' L0,' + H + ' Z';

        // The gradient id is scoped to the band so two waves on one page cannot
        // collide — a duplicated SVG id silently paints both from the first.
        const fillId = 'heroWaveFill-' + bandId;
        band.innerHTML =
            '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" aria-hidden="true">' +
            '<defs><linearGradient id="' + fillId + '" x1="0" y1="0" x2="0" y2="1">' +
            '<stop offset="0" stop-color="var(--brand-primary)" stop-opacity="0.22"/>' +
            '<stop offset="1" stop-color="var(--brand-primary)" stop-opacity="0"/>' +
            '</linearGradient></defs>' +
            '<path d="' + area + '" fill="url(#' + fillId + ')" stroke="none"/>' +
            '<path d="' + d + '" fill="none" stroke="var(--brand-primary)" stroke-width="2" ' +
            'stroke-linejoin="round" stroke-linecap="round" opacity="0.9"/>' +
            '</svg>';
        band.hidden = false;
        if (capEl) capEl.textContent = caption + ' · ' + DAYS + 'd';
    }

    return { render };
})();
