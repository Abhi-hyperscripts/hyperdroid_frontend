// Public live-location page. No login: the token in ?t= is the credential.
// Polls GET /api/attendance/location-pings/shared/{token} every 60 s and
// draws ONE marker — the agent's newest position for the open shift. 404
// means the link is unknown, expired or withdrawn; clocked_in=false means
// the agent finished the shift. Both end the page honestly.
(function () {
    'use strict';
    const POLL_MS = 60_000;
    const STALE_MS = 20 * 60 * 1000;
    const token = new URLSearchParams(location.search).get('t') || '';
    const base = (typeof CONFIG !== 'undefined' && CONFIG.hrmsApiBaseUrl) ? CONFIG.hrmsApiBaseUrl : '/api';

    const $ = (id) => document.getElementById(id);
    let map = null, marker = null, ring = null, timer = null, fitted = false;

    function ago(iso) {
        const ms = Date.now() - new Date(iso).getTime();
        const m = Math.round(ms / 60000);
        if (m < 1) return 'just now';
        if (m < 60) return `${m} min ago`;
        const h = Math.floor(m / 60);
        return `${h} h ${m % 60} min ago`;
    }
    function hm(iso) {
        try { return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); } catch { return ''; }
    }

    function showState(text, pill, pillClass) {
        $('map').hidden = true;
        const box = $('stateBox'); box.hidden = false; box.textContent = text;
        const p = $('statusPill'); p.hidden = false; p.textContent = pill; p.className = 'pill ' + (pillClass || '');
    }

    function ensureMap() {
        if (map) return;
        $('stateBox').hidden = true;
        $('map').hidden = false;
        map = L.map('map', { zoomControl: true, attributionControl: true }).setView([20.59, 78.96], 5);
        L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}', {
            maxZoom: 19,
            attribution: 'Tiles &copy; Esri &mdash; Esri, HERE, Garmin, OpenStreetMap contributors'
        }).addTo(map);
    }

    function render(share) {
        const name = share.employee_name || 'Field agent';
        $('agentName').textContent = name;
        $('avatar').textContent = name.split(' ').map(w => w[0] || '').slice(0, 2).join('').toUpperCase() || '•';
        $('expiryNote').textContent = share.expires_at ? `Sharing ends at ${hm(share.expires_at)}` : '';

        if (!share.clocked_in) {
            $('agentSub').textContent = 'Finished their shift';
            showState(`${name} has finished the shift, so live sharing has ended.`, 'Ended', 'ended');
            stop();
            return;
        }
        if (!share.position) {
            $('agentSub').textContent = 'Clocked in, waiting for the first position';
            showState('Clocked in. The first position should arrive within a few minutes.', 'Waiting', 'stale');
            return;
        }
        const p = share.position;
        const stale = (Date.now() - new Date(p.recorded_at).getTime()) > STALE_MS;
        $('agentSub').textContent = `Updated ${ago(p.recorded_at)}` + (p.accuracy_m ? ` · ±${Math.round(p.accuracy_m)} m` : '');
        const pill = $('statusPill'); pill.hidden = false;
        pill.textContent = stale ? 'No recent update' : 'Live';
        pill.className = 'pill ' + (stale ? 'stale' : '');

        ensureMap();
        const ll = [Number(p.latitude), Number(p.longitude)];
        if (!marker) {
            marker = L.marker(ll, { icon: L.divIcon({ className: '', html: '<div class="me-pin"></div>', iconSize: [18, 18], iconAnchor: [9, 9] }) }).addTo(map);
            ring = L.circle(ll, { radius: Math.max(15, Number(p.accuracy_m || 0)), color: '#7C3AED', weight: 1, fillOpacity: 0.08 }).addTo(map);
        } else {
            marker.setLatLng(ll);
            ring.setLatLng(ll).setRadius(Math.max(15, Number(p.accuracy_m || 0)));
        }
        marker.bindTooltip(`${name} · ${hm(p.recorded_at)}`, { permanent: false });
        if (!fitted) { map.setView(ll, 16); fitted = true; }
    }

    async function refresh() {
        try {
            const r = await fetch(`${base}/attendance/location-pings/shared/${encodeURIComponent(token)}`, { cache: 'no-store' });
            if (r.status === 404) {
                $('agentName').textContent = 'Link not active';
                $('agentSub').textContent = '';
                showState('This link has expired or was withdrawn by the sender.', 'Ended', 'ended');
                stop();
                return;
            }
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            const body = await r.json();
            render(body.share || body);
        } catch (e) {
            $('agentSub').textContent = 'Could not reach the server — retrying';
        }
    }

    function stop() { if (timer) { clearInterval(timer); timer = null; } }

    if (!token) {
        showState('This link is incomplete.', 'Invalid', 'ended');
        return;
    }
    refresh();
    timer = setInterval(refresh, POLL_MS);
    document.addEventListener('visibilitychange', () => { if (!document.hidden && timer) refresh(); });
})();
