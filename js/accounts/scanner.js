/**
 * Phone Scanner — pairs to a desktop till over the stock hub and pushes every scanned
 * (or typed) barcode straight into that till's cart. Works on any phone with a browser;
 * camera decoding uses the native BarcodeDetector where available (Chrome/Android),
 * with the manual-entry box as the universal fallback (incl. iPhone Safari).
 */
let hub = null, sessionToken = null, lastSent = '', lastSentAt = 0;

document.addEventListener('DOMContentLoaded', async function () {
    // Visible build stamp — lets anyone confirm at a glance which version this phone runs
    // (the SW cache once served phones a stale scanner.js; this makes that failure visible).
    const buildEl = document.getElementById('buildNo');
    if (buildEl && typeof SW_VERSION !== 'undefined') buildEl.textContent = 'Build ' + SW_VERSION;
    const qrToken = new URLSearchParams(location.search).get('token');
    if (qrToken) {
        // QR path: the token IS the credential — no login, any phone. The hub scopes this
        // connection to exactly one till's cart; no tenant data flows to the phone.
        wireInputs();
        await joinByToken(qrToken);
        return;
    }
    // Manual-code path: works only for logged-in staff (the hub enforces it);
    // an anonymous phone that tries a code gets a clear pointer to the QR.
    wireInputs();
});

// Appends decoder diagnostics to the visible build line — a field screenshot then answers
// "which decode engine actually ran on this phone" without any remote debugging.
function diag(txt) {
    const el = document.getElementById('buildNo');
    if (el) el.textContent = (typeof SW_VERSION !== 'undefined' ? 'Build ' + SW_VERSION : 'Build ?') + ' · ' + txt;
}

function wireInputs() {
    document.getElementById('pairInput').addEventListener('keydown', e => { if (e.key === 'Enter') joinSession(); });
    document.getElementById('manualCode').addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); sendScan(e.target.value.trim()); e.target.value = ''; }
    });
}

function buildHub(withAuth) {
    const b = new signalR.HubConnectionBuilder();
    const opts = withAuth && typeof getAuthToken === 'function' ? { accessTokenFactory: () => getAuthToken() } : {};
    return b.withUrl(`${CONFIG.endpoints.accounts}/hubs/stock`, opts).withAutomaticReconnect().build();
}

function wireAcks() {
    hub.on('ScanAck', (ok, label) => {
        const st = document.getElementById('scanStatus');
        st.textContent = ok ? `✓ ${label}` : `✕ ${label}`;
        st.style.color = ok ? 'var(--color-success)' : 'var(--color-error)';
        navigator.vibrate?.(ok ? 60 : [60, 60, 60]);
    });
}

function showScanUi(label) {
    document.getElementById('pairCard').style.display = 'none';
    document.getElementById('scanCard').style.display = '';
    document.getElementById('pairedCode').textContent = label;
    startCamera();
}

async function joinByToken(token) {
    const msg = document.getElementById('pairMsg');
    try {
        hub = buildHub(false);            // anonymous — the token is the credential
        wireAcks();
        await hub.start();
        const ok = await hub.invoke('JoinPosSessionByToken', token);
        if (!ok) { msg.textContent = 'This pairing QR has expired — generate a new one on the billing counter.'; return; }
        sessionToken = token;
        showScanUi('(QR pairing)');
    } catch (err) {
        msg.textContent = 'Could not connect — check the internet connection.';
        console.error('[Scanner] token join failed', err);
    }
}

async function joinSession() {
    const code = document.getElementById('pairInput').value.trim().toUpperCase();
    const msg = document.getElementById('pairMsg');
    if (code.length < 4) { msg.textContent = 'Enter the code shown on the billing counter.'; return; }
    msg.textContent = 'Connecting…';
    try {
        hub = buildHub(true);
        wireAcks();
        await hub.start();
        let token = null;
        try { token = await hub.invoke('JoinPosSession', code); }
        catch { msg.textContent = 'Codes need a staff login on this phone — scan the QR on the counter screen instead (no login needed).'; return; }
        if (!token) { msg.textContent = 'No counter is waiting on that code — check it and try again.'; return; }
        sessionToken = token;
        showScanUi(code);
    } catch (err) {
        msg.textContent = 'Could not connect — check your internet and login.';
        console.error('[Scanner] join failed', err);
    }
}

function sendScan(code) {
    if (!code || !hub || !sessionToken) return;
    // Debounce: the camera sees the same barcode on many consecutive frames.
    const now = Date.now();
    if (code === lastSent && now - lastSentAt < 1500) return;
    lastSent = code; lastSentAt = now;
    document.getElementById('scanStatus').textContent = '…';
    hub.invoke('SendScan', sessionToken, code).catch(() => {
        document.getElementById('scanStatus').textContent = 'Send failed — reconnecting…';
    });
}

async function startCamera() {
    // Path 1: BarcodeDetector — native on Chrome/Android, zbar-wasm polyfill everywhere else
    // (wired up in scanner.html). zbar is the industry-standard 1D engine: it reads EAN/UPC
    // frames the JS fallback decoder gives up on, which is why this path is preferred.
    //
    // Detector choice is CAPABILITY-based, not existence-based: some browsers (new iOS
    // Safari) expose a native BarcodeDetector that is QR-only — constructing it with 1D
    // formats throws, which used to dump us into the weak JS fallback. Native is used only
    // if it really supports ean_13; otherwise the zbar polyfill class is used directly.
    let Detector = null, detectorName = '';
    try {
        const fmts = await window.BarcodeDetector?.getSupportedFormats?.();
        if (fmts && fmts.includes('ean_13')) { Detector = window.BarcodeDetector; detectorName = 'native'; }
    } catch { /* treat as unsupported */ }
    if (!Detector && window.barcodeDetectorPolyfill) {
        Detector = barcodeDetectorPolyfill.BarcodeDetectorPolyfill; detectorName = 'zbar';
    }
    if (Detector && navigator.mediaDevices?.getUserMedia) {
        let stream = null;
        try {
            const detector = new Detector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'qr_code'] });
            // High resolution is what makes the thin bars of a 1D code resolvable.
            stream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } }
            });
            // Best-effort focus hint — applied at track level where browsers safely ignore
            // unsupported keys (unlike html5-qrcode's strict constraint validation).
            try { await stream.getVideoTracks()[0].applyConstraints({ advanced: [{ focusMode: 'continuous' }] }); } catch { }
            const video = document.getElementById('scanVideo');
            video.style.display = '';
            video.srcObject = stream;
            video.addEventListener('loadedmetadata',
                () => diag(detectorName + ' · ' + video.videoWidth + '×' + video.videoHeight), { once: true });
            setInterval(async () => {
                try {
                    const codes = await detector.detect(video);
                    if (codes.length) sendScan((codes[0].rawValue || '').trim());
                } catch { /* per-frame errors are harmless */ }
            }, 250);
            document.getElementById('scanStatus').textContent = 'Point at a barcode — 15–20 cm, steady';
            return;
        } catch (err) {
            console.warn('[Scanner] BarcodeDetector path failed', err);
            diag(detectorName + ' failed: ' + (err?.name || err));
            try { stream?.getTracks().forEach(t => t.stop()); } catch { }
            document.getElementById('scanVideo').style.display = 'none';
        }
    } else {
        diag('no detector engine' + (window.__scanLibErr ? ' [' + window.__scanLibErr + ']' : ''));
    }
    // Path 2: html5-qrcode (ZXing in JS) — works wherever getUserMedia does, incl. iOS Safari
    // and Android in-app browsers that lack BarcodeDetector.
    if (typeof Html5Qrcode !== 'undefined' && navigator.mediaDevices?.getUserMedia) {
        document.getElementById('h5qrView').style.display = '';
        // Tiered start. Two hard-won rules encoded here:
        //  1. start()'s FIRST argument accepts ONLY {facingMode}/{deviceId} — resolution goes in
        //     the options object as videoConstraints (higher res is what makes 1D bars decodable).
        //  2. A failed instance is stuck 'under transition' and can never be restarted — every
        //     attempt needs a FRESH Html5Qrcode instance, or the retry dies with
        //     'Cannot transition to a new state'.
        const attempts = [
            { videoConstraints: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } } },
            {},  // library defaults — the config that has always worked
        ];
        let lastErr = null;
        for (const extra of attempts) {
            const h5 = new Html5Qrcode('h5qrView', {
                formatsToSupport: [
                    Html5QrcodeSupportedFormats.EAN_13, Html5QrcodeSupportedFormats.EAN_8,
                    Html5QrcodeSupportedFormats.UPC_A, Html5QrcodeSupportedFormats.UPC_E,
                    Html5QrcodeSupportedFormats.CODE_128, Html5QrcodeSupportedFormats.CODE_39,
                    Html5QrcodeSupportedFormats.QR_CODE
                ]
            });
            try {
                await h5.start(
                    { facingMode: 'environment' },
                    { fps: 15,
                      // Wide, letterbox-shaped scan window — EAN bars need width, and a box cut
                      // relative to the viewfinder survives every phone screen size.
                      qrbox: (w, h) => ({ width: Math.floor(w * 0.9), height: Math.floor(Math.min(h * 0.35, 220)) }),
                      experimentalFeatures: { useBarCodeDetectorIfSupported: true }, ...extra },
                    decoded => sendScan((decoded || '').trim()),
                    () => { /* per-frame misses are normal */ });
                document.getElementById('scanStatus').textContent = 'Hold 15–20 cm away, steady, bars filling the box';
                diag((Detector ? '' : 'no-engine · ') + 'js-fallback' + (extra.videoConstraints ? ' · hi-res' : ' · default'));
                return;
            } catch (err) {
                lastErr = err; console.warn('[Scanner] camera start failed', extra, err);
                try { h5.clear(); } catch { /* leave the container usable for the next attempt */ }
            }
        }
        document.getElementById('h5qrView').style.display = 'none';
        const reason = lastErr && /denied|NotAllowed/i.test(String(lastErr.name || lastErr))
            ? 'camera permission denied — allow camera for this site' : (lastErr?.name || lastErr || '');
        document.getElementById('scanStatus').textContent =
            'Camera unavailable' + (reason ? ` (${reason})` : '') + ' — type barcodes below.';
        return;
    }
    document.getElementById('scanStatus').textContent = 'Camera unavailable — type barcodes below.';
}
