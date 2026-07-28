/**
 * Barcode SVG renderer — self-contained (no CDN), used by inventory label printing.
 *
 * Supports:
 *  - EAN-13  : 12/13-digit numeric codes (13th digit = checksum, computed when absent,
 *              validated when present). The format on virtually every Indian retail product.
 *  - Code128 : everything else (SKUs with letters/dashes). Code-set B with automatic
 *              code-set C compression for long digit runs; mod-103 checksum.
 *
 * API: BarcodeRender.svg(code, { height, moduleWidth, showText }) -> SVG string, or null
 *      if the code can't be encoded. BarcodeRender.normalizeEan(code) -> 13-digit string
 *      with checksum, or null if not EAN-shaped.
 */
(function () {
    'use strict';

    // ── EAN-13 tables ─────────────────────────────────────────────────────
    const L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
    const G = L.map(s => s.split('').reverse().map(b => b === '0' ? '1' : '0').join(''));
    const R = L.map(s => s.split('').map(b => b === '0' ? '1' : '0').join(''));
    const PARITY = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];

    function eanChecksum(d12) {
        let sum = 0;
        for (let i = 0; i < 12; i++) sum += (+d12[i]) * (i % 2 === 0 ? 1 : 3);
        return (10 - (sum % 10)) % 10;
    }

    function normalizeEan(code) {
        const c = (code || '').trim();
        if (!/^\d{12,13}$/.test(c)) return null;
        if (c.length === 12) return c + eanChecksum(c);
        return eanChecksum(c.slice(0, 12)) === +c[12] ? c : null;
    }

    function eanBits(ean13) {
        const parity = PARITY[+ean13[0]];
        let bits = '101';
        for (let i = 1; i <= 6; i++) bits += (parity[i - 1] === 'L' ? L : G)[+ean13[i]];
        bits += '01010';
        for (let i = 7; i <= 12; i++) bits += R[+ean13[i]];
        return bits + '101';
    }

    // ── Code128 tables (11-module patterns for values 0-106) ──────────────
    const C128 = ('212222 222122 222221 121223 121322 131222 122213 122312 132212 221213 221312 231212 112232 122132 122231 113222 ' +
        '123122 123221 223211 221132 221231 213212 223112 312131 311222 321122 321221 312212 322112 322211 212123 212321 ' +
        '232121 111323 131123 131321 112313 132113 132311 211313 231113 231311 112133 112331 132131 113123 113321 133121 ' +
        '313121 211331 231131 213113 213311 213131 311123 311321 331121 312113 312311 332111 314111 221411 431111 111224 ' +
        '111422 121124 121421 141122 141221 112214 112412 122114 122411 142112 142211 241211 221114 413111 241112 134111 ' +
        '111242 121142 121241 114212 124112 124211 411212 421112 421211 212141 214121 412121 111143 111341 131141 114113 ' +
        '114311 411113 411311 113141 114131 311141 411131 211412 211214 211232 233111 211133').split(' ');

    function c128Bits(values) {
        let bits = '';
        for (const v of values) {
            const widths = C128[v];
            for (let i = 0; i < widths.length; i++) bits += (i % 2 === 0 ? '1' : '0').repeat(+widths[i]);
        }
        return bits + '11'; // final bar of the stop pattern
    }

    function code128Values(text) {
        // ASCII 32-126 only (covers SKUs); reject anything else.
        for (const ch of text) { const c = ch.charCodeAt(0); if (c < 32 || c > 126) return null; }
        const values = [];
        let i = 0, mode = null; // 'B' | 'C'
        while (i < text.length) {
            // Switch to / stay in C for runs of 4+ digits (2 digits per symbol).
            const digitRun = (() => { let n = 0; while (i + n < text.length && /\d/.test(text[i + n])) n++; return n; })();
            if (digitRun >= 4 && digitRun % 2 === 0 || (digitRun >= 4 && mode === null && digitRun === text.length)) {
                const useLen = digitRun - (digitRun % 2);
                if (mode === null) values.push(105); // Start C
                else if (mode !== 'C') values.push(99); // Code C
                mode = 'C';
                for (let k = 0; k < useLen; k += 2) values.push(+text.slice(i + k, i + k + 2));
                i += useLen;
                continue;
            }
            if (mode === null) { values.push(104); mode = 'B'; } // Start B
            else if (mode !== 'B') { values.push(100); mode = 'B'; } // Code B
            values.push(text.charCodeAt(i) - 32);
            i++;
        }
        if (!values.length) return null;
        let sum = values[0];
        for (let k = 1; k < values.length; k++) sum += values[k] * k;
        values.push(sum % 103);
        values.push(106); // stop
        return values;
    }

    function bitsToSvg(bits, text, opts) {
        const mw = opts.moduleWidth || 2;
        const h = opts.height || 60;
        const quiet = 10 * mw;
        const textH = opts.showText === false ? 0 : 14;
        const w = bits.length * mw + quiet * 2;
        let rects = '';
        let run = 0;
        for (let i = 0; i <= bits.length; i++) {
            if (i < bits.length && bits[i] === '1') { run++; continue; }
            if (run > 0) rects += `<rect x="${quiet + (i - run) * mw}" y="0" width="${run * mw}" height="${h}"/>`;
            run = 0;
        }
        const label = opts.showText === false ? '' :
            `<text x="${w / 2}" y="${h + 12}" text-anchor="middle" font-family="monospace" font-size="11">${text.replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]))}</text>`;
        return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h + textH}" width="${w}" height="${h + textH}" style="max-width:100%;height:auto;"><g fill="#000">${rects}</g>${label}</svg>`;
    }

    function svg(code, opts) {
        opts = opts || {};
        const c = (code || '').trim();
        if (!c) return null;
        const ean = normalizeEan(c);
        if (ean) return bitsToSvg(eanBits(ean), ean, opts);
        const values = code128Values(c);
        if (!values) return null;
        return bitsToSvg(c128Bits(values), c, opts);
    }

    window.BarcodeRender = { svg, normalizeEan };
})();
