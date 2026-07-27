/**
 * Phone Scanner — pairs to a desktop till over the stock hub and pushes every scanned
 * (or typed) barcode straight into that till's cart. Works on any phone with a browser;
 * camera decoding uses the native BarcodeDetector where available (Chrome/Android),
 * with the manual-entry box as the universal fallback (incl. iPhone Safari).
 */
let hub = null, sessionToken = null, lastSent = '', lastSentAt = 0;

document.addEventListener('DOMContentLoaded', async function () {
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
    // Path 1: native BarcodeDetector (Chrome/Android) — fastest, zero extra decode cost.
    if ('BarcodeDetector' in window && navigator.mediaDevices?.getUserMedia) {
        try {
            const detector = new BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'qr_code'] });
            const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
            const video = document.getElementById('scanVideo');
            video.style.display = '';
            video.srcObject = stream;
            setInterval(async () => {
                try {
                    const codes = await detector.detect(video);
                    if (codes.length) sendScan((codes[0].rawValue || '').trim());
                } catch { /* per-frame errors are harmless */ }
            }, 250);
            return;
        } catch { /* fall through to the JS decoder (e.g. permission granted but detector flaky) */ }
    }
    // Path 2: html5-qrcode (ZXing in JS) — works wherever getUserMedia does, incl. iOS Safari
    // and Android in-app browsers that lack BarcodeDetector.
    if (typeof Html5Qrcode !== 'undefined' && navigator.mediaDevices?.getUserMedia) {
        try {
            document.getElementById('h5qrView').style.display = '';
            const h5 = new Html5Qrcode('h5qrView', {
                formatsToSupport: [
                    Html5QrcodeSupportedFormats.EAN_13, Html5QrcodeSupportedFormats.EAN_8,
                    Html5QrcodeSupportedFormats.UPC_A, Html5QrcodeSupportedFormats.UPC_E,
                    Html5QrcodeSupportedFormats.CODE_128, Html5QrcodeSupportedFormats.CODE_39,
                    Html5QrcodeSupportedFormats.QR_CODE
                ]
            });
            await h5.start({ facingMode: 'environment' }, { fps: 10, qrbox: { width: 260, height: 160 } },
                decoded => sendScan((decoded || '').trim()),
                () => { /* per-frame misses are normal */ });
            return;
        } catch (err) {
            console.warn('[Scanner] html5-qrcode failed', err);
        }
    }
    document.getElementById('scanStatus').textContent = 'Camera unavailable — type barcodes below.';
}
