// Escapers must be quote-safe, because their output lands in HTML ATTRIBUTES.
//
// Every module in this frontend defines the same escaper:
//
//     const div = document.createElement('div');
//     div.textContent = text;
//     return div.innerHTML;
//
// Serialising a TEXT node to innerHTML escapes & < > and nothing else — quotes
// are only escaped when serialising an ATTRIBUTE value. So the helper was safe
// in text context and unsafe in the one place it was most often used: 381
// interpolations across 83 files sit inside a quoted attribute, e.g.
//
//     `<span data-tooltip="${esc(v)}">`
//     `<button onclick="doThing('${esc(phone)}')">`
//
// A value containing a double quote closes the attribute early and everything
// after it is parsed as MORE ATTRIBUTES. And the values are not ours: lead
// names and company names arrive from Facebook Lead Ad forms, WhatsApp display
// names arrive from Meta, and imported CSV rows arrive from anywhere. That is a
// stored-XSS path from an unauthenticated stranger into an authenticated rep's
// session.
//
// The fix appends quote escaping to every escaper. Over-escaping costs nothing
// in text context, where &quot; renders as a plain quote.

const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const JS_ROOT = path.join(__dirname, '..', '..', 'js');

function allJsFiles(dir) {
    const out = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === 'node_modules') continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) out.push(...allJsFiles(full));
        else if (entry.name.endsWith('.js')) out.push(full);
    }
    return out;
}

// The unsafe idiom: textContent in, innerHTML straight back out.
const UNSAFE = /(\w+)\.textContent\s*=\s*(\w+)\s*;\s*\r?\n\s*return\s+\1\.innerHTML\s*;/;

test.describe('escaper quote safety', () => {

    test('the scanner can see a planted offender', () => {
        // A scan that matches nothing passes for the same reason a clean
        // codebase does. Prove it discriminates before trusting the sweep.
        const offender = `
            function esc(t) {
                const d = document.createElement('div');
                d.textContent = t;
                return d.innerHTML;
            }`;
        const fixed = `
            function esc(t) {
                const d = document.createElement('div');
                d.textContent = t;
                return d.innerHTML.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
            }`;
        expect(UNSAFE.test(offender)).toBe(true);
        expect(UNSAFE.test(fixed)).toBe(false);
    });

    test('no escaper returns innerHTML without escaping quotes', () => {
        const files = allJsFiles(JS_ROOT);

        // Floor: the walk found the tree at all.
        expect(files.length).toBeGreaterThan(100);

        const offenders = files.filter(f => UNSAFE.test(fs.readFileSync(f, 'utf8')));
        expect(offenders.map(f => path.relative(JS_ROOT, f))).toEqual([]);
    });

    test('a quote payload cannot break out of an attribute', async ({ page }) => {
        // The behavioural half. The scan above pins the SHAPE; this pins what
        // the shape is for, in a real browser parser rather than by argument.
        const result = await page.evaluate(() => {
            const esc = (text) => {
                if (!text) return '';
                const div = document.createElement('div');
                div.textContent = text;
                return div.innerHTML.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
            };

            const payload = `" onmouseover="alert(1)" x="`;
            const host = document.createElement('div');
            host.innerHTML = `<span data-tooltip="${esc(payload)}">hi</span>`;
            const span = host.firstElementChild;

            return {
                attributes: span.getAttributeNames().sort(),
                injectedHandler: span.getAttribute('onmouseover'),
                // The value must survive intact for the user to read.
                tooltip: span.getAttribute('data-tooltip'),
                // …and the escaper must still do its original job.
                stillEscapesAngleBrackets: esc('<b>x</b>') === '&lt;b&gt;x&lt;/b&gt;',
            };
        });

        expect(result.attributes).toEqual(['data-tooltip']);
        expect(result.injectedHandler).toBeNull();
        expect(result.tooltip).toBe(`" onmouseover="alert(1)" x="`);
        expect(result.stillEscapesAngleBrackets).toBe(true);
    });

    test('the UNFIXED escaper really does break out — the defect was real', async ({ page }) => {
        // Red-proof for the test above. Without this, the assertions there
        // could pass against a payload that was never dangerous.
        const result = await page.evaluate(() => {
            const escOld = (text) => {
                if (!text) return '';
                const div = document.createElement('div');
                div.textContent = text;
                return div.innerHTML;             // the original
            };

            const payload = `" onmouseover="alert(1)" x="`;
            const host = document.createElement('div');
            host.innerHTML = `<span data-tooltip="${escOld(payload)}">hi</span>`;
            const span = host.firstElementChild;

            return {
                attributes: span.getAttributeNames().sort(),
                injectedHandler: span.getAttribute('onmouseover'),
            };
        });

        // An attribute the code never wrote, carrying script the attacker did.
        expect(result.attributes).toContain('onmouseover');
        expect(result.injectedHandler).toBe('alert(1)');
    });

    // ── The SECOND context, which HTML escaping cannot fix ──────────────
    //
    // `onclick="fn('${esc(v)}')"` puts the value inside a JS string inside an
    // HTML attribute. The parser decodes entities BEFORE the JS is parsed, so
    // &#39; turns back into a real quote and `');alert(1);//` still executes.
    // Measured in a browser — see the red-proof below.
    //
    // Those sites need escJsAttr: JS-escape first, then HTML-escape, so the
    // backslash survives as \&#39;, decodes to \' and reaches JS as an
    // escaped quote. It is also an ordinary bug fix: a lead called O'Brien
    // breaks these handlers outright with a syntax error.

    test('CRM inline handlers use the JS-string-safe escaper', () => {
        const files = allJsFiles(path.join(JS_ROOT, 'crm'));
        expect(files.length).toBeGreaterThan(20);

        // An escaped value inside a single-quoted JS string in an inline handler.
        const RAW_IN_HANDLER = /on\w+\s*=\s*"[^"]*'\$\{\s*(?:esc|escapeHtml)\s*\(/;

        // Red-proof the pattern before trusting the sweep.
        expect(RAW_IN_HANDLER.test(`<b onclick="f('\${esc(v)}')">`)).toBe(true);
        expect(RAW_IN_HANDLER.test(`<b onclick="f('\${escJsAttr(v)}')">`)).toBe(false);
        expect(RAW_IN_HANDLER.test(`<b data-x="\${esc(v)}">`)).toBe(false);

        const offenders = files.filter(f => RAW_IN_HANDLER.test(fs.readFileSync(f, 'utf8')));
        expect(offenders.map(f => path.relative(JS_ROOT, f))).toEqual([]);
    });

    test('every *JsAttr helper used is also defined in the same file', () => {
        // A source rewrite that swaps call sites but misses one helper insert
        // produces a ReferenceError the moment that page renders. This caught
        // exactly that in js/crm/settings.js.
        const files = allJsFiles(JS_ROOT);
        const missing = [];
        for (const f of files) {
            const src = fs.readFileSync(f, 'utf8');
            const used = new Set([...src.matchAll(/\b(\w+JsAttr)\s*\(/g)].map(m => m[1]));
            for (const u of used) {
                if (!new RegExp(`function ${u}\\s*\\(`).test(src)) {
                    missing.push(`${path.relative(JS_ROOT, f)}: ${u}`);
                }
            }
        }
        expect(missing).toEqual([]);
    });

    test('escJsAttr neutralises a JS-string breakout and delivers the value intact', async ({ page }) => {
        const results = await page.evaluate(() => {
            const escapeHtml = (t) => {
                if (!t) return '';
                const d = document.createElement('div');
                d.textContent = t;
                return d.innerHTML.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
            };
            const escJsAttr = (s) => escapeHtml(String(s ?? '')
                .replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\r?\n/g, '\\n'));

            window.__hit = 0;
            window.doThing = (v) => { window.__got = v; };

            const payloads = [
                `');window.__hit=1;//`,
                `O'Brien & Sons <script>`,
                `" onmouseover="window.__hit=1" x="`,
                `back\\slash`,
            ];
            return payloads.map((p) => {
                window.__got = null;
                const host = document.createElement('div');
                host.innerHTML = `<button onclick="doThing('${escJsAttr(p)}')">x</button>`;
                document.body.appendChild(host);
                host.firstElementChild.click();
                return {
                    payload: p,
                    attrs: host.firstElementChild.getAttributeNames().sort().join(','),
                    received: window.__got,
                    hit: window.__hit,
                };
            });
        });

        for (const r of results) {
            expect(r.hit, `payload executed: ${r.payload}`).toBe(0);
            expect(r.attrs, `stray attribute for: ${r.payload}`).toBe('onclick');
            // The rep must still SEE the real value, escaping is not mangling.
            expect(r.received).toBe(r.payload);
        }
    });

    test('the UNFIXED inline handler really does execute — that defect was real too', async ({ page }) => {
        const executed = await page.evaluate(() => {
            const escapeHtml = (t) => {
                if (!t) return '';
                const d = document.createElement('div');
                d.textContent = t;
                return d.innerHTML.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
            };
            window.__hit2 = 0;
            window.doThing = () => {};
            const host = document.createElement('div');
            // HTML-escaped only — no JS-string escaping.
            host.innerHTML = `<button onclick="doThing('${escapeHtml(`');window.__hit2=1;//`)}')">x</button>`;
            document.body.appendChild(host);
            host.firstElementChild.click();
            return window.__hit2 === 1;
        });
        expect(executed).toBe(true);
    });
});
