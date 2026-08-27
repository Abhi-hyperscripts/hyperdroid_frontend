/**
 * Loads PDF.js on demand, once.
 * ----------------------------------------------------------------------------
 * Two very different pages need it — the CRM's placement dialog and the public
 * signing page — and neither should carry a megabyte of viewer on every load.
 *
 * ⭐ IT LIVES HERE BECAUSE BOTH PAGES NEED THE SAME WORKER SETTING.
 *
 * PDF.js renders nothing, and says nothing, if GlobalWorkerOptions.workerSrc is
 * not set to a build matching the library. Two copies of this loader is two
 * chances for one of them to be pinned to a different version and fail in a way
 * that looks like a broken document rather than a broken configuration.
 */
const PdfJsLoader = (() => {
    'use strict';

    // Pinned. A floating version means the viewer can change under a signed
    // document without anybody deploying anything.
    const VERSION = '3.11.174';
    const BASE = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${VERSION}/build`;

    let pending = null;

    function load() {
        if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
        if (pending) return pending;

        pending = new Promise((resolve, reject) => {
            const s = document.createElement('script');
            s.src = `${BASE}/pdf.min.js`;
            s.onload = () => {
                if (!window.pdfjsLib) {
                    reject(new Error('The PDF viewer loaded but did not register'));
                    return;
                }
                window.pdfjsLib.GlobalWorkerOptions.workerSrc = `${BASE}/pdf.worker.min.js`;
                resolve(window.pdfjsLib);
            };
            s.onerror = () => reject(new Error('Could not load the PDF viewer'));
            document.head.appendChild(s);
        });
        return pending;
    }

    /**
     * Render every page into `host` as a canvas inside a positioned wrapper.
     *
     * The wrapper carries `data-page` and is `position: relative`, so callers
     * can place overlays on it using the same fractions the server stamps with.
     * Returns the number of pages rendered.
     */
    async function renderInto(host, url, maxWidth) {
        const lib = await load();
        const doc = await lib.getDocument({ url }).promise;

        host.innerHTML = '';
        for (let n = 1; n <= doc.numPages; n++) {
            const page = await doc.getPage(n);
            const unscaled = page.getViewport({ scale: 1 });
            const width = Math.min(maxWidth || host.clientWidth || 760, 900);
            const viewport = page.getViewport({ scale: width / unscaled.width });

            const wrap = document.createElement('div');
            wrap.className = 'sign-page';
            wrap.dataset.page = String(n);
            wrap.style.width = `${viewport.width}px`;
            wrap.style.height = `${viewport.height}px`;

            const canvas = document.createElement('canvas');
            canvas.width = viewport.width;
            canvas.height = viewport.height;
            wrap.appendChild(canvas);
            host.appendChild(wrap);

            await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
        }
        return doc.numPages;
    }

    return { load, renderInto, VERSION };
})();
