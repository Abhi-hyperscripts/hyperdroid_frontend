// ============================================================================
//  Calls Inbox — list of every inbound + outbound call, filterable + searchable
//  with a side drawer for full call detail (lifecycle, recording, transcript).
//
//  Backend contract:
//    GET  /api/Calls/inbox?direction=&missed=&unmatched=&search=&from=&to=&limit=&offset=
//    GET  /api/Calls/inbox/stats?from=&to=
//    POST /api/Calls/{id}/convert-to-lead   body: { customer_name, team_id }
//    SignalR /hubs/crm → event CallEventReceived (already broadcast by BL)
// ============================================================================
(function () {
    'use strict';

    // ─── State ─────────────────────────────────────────────────────────────
    const PAGE_SIZE = 50;
    let _filter = 'all';                 // 'all' | 'inbound' | 'outbound' | 'missed' | 'unmatched'
    let _scope = 'today';                // 'today' | '7d' | '30d' | 'all'
    let _searchTerm = '';
    let _offset = 0;
    let _rows = [];                      // currently rendered call rows (cached for drawer lookups)
    let _hasMore = false;
    let _drawerCallId = null;
    let _convertCallId = null;
    let _teamsCache = null;              // cached for the convert modal
    let _searchTimer = null;
    let _signalRBound = false;

    // ─── Helpers ───────────────────────────────────────────────────────────
    const $ = (id) => document.getElementById(id);
    function escapeHtml(s) {
        if (s === null || s === undefined) return '';
        return String(s).replace(/[&<>"']/g, (c) => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        }[c]));
    }

    // Today in IST → UTC bounds. Mirrors backend default so a Today filter
    // matches the stats strip even when the user's browser is on another TZ.
    function scopeBounds(scope) {
        const now = new Date();
        if (scope === 'all') return { from: null, to: null };
        if (scope === '7d') {
            const from = new Date(now.getTime() - 7 * 86400_000);
            return { from: from.toISOString(), to: null };
        }
        if (scope === '30d') {
            const from = new Date(now.getTime() - 30 * 86400_000);
            return { from: from.toISOString(), to: null };
        }
        // today — IST day-start
        const istOffsetMs = 5.5 * 3600_000;
        const istNow = new Date(now.getTime() + istOffsetMs);
        const dayStartIst = new Date(Date.UTC(istNow.getUTCFullYear(), istNow.getUTCMonth(), istNow.getUTCDate(), 0, 0, 0));
        // dayStartIst is the IST wallclock as a Date. To convert to UTC subtract the offset.
        const fromUtc = new Date(dayStartIst.getTime() - istOffsetMs);
        const toUtc = new Date(fromUtc.getTime() + 86400_000);
        return { from: fromUtc.toISOString(), to: toUtc.toISOString() };
    }

    function buildInboxQuery() {
        const params = new URLSearchParams();
        if (_filter === 'inbound' || _filter === 'outbound') params.set('direction', _filter);
        if (_filter === 'missed') params.set('missed', 'true');
        if (_filter === 'unmatched') params.set('unmatched', 'true');
        if (_searchTerm) params.set('search', _searchTerm);
        const { from, to } = scopeBounds(_scope);
        if (from) params.set('from', from);
        if (to) params.set('to', to);
        params.set('limit', String(PAGE_SIZE));
        params.set('offset', String(_offset));
        return params.toString();
    }

    function relTime(iso) {
        if (!iso) return '';
        const d = new Date(iso);
        const diffSec = Math.floor((Date.now() - d.getTime()) / 1000);
        if (diffSec < 60) return 'just now';
        if (diffSec < 3600) return Math.floor(diffSec / 60) + 'm ago';
        // Same day → HH:MM IST. Different day → date short.
        const istOpts = { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false };
        const today = new Date();
        if (d.toDateString() === today.toDateString()) {
            return d.toLocaleTimeString('en-IN', istOpts);
        }
        return d.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
    }

    function fmtDuration(sec) {
        if (!sec || sec <= 0) return '—';
        if (sec < 60) return sec + 's';
        const m = Math.floor(sec / 60);
        const s = sec % 60;
        return `${m}m ${s.toString().padStart(2, '0')}s`;
    }

    function statusChip(status) {
        const map = {
            'initiated': { label: 'Initiated', cls: 'ci-chip-pending' },
            'ringing': { label: 'Ringing…', cls: 'ci-chip-pending' },
            'in-progress': { label: 'In progress', cls: 'ci-chip-pending' },
            'completed': { label: 'Completed', cls: 'ci-chip-completed' },
            'no-answer': { label: 'No answer', cls: 'ci-chip-missed' },
            'busy': { label: 'Busy', cls: 'ci-chip-missed' },
            'failed': { label: 'Failed', cls: 'ci-chip-missed' },
            'canceled': { label: 'Canceled', cls: 'ci-chip-missed' },
        };
        const m = map[status] || { label: status || '—', cls: 'ci-chip-pending' };
        return `<span class="ci-chip-status ${m.cls}">${escapeHtml(m.label)}</span>`;
    }

    function directionIcon(direction) {
        const inbound = direction === 'inbound';
        return `<span class="ci-dir-icon ${inbound ? 'ci-dir-in' : 'ci-dir-out'}" title="${inbound ? 'Incoming' : 'Outgoing'}">
            ${inbound
                ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="7 17 17 7"/><polyline points="7 7 7 17 17 17"/></svg>'
                : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="17 7 7 17"/><polyline points="17 17 17 7 7 7"/></svg>'}
        </span>`;
    }

    // ─── Render ────────────────────────────────────────────────────────────
    function renderRow(c) {
        const isInbound = c.direction === 'inbound';
        const otherPhone = isInbound ? c.from_phone : c.to_phone;
        const playback = c.recording_playback_url || c.recording_url;
        const playerHtml = playback
            ? `<audio controls preload="none" style="height:28px;max-width:200px;" onclick="event.stopPropagation()"><source src="${escapeHtml(playback)}" type="audio/mpeg"></audio>`
            : '<span class="ci-mute">—</span>';
        const leadCell = c.lead_id
            ? `<a class="ci-lead-link" href="leads.html?leadId=${encodeURIComponent(c.lead_id)}" onclick="event.stopPropagation()">View lead →</a>`
            : `<button class="ci-convert-btn" onclick="event.stopPropagation(); openConvertModal('${escapeHtml(c.id)}')">Convert to Lead</button>`;
        return `
            <tr data-call-id="${escapeHtml(c.id)}" onclick="openCallDrawer('${escapeHtml(c.id)}')">
                <td>${directionIcon(c.direction)}</td>
                <td><span class="ci-phone">${escapeHtml(otherPhone || '—')}</span></td>
                <td>${leadCell}</td>
                <td class="hide-mobile"><span class="ci-mute">${c.agent_user_id ? escapeHtml((c.agent_user_id).slice(0,8) + '…') : '—'}</span></td>
                <td><span class="ci-time">${escapeHtml(relTime(c.initiated_at || c.created_at))}</span></td>
                <td>${statusChip(c.status)}</td>
                <td class="hide-mobile">${escapeHtml(fmtDuration(c.duration_seconds))}</td>
                <td>${playerHtml}</td>
                <td><button class="ci-row-action" onclick="event.stopPropagation(); openCallDrawer('${escapeHtml(c.id)}')" aria-label="Open detail">›</button></td>
            </tr>`;
    }

    function renderTable() {
        const tbody = $('ciTbody');
        const wrap = $('ciTableWrap');
        const empty = $('ciEmpty');
        const count = $('ciCount');
        const loadMore = $('ciLoadMore');
        if (!_rows.length) {
            wrap.style.display = 'none';
            empty.style.display = 'block';
            count.textContent = '';
            loadMore.style.display = 'none';
            return;
        }
        tbody.innerHTML = _rows.map(renderRow).join('');
        wrap.style.display = '';
        empty.style.display = 'none';
        count.textContent = `${_rows.length} call${_rows.length === 1 ? '' : 's'}`;
        loadMore.style.display = _hasMore ? '' : 'none';
    }

    // ─── Data load ────────────────────────────────────────────────────────
    async function loadInbox(resetOffset = true) {
        if (resetOffset) {
            _offset = 0;
            _rows = [];
        }
        $('ciLoading').style.display = 'block';
        try {
            const data = await api.request(`/crm/calls/inbox?${buildInboxQuery()}`);
            const rows = Array.isArray(data) ? data : [];
            _rows = resetOffset ? rows : _rows.concat(rows);
            _hasMore = rows.length === PAGE_SIZE;
            renderTable();
        } catch (e) {
            console.warn('[calls-inbox] load failed', e);
            if (typeof Toast !== 'undefined') Toast.error(e?.message || 'Failed to load calls');
        } finally {
            $('ciLoading').style.display = 'none';
        }
    }

    async function loadStats() {
        try {
            const { from, to } = scopeBounds(_scope);
            const params = new URLSearchParams();
            if (from) params.set('from', from);
            if (to) params.set('to', to);
            const s = await api.request(`/crm/calls/inbox/stats?${params.toString()}`);
            $('ciStatTotal').textContent = s.total ?? 0;
            $('ciStatInbound').textContent = s.inbound ?? 0;
            $('ciStatOutbound').textContent = s.outbound ?? 0;
            $('ciStatMissed').textContent = s.missed ?? 0;
            $('ciStatUnmatched').textContent = s.unmatched ?? 0;
        } catch (e) {
            console.warn('[calls-inbox] stats failed', e);
        }
    }

    // ─── Filter chip wiring ────────────────────────────────────────────────
    function setFilter(filter) {
        _filter = filter;
        document.querySelectorAll('.ci-chip').forEach(b => {
            const on = b.getAttribute('data-filter') === filter;
            b.classList.toggle('ci-chip--active', on);
            b.setAttribute('aria-selected', on ? 'true' : 'false');
        });
        loadInbox(true);
    }

    function setScope(scope) {
        _scope = scope;
        loadInbox(true);
        loadStats();
    }

    // ─── Drawer ───────────────────────────────────────────────────────────
    function openCallDrawer(callId) {
        _drawerCallId = callId;
        const c = _rows.find(r => r.id === callId);
        if (!c) return;
        const isInbound = c.direction === 'inbound';
        const otherPhone = isInbound ? c.from_phone : c.to_phone;
        const playback = c.recording_playback_url || c.recording_url;
        const lifecycleStamps = [
            c.initiated_at ? { label: 'Initiated', when: c.initiated_at } : null,
            c.answered_at ? { label: 'Answered', when: c.answered_at } : null,
            c.completed_at ? { label: c.status === 'completed' ? 'Completed' : `Ended (${c.status})`, when: c.completed_at } : null,
        ].filter(Boolean);
        const lifecycleHtml = lifecycleStamps.length
            ? `<ul class="ci-life">${lifecycleStamps.map(s => `<li><span class="ci-life-dot"></span><div><div class="ci-life-label">${escapeHtml(s.label)}</div><div class="ci-life-when">${escapeHtml(new Date(s.when).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }))}</div></div></li>`).join('')}</ul>`
            : '<p class="ci-mute">No lifecycle stamps yet.</p>';
        const leadActionsHtml = c.lead_id
            ? `<a class="btn btn-secondary" href="leads.html?leadId=${encodeURIComponent(c.lead_id)}">Open lead →</a>`
            : `<button class="btn btn-primary" onclick="openConvertModal('${escapeHtml(c.id)}')">Convert to Lead</button>`;
        $('ciDrawerTitle').textContent = `${isInbound ? 'Incoming' : 'Outgoing'} · ${otherPhone || '—'}`;
        $('ciDrawerBody').innerHTML = `
            <div class="ci-drawer-section">
                <div class="ci-drawer-row"><span class="ci-drawer-k">Status</span><span class="ci-drawer-v">${statusChip(c.status)}</span></div>
                <div class="ci-drawer-row"><span class="ci-drawer-k">Duration</span><span class="ci-drawer-v">${escapeHtml(fmtDuration(c.duration_seconds))}</span></div>
                <div class="ci-drawer-row"><span class="ci-drawer-k">From</span><span class="ci-drawer-v">${escapeHtml(c.from_phone || '—')}</span></div>
                <div class="ci-drawer-row"><span class="ci-drawer-k">To</span><span class="ci-drawer-v">${escapeHtml(c.to_phone || '—')}</span></div>
                <div class="ci-drawer-row"><span class="ci-drawer-k">Provider</span><span class="ci-drawer-v">${escapeHtml(c.provider || '—')}</span></div>
                <div class="ci-drawer-row"><span class="ci-drawer-k">Call SID</span><span class="ci-drawer-v ci-mono">${escapeHtml(c.provider_call_sid || '—')}</span></div>
            </div>
            ${playback ? `
            <div class="ci-drawer-section">
                <h4 class="ci-drawer-h">Recording</h4>
                <audio controls preload="none" style="width:100%;"><source src="${escapeHtml(playback)}" type="audio/mpeg"></audio>
            </div>` : ''}
            ${c.transcript ? `
            <div class="ci-drawer-section">
                <h4 class="ci-drawer-h">Transcript</h4>
                <div class="ci-transcript">${escapeHtml(c.transcript)}</div>
            </div>` : ''}
            <div class="ci-drawer-section">
                <h4 class="ci-drawer-h">Lifecycle</h4>
                ${lifecycleHtml}
            </div>
            <div class="ci-drawer-section ci-drawer-actions">
                ${leadActionsHtml}
            </div>
        `;
        $('ciDrawerOverlay').classList.add('active');
        $('ciDrawer').classList.add('active');
    }
    window.openCallDrawer = openCallDrawer;

    function closeCallDrawer() {
        _drawerCallId = null;
        $('ciDrawerOverlay').classList.remove('active');
        $('ciDrawer').classList.remove('active');
    }
    window.closeCallDrawer = closeCallDrawer;

    // ─── Convert to Lead ──────────────────────────────────────────────────
    async function loadTeamsForConvert() {
        if (_teamsCache) return _teamsCache;
        try {
            const teams = await api.request('/crm/teams');
            _teamsCache = Array.isArray(teams) ? teams.filter(t => t.status === 'active') : [];
        } catch (_) {
            _teamsCache = [];
        }
        return _teamsCache;
    }

    async function openConvertModal(callId) {
        const c = _rows.find(r => r.id === callId);
        if (!c) return;
        _convertCallId = callId;
        const phone = c.direction === 'outbound' ? c.to_phone : c.from_phone;
        $('ciConvertSubtitle').textContent = `Create a new lead from ${phone}`;
        $('ciConvertName').value = '';
        const teamSel = $('ciConvertTeam');
        teamSel.innerHTML = '<option value="">— Don\'t assign yet —</option>';
        const teams = await loadTeamsForConvert();
        teams.forEach(t => {
            const opt = document.createElement('option');
            opt.value = t.id;
            opt.textContent = t.team_name;
            teamSel.appendChild(opt);
        });
        $('ciConvertOverlay').classList.add('active');
    }
    window.openConvertModal = openConvertModal;

    function closeConvertModal() {
        _convertCallId = null;
        $('ciConvertOverlay').classList.remove('active');
    }
    window.closeConvertModal = closeConvertModal;

    async function submitConvertToLead() {
        if (!_convertCallId) return;
        const btn = $('ciConvertSubmit');
        btn.disabled = true;
        btn.textContent = 'Creating…';
        try {
            const body = {
                customer_name: $('ciConvertName').value.trim() || null,
                team_id: $('ciConvertTeam').value || null,
            };
            const resp = await api.request(`/crm/calls/${_convertCallId}/convert-to-lead`, {
                method: 'POST',
                body: JSON.stringify(body),
            });
            if (resp && resp.success) {
                const msg = resp.alreadyExisted
                    ? (resp.assigned ? 'Already a lead — team assigned' : 'Already a lead')
                    : (resp.assigned ? 'Converted to lead and assigned to team' : 'Converted to lead');
                if (typeof Toast !== 'undefined') Toast.success(msg);
            }
            closeConvertModal();
            await loadInbox(true);
            await loadStats();
        } catch (e) {
            if (typeof Toast !== 'undefined') Toast.error(e?.message || 'Convert failed');
        } finally {
            btn.disabled = false;
            btn.textContent = 'Create Lead';
        }
    }
    window.submitConvertToLead = submitConvertToLead;

    // ─── SignalR real-time ────────────────────────────────────────────────
    function bindRealtime() {
        if (_signalRBound) return;
        if (typeof signalR === 'undefined') return;
        const tokenFn = typeof getAuthToken === 'function' ? getAuthToken : () => null;
        if (!tokenFn()) return;
        const hubUrl = (typeof CONFIG !== 'undefined' && CONFIG.crmSignalRHubUrl) || null;
        if (!hubUrl) return;

        // Reuse an existing CrmHub connection if leads.js (or any other module
        // on a previous page) parked one on window. Otherwise stand one up
        // here — calls.html is a standalone page so there usually isn't.
        let conn = window._crmHubConnection;
        const isAlive = conn && conn.state && conn.state !== signalR.HubConnectionState.Disconnected;
        if (!isAlive) {
            conn = new signalR.HubConnectionBuilder()
                .withUrl(hubUrl, { accessTokenFactory: tokenFn })
                .withAutomaticReconnect()
                .configureLogging(signalR.LogLevel.Warning)
                .build();
            window._crmHubConnection = conn;
            conn.start().catch(e => console.warn('[calls-inbox] SignalR start failed:', e?.message || e));
        }

        // CallEventReceived fires on every webhook hit — initiated/ringing/
        // answered/completed/recording_ready. Cheapest correct response is
        // to refresh the list + stats; over a 50-row page that's a sub-100ms
        // round-trip, well under the user's perception threshold.
        conn.on('CallEventReceived', () => {
            loadInbox(true);
            loadStats();
        });
        _signalRBound = true;
    }

    // ─── Bootstrap ────────────────────────────────────────────────────────
    document.addEventListener('DOMContentLoaded', () => {
        // Render top nav (Navigation.init reads currentPageId/basePath and
        // populates .navbar-menu).
        if (typeof Navigation !== 'undefined' && Navigation.init) {
            Navigation.init('crm', '../../');
        }

        // Chip click → switch filter.
        document.querySelectorAll('.ci-chip').forEach(btn => {
            btn.addEventListener('click', () => setFilter(btn.getAttribute('data-filter')));
        });
        // Stat card click → switch filter chip below. Keyboard ENTER/SPACE
        // also fires since the cards have role="button" + tabindex=0.
        document.querySelectorAll('.ci-stat-clickable').forEach(card => {
            const fire = () => setFilter(card.getAttribute('data-quickfilter'));
            card.addEventListener('click', fire);
            card.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fire(); }
            });
        });
        // Scope dropdown.
        $('ciScope').addEventListener('change', (e) => setScope(e.target.value));
        // Search box: debounce 300ms so we're not spamming the server on every keystroke.
        $('ciSearch').addEventListener('input', (e) => {
            clearTimeout(_searchTimer);
            const v = (e.target.value || '').trim();
            _searchTimer = setTimeout(() => {
                _searchTerm = v;
                loadInbox(true);
            }, 300);
        });
        // Load more.
        $('ciLoadMore').addEventListener('click', () => {
            _offset += PAGE_SIZE;
            loadInbox(false);
        });

        loadInbox(true);
        loadStats();
        bindRealtime();

        // CRM_ADMIN-only "Retry failed" button. Surface it as soon as
        // we can confirm the role; CONFIG.getUser() reads the cached
        // user payload from login, no extra round-trip.
        wireRetryFailedButton();
    });

    function wireRetryFailedButton() {
        const btn = document.getElementById('ciRetryFailedBtn');
        if (!btn) return;
        const user = (typeof CONFIG !== 'undefined' && CONFIG.getUser) ? CONFIG.getUser() : null;
        const roles = (user && (user.roles || user.Roles)) || [];
        const isAdmin = roles.some(r => r === 'CRM_ADMIN' || r === 'SUPERADMIN');
        if (!isAdmin) return; // stays hidden for non-admins
        btn.style.display = '';
        btn.addEventListener('click', async () => {
            const ok = typeof Confirm !== 'undefined' && Confirm.show
                ? await Confirm.show({
                    title: 'Retry every failed transcription?',
                    message: 'Each call with transcript_status=failed will be re-queued. Calls under the 20-second AI floor or without a recording are skipped automatically.',
                    confirmLabel: 'Retry all failed',
                    confirmStyle: 'primary'
                })
                : confirm('Retry every failed transcription?');
            if (!ok) return;
            btn.disabled = true;
            try {
                const r = await api.request('/crm/calls/retry-failed-transcripts', { method: 'POST' });
                const parts = [`Re-queued ${r.enqueued ?? 0}`];
                if (r.skipped_no_recording) parts.push(`skipped (no recording): ${r.skipped_no_recording}`);
                if (r.skipped_too_short)    parts.push(`skipped (under 20s): ${r.skipped_too_short}`);
                if (typeof Toast !== 'undefined' && Toast.success) Toast.success(parts.join(' · '));
                else alert(parts.join('\n'));
                // Refresh after a brief delay so the user sees status flip to pending.
                setTimeout(() => { loadInbox(true); loadStats(); }, 800);
            } catch (e) {
                const msg = (e && (e.message || e.toString())) || 'Retry failed';
                if (typeof Toast !== 'undefined' && Toast.error) Toast.error(msg);
                else alert(msg);
            } finally {
                btn.disabled = false;
            }
        });
    }
})();
