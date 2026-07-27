/**
 * Phone Scanner — pairs to a desktop till over the stock hub and pushes every scanned
 * (or typed) barcode straight into that till's cart. Works on any phone with a browser;
 * camera decoding uses the native BarcodeDetector where available (Chrome/Android),
 * with the manual-entry box as the universal fallback (incl. iPhone Safari).
 */
let hub = null, sessionCode = null, lastSent = '', lastSentAt = 0;

document.addEventListener('DOMContentLoaded', async function () {
    // Stash the QR's ?code= BEFORE the auth gate — a login redirect drops the query string.
    const qrCode = new URLSearchParams(location.search).get('code');
    if (qrCode) localStorage.setItem('pendingPairCode', qrCode.toUpperCase());
    if (!await AccountsCommon.initPage('scanner', '../')) return;
    document.getElementById('pairInput').addEventListener('keydown', e => { if (e.key === 'Enter') joinSession(); });
    const pending = localStorage.getItem('pendingPairCode');
    if (pending) {
        localStorage.removeItem('pendingPairCode');
        document.getElementById('pairInput').value = pending;
        joinSession();   // auto-pair straight from the QR
    }
    document.getElementById('manualCode').addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); sendScan(e.target.value.trim()); e.target.value = ''; }
    });
});

async function joinSession() {
    const code = document.getElementById('pairInput').value.trim().toUpperCase();
    const msg = document.getElementById('pairMsg');
    if (code.length < 4) { msg.textContent = 'Enter the code shown on the till.'; return; }
    msg.textContent = 'Connecting…';
    try {
        hub = new signalR.HubConnectionBuilder()
            .withUrl(`${CONFIG.endpoints.accounts}/hubs/stock`, { accessTokenFactory: () => getAuthToken() })
            .withAutomaticReconnect()
            .build();
        hub.on('ScanAck', (ok, label) => {
            const st = document.getElementById('scanStatus');
            st.textContent = ok ? `✓ ${label}` : `✕ ${label}`;
            st.style.color = ok ? 'var(--color-success)' : 'var(--color-error)';
            navigator.vibrate?.(ok ? 60 : [60, 60, 60]);
        });
        await hub.start();
        const ok = await hub.invoke('JoinPosSession', code);
        if (!ok) { msg.textContent = 'No till is waiting on that code — check it and try again.'; return; }
        sessionCode = code;
        document.getElementById('pairCard').style.display = 'none';
        document.getElementById('scanCard').style.display = '';
        document.getElementById('pairedCode').textContent = code;
        startCamera();
    } catch (err) {
        msg.textContent = 'Could not connect — check your internet and login.';
        console.error('[Scanner] join failed', err);
    }
}

function sendScan(code) {
    if (!code || !hub || !sessionCode) return;
    // Debounce: the camera sees the same barcode on many consecutive frames.
    const now = Date.now();
    if (code === lastSent && now - lastSentAt < 1500) return;
    lastSent = code; lastSentAt = now;
    document.getElementById('scanStatus').textContent = '…';
    hub.invoke('SendScan', sessionCode, code).catch(() => {
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
