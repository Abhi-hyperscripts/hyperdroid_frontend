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
    // Manual-code path: short codes are guessable, so this path requires a tenant login.
    if (!await AccountsCommon.initPage('scanner', '../')) return;
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
        if (!ok) { msg.textContent = 'This pairing QR has expired — generate a new one on the till.'; return; }
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
    if (code.length < 4) { msg.textContent = 'Enter the code shown on the till.'; return; }
    msg.textContent = 'Connecting…';
    try {
        hub = buildHub(true);
        wireAcks();
        await hub.start();
        const token = await hub.invoke('JoinPosSession', code);
        if (!token) { msg.textContent = 'No till is waiting on that code — check it and try again.'; return; }
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
    if (!('BarcodeDetector' in window) || !navigator.mediaDevices?.getUserMedia) {
        document.getElementById('scanStatus').textContent = 'Camera decoding not supported here — type barcodes below.';
        return;
    }
    try {
        const detector = new BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'qr_code'] });
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        const video = document.getElementById('scanVideo');
        video.srcObject = stream;
        setInterval(async () => {
            try {
                const codes = await detector.detect(video);
                if (codes.length) sendScan((codes[0].rawValue || '').trim());
            } catch { /* per-frame errors are harmless */ }
        }, 250);
    } catch {
        document.getElementById('scanStatus').textContent = 'Camera unavailable — type barcodes below.';
    }
}
