/**
 * Marking where a signature goes — the DocuSign step.
 * ----------------------------------------------------------------------------
 * The sender opens the PDF, drags a box onto each place the customer must sign,
 * and sends. The signer signs ONCE and that mark is stamped into every box.
 *
 * ⭐⭐⭐ EVERY BOX IS STORED AS A FRACTION OF ITS PAGE, FROM THE TOP-LEFT.
 *
 * This canvas is however wide the dialog happens to be, at whatever zoom the
 * screen chose. The server stamps in PDF points on a page whose size it only
 * learns when it opens the file. Storing pixels would tie the mark to the
 * monitor that placed it — the same box would land somewhere else for a rep on
 * a bigger screen. A fraction is the one description both ends can agree on
 * knowing nothing about the other, so the conversion happens HERE, at the only
 * moment the rendered page size is known.
 *
 * Usage:  SignaturePlacer.open(fileBlobUrl, existingFields) → Promise<fields|null>
 */
const SignaturePlacer = (() => {
    'use strict';

    const esc = (t) => String(t ?? '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

    // Boxes smaller than this are almost certainly a stray click rather than a
    // deliberate drag, and a zero-area box stamps nothing while looking placed.
    const MIN_FRACTION = 0.02;

    /**
     * PDF.js comes from the shared loader — see js/pdfjs-loader.js for why the
     * worker setting must not be duplicated.
     */
    function pdfjs() {
        if (typeof PdfJsLoader === 'undefined') {
            return Promise.reject(new Error('The PDF viewer is not available on this page'));
        }
        return PdfJsLoader.load();
    }

    // ─── the dialog ─────────────────────────────────────────────────────────

    function open(fileUrl, existing) {
        return new Promise(async (resolve) => {
            const fields = (existing || []).map((f) => ({ ...f }));

            const back = document.createElement('div');
            back.className = 'sigp-place-back';
            back.innerHTML = `
                <div class="sigp-place" role="dialog" aria-modal="true" aria-label="Mark where to sign">
                    <div class="sigp-place-head">
                        <div>
                            <b>Mark where they sign</b>
                            <span>Drag a box onto each place the signature should appear.</span>
                        </div>
                        <div class="sigp-place-actions">
                            <span class="sigp-place-count" data-count>0 places</span>
                            <button type="button" class="sigp-quiet" data-cancel>Cancel</button>
                            <button type="button" class="sigp-send" data-done>Use these places</button>
                        </div>
                    </div>
                    <div class="sigp-place-body" data-pages>
                        <p class="sigp-place-loading">Opening the document…</p>
                    </div>
                </div>`;
            document.body.appendChild(back);

            const pagesHost = back.querySelector('[data-pages]');
            const countEl = back.querySelector('[data-count]');

            const close = (result) => { back.remove(); resolve(result); };
            back.querySelector('[data-cancel]').addEventListener('click', () => close(null));
            back.querySelector('[data-done]').addEventListener('click', () => close(fields));
            back.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(null); });

            const syncCount = () => {
                countEl.textContent = fields.length === 1 ? '1 place' : `${fields.length} places`;
            };
            syncCount();

            let lib;
            try { lib = await pdfjs(); }
            catch (e) {
                pagesHost.innerHTML = `<p class="sigp-place-failed">${esc(e.message)}. You can still send it
                    without marking places — the signer will sign, and nothing will be stamped
                    into the file.</p>`;
                return;
            }

            let doc;
            try {
                doc = await lib.getDocument({ url: fileUrl }).promise;
            } catch (e) {
                pagesHost.innerHTML = `<p class="sigp-place-failed">This file could not be opened as a PDF.
                    Only PDFs can have signature places marked.</p>`;
                return;
            }

            pagesHost.innerHTML = '';
            for (let n = 1; n <= doc.numPages; n++) {
                const page = await doc.getPage(n);

                // Rendered at a fixed CSS width so every page looks the same in
                // the dialog; the scale is thrown away immediately after, since
                // nothing downstream may depend on it.
                const unscaled = page.getViewport({ scale: 1 });
                const targetWidth = Math.min(pagesHost.clientWidth - 32, 820) || 760;
                const viewport = page.getViewport({ scale: targetWidth / unscaled.width });

                const wrap = document.createElement('div');
                wrap.className = 'sigp-page';
                wrap.dataset.page = String(n);
                wrap.style.width = `${viewport.width}px`;
                wrap.style.height = `${viewport.height}px`;

                const canvas = document.createElement('canvas');
                canvas.width = viewport.width;
                canvas.height = viewport.height;
                wrap.appendChild(canvas);

                const label = document.createElement('span');
                label.className = 'sigp-page-no';
                label.textContent = `Page ${n}`;
                wrap.appendChild(label);

                pagesHost.appendChild(wrap);
                await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;

                attachDrawing(wrap, n, fields, syncCount);
            }

            // Anything already placed (re-editing a draft) is drawn back on.
            fields.forEach((f) => {
                const wrap = pagesHost.querySelector(`.sigp-page[data-page="${f.page}"]`);
                if (wrap) drawBox(wrap, f, fields, syncCount);
            });
        });
    }

    /**
     * Drag on a page to place a box.
     *
     * The rectangle is normalised on mouseup — the pixels never leave this
     * function.
     */
    function attachDrawing(wrap, pageNo, fields, syncCount) {
        let start = null;
        let ghost = null;
        let pointer = null;

        // ⭐⭐⭐ POINTER EVENTS WITH CAPTURE, NOT mousedown/mousemove/mouseup.
        //
        // A drag that begins on a <canvas> can be swallowed by the browser's own
        // image-drag behaviour, and a drag that leaves the element stops
        // producing events on it at all. Both show up as "the first box I draw
        // never appears" — measured here exactly once, on the first drag of a
        // freshly opened dialog, which is the worst possible thing to be
        // intermittent about.
        //
        // setPointerCapture routes every subsequent move and the release back to
        // this element regardless of what is underneath, which is what a drag
        // actually means. It also covers touch and pen for nothing.
        wrap.addEventListener('pointerdown', (e) => {
            if (e.button !== 0) return;
            if (e.target.closest('.sigp-box')) return;   // clicking a box is a delete

            const r = wrap.getBoundingClientRect();
            start = { x: e.clientX - r.left, y: e.clientY - r.top };
            pointer = e.pointerId;
            wrap.setPointerCapture(pointer);

            ghost = document.createElement('div');
            ghost.className = 'sigp-box sigp-box-ghost';
            wrap.appendChild(ghost);
            e.preventDefault();
        });

        wrap.addEventListener('pointermove', (e) => {
            if (!start || !ghost || e.pointerId !== pointer) return;
            const r = wrap.getBoundingClientRect();
            const x = Math.max(0, Math.min(e.clientX - r.left, r.width));
            const y = Math.max(0, Math.min(e.clientY - r.top, r.height));
            ghost.style.left = `${Math.min(start.x, x)}px`;
            ghost.style.top = `${Math.min(start.y, y)}px`;
            ghost.style.width = `${Math.abs(x - start.x)}px`;
            ghost.style.height = `${Math.abs(y - start.y)}px`;
        });

        const release = (e) => {
            if (!start || e.pointerId !== pointer) return;

            const r = wrap.getBoundingClientRect();
            const x = Math.max(0, Math.min(e.clientX - r.left, r.width));
            const y = Math.max(0, Math.min(e.clientY - r.top, r.height));

            const left = Math.min(start.x, x);
            const top = Math.min(start.y, y);
            const width = Math.abs(x - start.x);
            const height = Math.abs(y - start.y);

            if (ghost) { ghost.remove(); ghost = null; }
            if (wrap.hasPointerCapture(pointer)) wrap.releasePointerCapture(pointer);
            start = null;
            pointer = null;

            // ⭐ THE CONVERSION TO FRACTIONS, AND THE ONLY PLACE IT HAPPENS.
            const field = {
                page: pageNo,
                x: left / r.width,
                y: top / r.height,
                w: width / r.width,
                h: height / r.height,
                kind: 'signature',
            };

            // A stray click is not a placement. Ignored silently — a toast on
            // every mis-click would be worse than the miss.
            if (field.w < MIN_FRACTION || field.h < MIN_FRACTION) return;

            fields.push(field);
            drawBox(wrap, field, fields, syncCount);
            syncCount();
        };

        wrap.addEventListener('pointerup', release);
        wrap.addEventListener('pointercancel', () => {
            if (ghost) { ghost.remove(); ghost = null; }
            start = null;
            pointer = null;
        });
    }

    function drawBox(wrap, field, fields, syncCount) {
        const r = wrap.getBoundingClientRect();
        const box = document.createElement('div');
        box.className = 'sigp-box';
        box.style.left = `${field.x * r.width}px`;
        box.style.top = `${field.y * r.height}px`;
        box.style.width = `${field.w * r.width}px`;
        box.style.height = `${field.h * r.height}px`;
        box.innerHTML = `<span>Signature</span><button type="button" title="Remove">×</button>`;

        box.querySelector('button').addEventListener('click', (e) => {
            e.stopPropagation();
            const i = fields.indexOf(field);
            if (i >= 0) fields.splice(i, 1);
            box.remove();
            syncCount();
        });

        wrap.appendChild(box);
    }

    return { open };
})();
