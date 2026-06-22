// Field Agents map — live board (every-60s poll) + per-employee day trail.
//
// Backend contracts (already deployed):
//   GET /api/attendance/location-pings/live           — live last-known per agent
//                                                       HRMS_MANAGER scope = direct reports
//   GET /api/attendance/location-pings/{id}?date=YYYY-MM-DD — UTC-day trail
//
// Privacy gate is enforced server-side: HRMS_MANAGER only sees direct reports;
// HR_ADMIN / HRMS_ADMIN / SUPERADMIN see every clocked-in field agent.
//
// Page is gated to manager+ roles via roleUtils. Plain HRMS_USER is bounced.
//
// v2 (June 2026): added search + Stale / Low-batt filter chips, marker
// clustering via Leaflet.markercluster, freshest-first sort, and auto-fit
// to live agents on first load. Sized for a manager with 200+ agents
// across a city — the older flat list + uncluster pins fell over at scale.

(function () {
    const POLL_MS = 60_000;
    const DEFAULT_CENTER = [20.5937, 78.9629];  // Geographic centre of India
    const DEFAULT_ZOOM = 5;
    const STALE_MS = 15 * 60 * 1000;            // > 15 min since last ping → stale
    const LOW_BATT = 20;                         // ≤ 20% → low

    let map = null;
    let clusterLayer = null;        // L.MarkerClusterGroup of live pins
    let markerById = {};            // employeeId → L.Marker (so we can centerOn)
    let trailLayerGroup = null;     // L.LayerGroup of trail polyline + dots
    let liveAgents = [];            // last fetched /live response
    let selectedEmployeeId = null;
    let pollTimer = null;
    let hasAutoFitted = false;      // first non-empty fetch → fit map once
    let searchQuery = '';
    let activeFilter = 'all';       // 'all' | 'stale' | 'low_batt'

    document.addEventListener('DOMContentLoaded', async () => {
        if (!ensureAccess()) return;
        setupMap();
        wireHandlers();
        await refresh();           // initial load
        startPolling();
    });

    function ensureAccess() {
        // Only manager+ roles can see the live board. The backend enforces
        // it too, but bouncing client-side avoids rendering an empty map
        // for someone who has no business being here.
        if (typeof hrmsRoles === 'undefined' || !hrmsRoles?.init) {
            // roleUtils not loaded yet — let it through; the API will 403 if not allowed
            return true;
        }
        try { hrmsRoles.init(); } catch { /* swallow */ }
        const ok = hrmsRoles.isHRAdmin?.() ||
                   hrmsRoles.isSuperAdmin?.() ||
                   hrmsRoles.isManager?.() ||
                   hrmsRoles.isHRManager?.();
        if (!ok) {
            if (typeof showToast === 'function') {
                showToast('You need manager-level access to view the field agents map.', 'error');
            }
            setTimeout(() => { window.location.href = 'dashboard.html'; }, 1200);
            return false;
        }
        return true;
    }

    function setupMap() {
        map = L.map('fieldAgentsMap', { zoomControl: true, attributionControl: true })
            .setView(DEFAULT_CENTER, DEFAULT_ZOOM);

        // OpenStreetMap tiles — free for non-commercial; for prod traffic we
        // may eventually swap for MapTiler/Carto via a tenant-stored key, but
        // OSM keeps us moving and the customer's compliance officer signed
        // off on it because we're not embedding map material in payslips.
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 19,
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        }).addTo(map);

        // Cluster bubble for the live pins. spiderfyOnMaxZoom expands the
        // last overlapping cluster into a fan so coincident agents (e.g.
        // two field reps at the same client site) are individually tappable.
        clusterLayer = L.markerClusterGroup({
            showCoverageOnHover: false,
            spiderfyOnMaxZoom: true,
            chunkedLoading: true,
            maxClusterRadius: 45,
        }).addTo(map);

        trailLayerGroup = L.layerGroup().addTo(map);

        // The shell relies on calc(100vh - 52px); Leaflet measures the map
        // div on construction, and if the page is still settling layout
        // the map ends up shorter than the column. invalidateSize after a
        // beat fixes the tile gap; a ResizeObserver catches later resizes
        // (e.g. devtools open / window resize).
        const mapDiv = document.getElementById('fieldAgentsMap');
        setTimeout(() => map.invalidateSize(), 100);
        if (window.ResizeObserver) {
            new ResizeObserver(() => map.invalidateSize()).observe(mapDiv);
        }
        window.addEventListener('resize', () => map.invalidateSize());
    }

    function wireHandlers() {
        document.getElementById('refreshBtn').addEventListener('click', () => {
            refresh().catch(() => undefined);
        });
        document.getElementById('fitBoundsBtn').addEventListener('click', () => {
            fitMapToLiveAgents();
        });
        document.getElementById('trailCloseBtn').addEventListener('click', closeTrail);

        // Search input — re-renders the list as the user types. Cheap;
        // the list is virtualized via the browser's natural scroll.
        const searchInput = document.getElementById('agentSearchInput');
        searchInput.addEventListener('input', (e) => {
            searchQuery = (e.target.value || '').toLowerCase().trim();
            renderAgentList();
        });

        // Filter chips — All / Stale / Low batt. Click any chip to flip
        // active state; the list re-renders, the map markers do not (they
        // always show every live agent, just colour-tinted by status).
        document.querySelectorAll('.agent-filter-chip').forEach(chip => {
            chip.addEventListener('click', () => {
                activeFilter = chip.dataset.filter;
                document.querySelectorAll('.agent-filter-chip').forEach(c => c.classList.toggle('active', c === chip));
                renderAgentList();
            });
        });

        const trailDateInput = document.getElementById('trailDate');
        // Default to today's UTC date for the trail picker. The backend
        // interprets `date` as a UTC day, so this matches what HR usually
        // wants — "show me today's run".
        //
        // Clamp the picker to the retention window: the Hangfire pruner
        // (LocationPingsPrunerJob, RETENTION_DAYS=7) drops anything older
        // than 7 UTC-days at 02:00 UTC daily, so picking older dates would
        // just return "no pings recorded" — confusing UX. The compliance
        // officer signed off on the 7-day window; if HR ever asks for
        // longer history, that requires re-approval, not a UI change.
        const today = new Date();
        const todayUtc = today.toISOString().slice(0, 10);
        const earliestUtc = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000)
            .toISOString().slice(0, 10);

        // flatpickr — same lib + theme used by attendance.html / leads.html
        // so HR's muscle memory works. The native <input type="date"> is
        // unreliable inside our positioned drawer (Safari occasionally
        // refuses to open the popup, Chrome opens it but clipped).
        if (typeof flatpickr === 'function') {
            flatpickr(trailDateInput, {
                dateFormat: 'Y-m-d',
                defaultDate: todayUtc,
                minDate: earliestUtc,
                maxDate: todayUtc,
                disableMobile: false,  // honour the native calendar on small phones
                onChange: (selectedDates, dateStr) => {
                    if (selectedEmployeeId && dateStr) {
                        loadTrail(selectedEmployeeId, dateStr).catch(() => undefined);
                    }
                },
            });
        } else {
            // Fallback to native if flatpickr failed to load (CDN down etc).
            trailDateInput.type = 'date';
            trailDateInput.value = todayUtc;
            trailDateInput.min = earliestUtc;
            trailDateInput.max = todayUtc;
            trailDateInput.addEventListener('change', () => {
                if (selectedEmployeeId) loadTrail(selectedEmployeeId, trailDateInput.value).catch(() => undefined);
            });
        }
    }

    function startPolling() {
        stopPolling();
        pollTimer = setInterval(() => { refresh().catch(() => undefined); }, POLL_MS);
        document.addEventListener('visibilitychange', () => {
            // Don't waste battery polling while the tab is backgrounded.
            if (document.hidden) stopPolling();
            else { refresh().catch(() => undefined); startPolling(); }
        });
    }

    function stopPolling() {
        if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    }

    async function refresh() {
        try {
            const res = await api.getLiveFieldAgentLocations();
            liveAgents = res?.agents || [];
            renderAgentList();
            renderLiveMarkers();
            // First time we get real agents, zoom the map to where they
            // actually are. Otherwise the user lands on India-centroid
            // zoom 5 and never sees the marker in Delhi.
            if (!hasAutoFitted && liveAgents.length > 0) {
                hasAutoFitted = true;
                fitMapToLiveAgents();
            }
        } catch (e) {
            console.error('[field-agents] live fetch failed:', e);
            if (typeof showToast === 'function') {
                showToast('Could not load live field-agent positions.', 'error');
            }
        }
    }

    // ─── Status helpers (shared across list + markers) ─────────────────
    function lastPingMs(a) {
        const iso = a.recorded_at || a.last_recorded_at;
        return iso ? new Date(iso).getTime() : 0;
    }
    function isStale(a) {
        const t = lastPingMs(a);
        return t > 0 && (Date.now() - t) > STALE_MS;
    }
    function isLowBatt(a) {
        return typeof a.battery_pct === 'number' && a.battery_pct <= LOW_BATT;
    }
    // Worst-case-first so a low-battery stale agent reads as "low battery".
    function statusClass(a) {
        if (isLowBatt(a)) return 'low';
        if (isStale(a)) return 'stale';
        return '';
    }

    function renderAgentList() {
        const scroll = document.getElementById('agentListScroll');

        // Header summary — always shows live count; stale/low pills only
        // surface when non-zero so a healthy fleet doesn't look cluttered.
        const counts = liveAgents.reduce((acc, a) => {
            acc.live++;
            if (isStale(a)) acc.stale++;
            if (isLowBatt(a)) acc.low++;
            return acc;
        }, { live: 0, stale: 0, low: 0 });
        const summary = document.getElementById('agentListSummary');
        let summaryHtml = `<span class="pill">${counts.live} live</span>`;
        if (counts.stale) summaryHtml += `<span class="pill stale">${counts.stale} stale</span>`;
        if (counts.low)   summaryHtml += `<span class="pill low">${counts.low} low batt</span>`;
        summary.innerHTML = summaryHtml;

        // Chip badges
        document.getElementById('countAll').textContent   = counts.live;
        document.getElementById('countStale').textContent = counts.stale;
        document.getElementById('countLow').textContent   = counts.low;

        // Filter + search → visible list
        const q = searchQuery;
        const visible = liveAgents.filter(a => {
            if (activeFilter === 'stale' && !isStale(a)) return false;
            if (activeFilter === 'low_batt' && !isLowBatt(a)) return false;
            if (!q) return true;
            const name = (a.employee_name || '').toLowerCase();
            const code = (a.employee_code || '').toLowerCase();
            return name.includes(q) || code.includes(q);
        }).sort((a, b) => lastPingMs(b) - lastPingMs(a)); // freshest first

        if (liveAgents.length === 0) {
            scroll.innerHTML = `
                <div class="agent-list-empty">
                    <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                        <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path>
                        <circle cx="12" cy="10" r="3"></circle>
                    </svg>
                    <div>No field agents clocked in right now.</div>
                    <div style="margin-top:6px;font-size:0.75rem;">Mark employees as field agents in their profile, then they'll appear here while their shift is open.</div>
                </div>`;
            return;
        }
        if (visible.length === 0) {
            scroll.innerHTML = `<div class="agent-list-empty">No agents match this filter or search.</div>`;
            return;
        }

        scroll.innerHTML = visible.map(a => {
            const initials = (a.employee_name || '?').split(' ').map(w => w[0] || '').slice(0, 2).join('').toUpperCase();
            const ago = humanAgo(a.recorded_at || a.last_recorded_at);
            const cls = statusClass(a);
            const battLow = isLowBatt(a) ? ' low' : '';
            return `
                <div class="agent-row${selectedEmployeeId === a.employee_id ? ' active' : ''}"
                     data-employee-id="${a.employee_id}">
                    <div class="agent-avatar">${initials}</div>
                    <div class="agent-meta">
                        <div class="agent-name">${escapeText(a.employee_name || a.employee_code || 'Unknown')}</div>
                        <div class="agent-subline">
                            <span class="agent-pulse ${cls}"></span>
                            <span>${ago}</span>
                            ${typeof a.battery_pct === 'number' ? `<span class="agent-batt${battLow}">· 🔋 ${a.battery_pct}%</span>` : ''}
                        </div>
                    </div>
                </div>
            `;
        }).join('');

        scroll.querySelectorAll('.agent-row').forEach(row => {
            row.addEventListener('click', () => {
                const id = row.getAttribute('data-employee-id');
                selectAgent(id);
            });
        });
    }

    function renderLiveMarkers() {
        // Rebuild from scratch — the cluster layer is cheap to repopulate
        // (chunkedLoading: true), and tracking per-marker status changes
        // independently is more code than it's worth.
        clusterLayer.clearLayers();
        markerById = {};

        liveAgents.forEach(a => {
            if (typeof a.latitude !== 'number' || typeof a.longitude !== 'number') return;
            const cls = statusClass(a);
            const icon = L.divIcon({
                className: 'fa-marker-wrap',
                html: `<div class="fa-marker ${cls}"></div>`,
                iconSize: [24, 24],
                iconAnchor: [12, 12],
            });
            const m = L.marker([a.latitude, a.longitude], { icon, title: a.employee_name || a.employee_code });
            m.on('click', () => selectAgent(a.employee_id));
            clusterLayer.addLayer(m);
            markerById[a.employee_id] = m;
        });
    }

    function fitMapToLiveAgents() {
        const coords = liveAgents
            .filter(a => typeof a.latitude === 'number' && typeof a.longitude === 'number')
            .map(a => [a.latitude, a.longitude]);
        if (coords.length === 0) {
            map.setView(DEFAULT_CENTER, DEFAULT_ZOOM);
            return;
        }
        if (coords.length === 1) {
            map.setView(coords[0], 14);
            return;
        }
        const bounds = L.latLngBounds(coords);
        map.fitBounds(bounds, { padding: [40, 40], maxZoom: 16 });
    }

    function selectAgent(employeeId) {
        selectedEmployeeId = employeeId;
        renderAgentList();  // re-render so the active row highlights
        const agent = liveAgents.find(a => a.employee_id === employeeId);
        if (!agent) return;

        // Centre map on the agent. zoomToShowLayer un-clusters the bubble
        // first so the pin actually surfaces; falls back to setView for
        // markers that aren't inside the cluster layer.
        const marker = markerById[employeeId];
        if (marker && clusterLayer.hasLayer(marker)) {
            clusterLayer.zoomToShowLayer(marker, () => map.setView(marker.getLatLng(), 15));
        } else if (typeof agent.latitude === 'number' && typeof agent.longitude === 'number') {
            map.setView([agent.latitude, agent.longitude], 15);
        }

        // Open drawer
        const drawer = document.getElementById('trailDrawer');
        drawer.classList.add('open');
        const initials = (agent.employee_name || '?').split(' ').map(w => w[0] || '').slice(0, 2).join('').toUpperCase();
        document.getElementById('trailAvatar').textContent = initials;
        document.getElementById('trailName').textContent = agent.employee_name || agent.employee_code || 'Unknown';
        document.getElementById('trailRole').textContent = agent.designation_name || agent.employee_code || '';

        // Auto-load today's trail
        const date = document.getElementById('trailDate').value;
        loadTrail(employeeId, date).catch(() => undefined);
    }

    function closeTrail() {
        document.getElementById('trailDrawer').classList.remove('open');
        // Clear the drawn polyline + intermediate points
        trailLayerGroup.clearLayers();
        // Re-set sublines to em-dash
        ['trailPoints', 'trailFirst', 'trailLast', 'trailBattery'].forEach(id => {
            document.getElementById(id).textContent = '—';
        });
    }

    async function loadTrail(employeeId, date) {
        trailLayerGroup.clearLayers();
        document.getElementById('trailHint').textContent = 'Loading trail…';
        try {
            const res = await api.getEmployeeLocationTrail(employeeId, date);
            const pings = res?.pings || [];
            if (pings.length === 0) {
                document.getElementById('trailHint').textContent = 'No pings recorded for this day.';
                // Reset all stats — without this, switching from a populated
                // day to an empty day leaves the previous day's numbers
                // visible, which looks like the empty state failed to load.
                ['trailPoints', 'trailFirst', 'trailLast', 'trailBattery'].forEach(id => {
                    document.getElementById(id).textContent = id === 'trailPoints' ? '0' : '—';
                });
                return;
            }

            const coords = pings.map(p => [p.latitude, p.longitude]);
            // The polyline IS the trail. Intermediate small dots make it
            // easier to eyeball direction + density at a glance.
            const polyline = L.polyline(coords, {
                color: '#7C3AED',
                weight: 4,
                opacity: 0.85,
                lineCap: 'round',
                lineJoin: 'round',
            });
            trailLayerGroup.addLayer(polyline);

            pings.forEach((p, idx) => {
                if (idx === 0 || idx === pings.length - 1) return;  // first/last visually distinct below
                const dot = L.divIcon({
                    className: 'fa-trail-marker-wrap',
                    html: '<div class="fa-trail-marker"></div>',
                    iconSize: [8, 8],
                    iconAnchor: [4, 4],
                });
                trailLayerGroup.addLayer(L.marker([p.latitude, p.longitude], { icon: dot }));
            });

            // Stats
            document.getElementById('trailPoints').textContent = String(pings.length);
            document.getElementById('trailFirst').textContent = humanTime(pings[0].recorded_at);
            document.getElementById('trailLast').textContent = humanTime(pings[pings.length - 1].recorded_at);
            const lastBat = pings[pings.length - 1].battery_pct;
            document.getElementById('trailBattery').textContent = typeof lastBat === 'number' ? `${lastBat}%` : '—';
            document.getElementById('trailHint').textContent = `Trail of ${pings.length} ping${pings.length === 1 ? '' : 's'} recorded between ${humanTime(pings[0].recorded_at)} and ${humanTime(pings[pings.length-1].recorded_at)}.`;

            // Fit map to trail
            map.fitBounds(L.latLngBounds(coords), { padding: [50, 50], maxZoom: 17 });
        } catch (e) {
            console.error('[field-agents] trail fetch failed:', e);
            document.getElementById('trailHint').textContent = 'Could not load trail. The backend may have rejected the request (e.g. you do not manage this employee).';
        }
    }

    // ─── Formatting helpers ────────────────────────────────────────────
    function humanAgo(isoTs) {
        if (!isoTs) return 'unknown';
        const then = new Date(isoTs).getTime();
        const sec = Math.max(0, Math.floor((Date.now() - then) / 1000));
        if (sec < 60) return 'just now';
        const min = Math.floor(sec / 60);
        if (min < 60) return `${min}m ago`;
        const hr = Math.floor(min / 60);
        if (hr < 24) return `${hr}h ago`;
        return `${Math.floor(hr / 24)}d ago`;
    }
    function humanTime(isoTs) {
        if (!isoTs) return '—';
        const d = new Date(isoTs);
        return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    function escapeText(s) {
        const div = document.createElement('div');
        div.textContent = String(s ?? '');
        return div.innerHTML;
    }
})();
