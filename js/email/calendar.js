/**
 * Email Calendar — month / week / day views of scheduled meetings.
 *
 * Uses theme tokens end-to-end (no hardcoded colors). Pulls meetings via
 * GET /email/meetings?range_start=&range_end= and groups them by day for
 * the grid render. Click a meeting → details modal with Join / Cancel.
 *
 * View switching keeps the "anchor" date (currentDate) in sync so bouncing
 * between month/week/day never jumps to Today unless the user clicks Today.
 */
(function () {
    const State = {
        view: 'month',          // month | week | day
        currentDate: new Date(),
        meetings: [],           // loaded for the visible range
        rangeStart: null,
        rangeEnd: null,
    };

    const $ = (id) => document.getElementById(id);

    document.addEventListener('DOMContentLoaded', init);

    async function init() {
        wireToolbar();
        wireScheduleModal();   // schedule modal lives on this page too
        wireMeetingDetailModal();
        await render();
    }

    // ---------------------------------------------------------------
    // Toolbar
    // ---------------------------------------------------------------
    function wireToolbar() {
        $('calPrev').addEventListener('click', () => { shift(-1); render(); });
        $('calNext').addEventListener('click', () => { shift(+1); render(); });
        $('calTodayBtn').addEventListener('click', () => { State.currentDate = new Date(); render(); });
        $('calNewBtn').addEventListener('click', openScheduleMeetingModal);
        document.querySelectorAll('.cal-view-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.cal-view-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                State.view = btn.dataset.view;
                render();
            });
        });
    }

    function shift(direction) {
        const d = new Date(State.currentDate);
        if (State.view === 'month') d.setMonth(d.getMonth() + direction);
        else if (State.view === 'week') d.setDate(d.getDate() + 7 * direction);
        else d.setDate(d.getDate() + direction);
        State.currentDate = d;
    }

    // ---------------------------------------------------------------
    // Rendering
    // ---------------------------------------------------------------
    async function render() {
        updateTitle();
        computeRange();
        $('calMain').innerHTML = '<div class="calendar-skeleton">Loading…</div>';
        try {
            State.meetings = await fetchMeetings(State.rangeStart, State.rangeEnd);
        } catch (err) {
            $('calMain').innerHTML = `<div class="calendar-empty">Could not load meetings: ${escapeHtml(err.message || 'unknown error')}</div>`;
            return;
        }
        if (State.view === 'month') renderMonth();
        else if (State.view === 'week') renderWeek();
        else renderDay();
    }

    function updateTitle() {
        const d = State.currentDate;
        if (State.view === 'month') {
            $('calTitle').textContent = d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
        } else if (State.view === 'week') {
            const ws = startOfWeek(d);
            const we = new Date(ws); we.setDate(ws.getDate() + 6);
            const same = ws.getMonth() === we.getMonth();
            const left = ws.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
            const right = same
                ? we.toLocaleDateString(undefined, { day: 'numeric', year: 'numeric' })
                : we.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
            $('calTitle').textContent = `${left} – ${right}`;
        } else {
            $('calTitle').textContent = d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
        }
    }

    function computeRange() {
        if (State.view === 'month') {
            const first = startOfMonth(State.currentDate);
            const last = endOfMonth(State.currentDate);
            // pad to grid (6 rows × 7 cols)
            const gridStart = startOfWeek(first);
            const gridEnd = new Date(gridStart); gridEnd.setDate(gridStart.getDate() + 41);
            State.rangeStart = gridStart; State.rangeEnd = gridEnd;
        } else if (State.view === 'week') {
            State.rangeStart = startOfWeek(State.currentDate);
            State.rangeEnd = new Date(State.rangeStart); State.rangeEnd.setDate(State.rangeStart.getDate() + 6);
        } else {
            State.rangeStart = startOfDay(State.currentDate);
            State.rangeEnd = endOfDay(State.currentDate);
        }
    }

    function renderMonth() {
        const gridStart = State.rangeStart;
        const html = [];
        const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        html.push('<div class="cal-month-grid">');
        html.push('<div class="cal-month-weekdays">');
        for (const wd of weekdays) html.push(`<div class="cal-weekday">${wd}</div>`);
        html.push('</div>');

        html.push('<div class="cal-month-cells">');
        const today = startOfDay(new Date()).getTime();
        const currentMonth = State.currentDate.getMonth();
        for (let i = 0; i < 42; i++) {
            const d = new Date(gridStart); d.setDate(gridStart.getDate() + i);
            const isoDay = fmtISODate(d);
            const dayMeetings = State.meetings.filter(m => fmtISODate(new Date(m.start_time)) === isoDay)
                                               .sort((a,b) => new Date(a.start_time) - new Date(b.start_time));
            const isToday = startOfDay(d).getTime() === today;
            const isOtherMonth = d.getMonth() !== currentMonth;
            html.push(`<div class="cal-day ${isToday ? 'is-today' : ''} ${isOtherMonth ? 'is-other-month' : ''}" data-date="${isoDay}">`);
            html.push(`<div class="cal-day-num">${d.getDate()}</div>`);
            html.push('<div class="cal-day-events">');
            for (const m of dayMeetings.slice(0, 3)) {
                html.push(renderMeetingChip(m));
            }
            if (dayMeetings.length > 3) {
                html.push(`<div class="cal-day-more">+${dayMeetings.length - 3} more</div>`);
            }
            html.push('</div>');
            html.push('</div>');
        }
        html.push('</div>');
        html.push('</div>');

        $('calMain').innerHTML = html.join('');
        attachMeetingHandlers();
        document.querySelectorAll('.cal-day').forEach(cell => {
            cell.addEventListener('click', (e) => {
                if (e.target.closest('.cal-event')) return;
                const iso = cell.dataset.date;
                const d = new Date(iso);
                State.currentDate = d;
                State.view = 'day';
                document.querySelectorAll('.cal-view-btn').forEach(b => b.classList.toggle('active', b.dataset.view === 'day'));
                render();
            });
        });
    }

    function renderWeek() {
        const start = State.rangeStart;
        const html = ['<div class="cal-week">'];
        html.push('<div class="cal-week-header">');
        html.push('<div class="cal-week-gutter"></div>');
        for (let i = 0; i < 7; i++) {
            const d = new Date(start); d.setDate(start.getDate() + i);
            const isToday = sameDay(d, new Date());
            html.push(`<div class="cal-week-day ${isToday ? 'is-today' : ''}">
                <div class="cal-week-day-name">${d.toLocaleDateString(undefined, { weekday: 'short' })}</div>
                <div class="cal-week-day-num">${d.getDate()}</div>
            </div>`);
        }
        html.push('</div>');

        html.push('<div class="cal-week-body">');
        html.push('<div class="cal-week-hours">');
        for (let h = 0; h < 24; h++) html.push(`<div class="cal-week-hour">${fmtHour(h)}</div>`);
        html.push('</div>');
        html.push('<div class="cal-week-grid">');
        for (let i = 0; i < 7; i++) {
            const d = new Date(start); d.setDate(start.getDate() + i);
            const iso = fmtISODate(d);
            const dayMeetings = State.meetings.filter(m => fmtISODate(new Date(m.start_time)) === iso);
            html.push(`<div class="cal-week-col" data-date="${iso}">`);
            for (let h = 0; h < 24; h++) html.push('<div class="cal-week-slot"></div>');
            for (const m of dayMeetings) {
                const s = new Date(m.start_time);
                const e = new Date(m.end_time);
                const top = (s.getHours() + s.getMinutes() / 60) * 48;
                const dur = Math.max(((e - s) / 3600000), 0.5) * 48;
                html.push(`<div class="cal-event cal-event-positioned" data-id="${m.id}"
                    style="top:${top}px; height:${dur - 2}px;" title="${escapeHtml(m.title)}">
                    <div class="cal-event-time">${fmtTime(s)}</div>
                    <div class="cal-event-title">${escapeHtml(m.title)}</div>
                </div>`);
            }
            html.push('</div>');
        }
        html.push('</div>');
        html.push('</div>');
        html.push('</div>');

        $('calMain').innerHTML = html.join('');
        attachMeetingHandlers();
    }

    function renderDay() {
        const d = State.currentDate;
        const iso = fmtISODate(d);
        const dayMeetings = State.meetings.filter(m => fmtISODate(new Date(m.start_time)) === iso)
                                            .sort((a,b) => new Date(a.start_time) - new Date(b.start_time));

        const html = ['<div class="cal-day-view">'];
        html.push('<div class="cal-day-hours">');
        for (let h = 0; h < 24; h++) html.push(`<div class="cal-week-hour">${fmtHour(h)}</div>`);
        html.push('</div>');
        html.push('<div class="cal-day-canvas" data-date="'+iso+'">');
        for (let h = 0; h < 24; h++) html.push('<div class="cal-week-slot"></div>');
        for (const m of dayMeetings) {
            const s = new Date(m.start_time);
            const e = new Date(m.end_time);
            const top = (s.getHours() + s.getMinutes() / 60) * 56;
            const dur = Math.max(((e - s) / 3600000), 0.5) * 56;
            html.push(`<div class="cal-event cal-event-positioned cal-event-large" data-id="${m.id}"
                style="top:${top}px; height:${dur - 4}px;">
                <div class="cal-event-time">${fmtTime(s)} – ${fmtTime(e)}</div>
                <div class="cal-event-title">${escapeHtml(m.title)}</div>
                ${m.participants && m.participants.length ? `<div class="cal-event-meta">${m.participants.length} participant${m.participants.length === 1 ? '' : 's'}</div>` : ''}
            </div>`);
        }
        html.push('</div>');
        html.push('</div>');

        if (dayMeetings.length === 0) {
            html.push(`<div class="cal-day-empty">No meetings scheduled for ${d.toLocaleDateString(undefined, { month: 'long', day: 'numeric' })}.</div>`);
        }

        $('calMain').innerHTML = html.join('');
        attachMeetingHandlers();
    }

    function renderMeetingChip(m) {
        const s = new Date(m.start_time);
        const cancelled = m.status === 'cancelled';
        const external = m.source === 'external';
        return `<div class="cal-event ${cancelled ? 'cal-event-cancelled' : ''} ${external ? 'cal-event-external' : ''}" data-id="${m.id}" title="${escapeHtml(m.title)}${external ? ' (external)' : ''}">
            <span class="cal-event-dot"></span>
            <span class="cal-event-time">${fmtTime(s)}</span>
            <span class="cal-event-title">${escapeHtml(m.title)}</span>
        </div>`;
    }

    function attachMeetingHandlers() {
        document.querySelectorAll('.cal-event[data-id]').forEach(el => {
            el.addEventListener('click', (e) => {
                e.stopPropagation();
                const id = el.dataset.id;
                const m = State.meetings.find(x => x.id === id);
                if (m) openMeetingDetail(m);
            });
        });
    }

    // ---------------------------------------------------------------
    // Meeting detail modal
    // ---------------------------------------------------------------
    let _currentMeeting = null;

    function wireMeetingDetailModal() {
        const overlay = $('meetingDetailOverlay');
        if (overlay.parentElement !== document.body) document.body.appendChild(overlay);

        $('meetingDetailClose').addEventListener('click', closeMeetingDetail);
        $('meetingDetailCancel').addEventListener('click', closeMeetingDetail);
        $('meetingDetailBackdrop').addEventListener('click', closeMeetingDetail);
        $('meetingDetailDelete').addEventListener('click', onCancelMeeting);
    }

    function openMeetingDetail(m) {
        _currentMeeting = m;
        $('meetingDetailTitle').textContent = m.title;
        const s = new Date(m.start_time);
        const e = new Date(m.end_time);
        const whenStr = `${s.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })} · ${fmtTime(s)} – ${fmtTime(e)}`;
        const agendaHtml = m.agenda ? `<div class="meeting-detail-row"><label>Agenda</label><div class="meeting-detail-val">${escapeHtml(m.agenda).replace(/\n/g, '<br/>')}</div></div>` : '';
        const statusBadge = m.status === 'cancelled'
            ? '<span class="cal-badge cal-badge-cancelled">Cancelled</span>'
            : '<span class="cal-badge cal-badge-scheduled">Scheduled</span>';
        const sourceBadge = m.source === 'external'
            ? ' <span class="cal-badge cal-badge-external">External invite</span>'
            : '';
        const organizerRow = m.source === 'external' && m.organizer_email
            ? `<div class="meeting-detail-row"><label>Organizer</label><div class="meeting-detail-val">${escapeHtml(m.organizer_email)}</div></div>`
            : '';
        const linkRow = m.meeting_url
            ? `<div class="meeting-detail-row"><label>Meeting link</label>
                <div class="meeting-detail-val">
                    <a href="${m.meeting_url}" target="_blank" rel="noopener">${escapeHtml(m.meeting_url)}</a>
                    <button type="button" class="btn btn-xs" id="meetingDetailCopy" style="margin-left:8px">Copy</button>
                </div>
            </div>`
            : '';

        $('meetingDetailBody').innerHTML = `
            ${statusBadge}${sourceBadge}
            <div class="meeting-detail-row"><label>When</label><div class="meeting-detail-val">${escapeHtml(whenStr)}</div></div>
            ${organizerRow}
            ${agendaHtml}
            <div class="meeting-detail-row"><label>Participants</label>
                <div class="meeting-detail-val">${(m.participants || []).map(p => `<span class="chip">${escapeHtml(p)}</span>`).join('') || '<span style="color:var(--text-tertiary);font-size:12px">(none listed in the invite)</span>'}</div>
            </div>
            ${linkRow}
        `;
        const joinBtn = $('meetingDetailJoin');
        if (m.meeting_url) {
            joinBtn.href = m.meeting_url;
            joinBtn.style.display = '';
        } else {
            joinBtn.style.display = 'none';
        }
        const delBtn = $('meetingDetailDelete');
        // Only internal meetings can be cancelled — we can't touch someone
        // else's Google Calendar event, so hide the button for externals.
        const canCancel = m.status !== 'cancelled' && m.source !== 'external';
        delBtn.style.display = canCancel ? '' : 'none';

        const copyBtn = $('meetingDetailCopy');
        if (copyBtn) copyBtn.addEventListener('click', () => {
            navigator.clipboard.writeText(m.meeting_url).then(() => {
                if (window.Toast) Toast.success('Meeting link copied');
            });
        });

        $('meetingDetailOverlay').classList.add('active');
    }

    function closeMeetingDetail() {
        $('meetingDetailOverlay').classList.remove('active');
        _currentMeeting = null;
    }

    async function onCancelMeeting() {
        if (!_currentMeeting) return;
        const ok = window.Toast && Toast.Confirm
            ? await Toast.Confirm.danger({
                title: 'Cancel meeting?',
                message: 'Participants will NOT be notified automatically. This marks the meeting cancelled in your calendar.',
                confirmText: 'Cancel meeting'
            })
            : confirm('Cancel this meeting?');
        if (!ok) return;

        try {
            await api.request(`/email/meetings/${_currentMeeting.id}`, { method: 'DELETE' });
            if (window.Toast) Toast.success('Meeting cancelled');
            closeMeetingDetail();
            await render();
        } catch (err) {
            if (window.Toast) Toast.error(err.message || 'Could not cancel meeting');
        }
    }

    // ---------------------------------------------------------------
    // Schedule modal (same contract as inbox.js — copied so this page
    // works standalone without importing all of inbox.js)
    // ---------------------------------------------------------------
    const ScheduleState = { participants: [] };

    function wireScheduleModal() {
        const overlay = $('scheduleMeetingOverlay');
        if (overlay.parentElement !== document.body) document.body.appendChild(overlay);
        $('scheduleMeetingClose').addEventListener('click', closeScheduleMeetingModal);
        $('scheduleMeetingCancel').addEventListener('click', closeScheduleMeetingModal);
        $('scheduleMeetingBackdrop').addEventListener('click', closeScheduleMeetingModal);
        $('scheduleMeetingSubmit').addEventListener('click', submitScheduleMeeting);

        const chipInput = $('meetingParticipantsInput');
        const field = $('meetingParticipantsField');
        field.addEventListener('click', () => chipInput.focus());
        chipInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ',' || e.key === ' ') {
                const v = chipInput.value.trim().replace(/,$/, '');
                if (v) { e.preventDefault(); addMeetingParticipant(v); chipInput.value = ''; }
            } else if (e.key === 'Backspace' && !chipInput.value && ScheduleState.participants.length > 0) {
                ScheduleState.participants.pop();
                renderMeetingParticipants();
            }
        });
        chipInput.addEventListener('blur', () => {
            const v = chipInput.value.trim();
            if (v) { addMeetingParticipant(v); chipInput.value = ''; }
        });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && overlay.classList.contains('active')) closeScheduleMeetingModal();
        });
    }

    function openScheduleMeetingModal() {
        ScheduleState.participants = [];
        renderMeetingParticipants();
        $('meetingTitle').value = '';
        $('meetingAgenda').value = '';
        const err = $('scheduleMeetingError'); err.style.display = 'none'; err.textContent = '';

        const now = new Date();
        const roundedMin = Math.ceil((now.getMinutes() + 5) / 30) * 30;
        const start = new Date(now); start.setMinutes(roundedMin, 0, 0);
        const end = new Date(start.getTime() + 30 * 60000);
        $('meetingDate').value = fmtISODate(start);
        $('meetingStartTime').value = fmtTimeInput(start);
        $('meetingEndTime').value = fmtTimeInput(end);

        $('scheduleMeetingOverlay').classList.add('active');
        setTimeout(() => $('meetingTitle').focus(), 50);
    }
    function closeScheduleMeetingModal() { $('scheduleMeetingOverlay').classList.remove('active'); }

    function addMeetingParticipant(raw) {
        const parts = raw.split(/[\s,;]+/).map(s => s.trim()).filter(Boolean);
        for (const email of parts) {
            if (!/^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$/.test(email)) {
                showErr(`'${email}' is not a valid email address`); continue;
            }
            if (!ScheduleState.participants.some(p => p.toLowerCase() === email.toLowerCase())) {
                ScheduleState.participants.push(email);
            }
        }
        renderMeetingParticipants();
    }
    function renderMeetingParticipants() {
        const wrap = $('meetingParticipantsList');
        wrap.innerHTML = ScheduleState.participants.map((p, i) => `
            <span class="chip" data-idx="${i}">${escapeHtml(p)}<button type="button" class="chip-remove" data-idx="${i}" aria-label="Remove">&times;</button></span>
        `).join('');
        wrap.querySelectorAll('.chip-remove').forEach(btn => {
            btn.addEventListener('click', () => {
                ScheduleState.participants.splice(+btn.dataset.idx, 1);
                renderMeetingParticipants();
            });
        });
    }
    function showErr(msg) {
        const el = $('scheduleMeetingError'); el.textContent = msg; el.style.display = '';
    }

    async function submitScheduleMeeting() {
        const el = $('scheduleMeetingError'); el.textContent = ''; el.style.display = 'none';
        const title = $('meetingTitle').value.trim();
        const agenda = $('meetingAgenda').value.trim();
        const date = $('meetingDate').value;
        const startS = $('meetingStartTime').value;
        const endS = $('meetingEndTime').value;
        const chipInput = $('meetingParticipantsInput');
        if (chipInput.value.trim()) { addMeetingParticipant(chipInput.value); chipInput.value = ''; }

        if (!title) return showErr('Title is required');
        if (!date || !startS || !endS) return showErr('Date, start and end time are required');
        if (ScheduleState.participants.length === 0) return showErr('Add at least one participant');

        const s = new Date(`${date}T${startS}:00`);
        const e = new Date(`${date}T${endS}:00`);
        if (isNaN(s) || isNaN(e)) return showErr('Invalid date/time');
        if (e <= s) return showErr('End time must be after start time');

        const btn = $('scheduleMeetingSubmit');
        btn.disabled = true;
        const orig = btn.innerHTML;
        btn.innerHTML = 'Creating...';
        try {
            await api.request('/email/meetings', {
                method: 'POST',
                body: JSON.stringify({
                    title, agenda: agenda || null,
                    start_time: s.toISOString(), end_time: e.toISOString(),
                    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                    participants: ScheduleState.participants
                })
            });
            closeScheduleMeetingModal();
            if (window.Toast) Toast.success('Meeting scheduled — invites sent');
            await render();
        } catch (err) {
            showErr((err && (err.message || err.error)) || 'Failed to create meeting');
        } finally {
            btn.disabled = false; btn.innerHTML = orig;
        }
    }

    // ---------------------------------------------------------------
    // Data
    // ---------------------------------------------------------------
    async function fetchMeetings(rangeStart, rangeEnd) {
        const qs = new URLSearchParams();
        if (rangeStart) qs.set('range_start', rangeStart.toISOString());
        if (rangeEnd)   qs.set('range_end',   rangeEnd.toISOString());
        qs.set('limit', '500');
        const list = await api.request(`/email/meetings?${qs.toString()}`);
        return Array.isArray(list) ? list : (list?.items || []);
    }

    // ---------------------------------------------------------------
    // Helpers
    // ---------------------------------------------------------------
    function startOfDay(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
    function endOfDay(d)   { const x = new Date(d); x.setHours(23, 59, 59, 999); return x; }
    function startOfMonth(d){ const x = new Date(d); x.setDate(1); x.setHours(0,0,0,0); return x; }
    function endOfMonth(d) { const x = new Date(d); x.setMonth(x.getMonth()+1, 0); x.setHours(23,59,59,999); return x; }
    function startOfWeek(d){ const x = new Date(d); const day = x.getDay(); x.setDate(x.getDate() - day); x.setHours(0,0,0,0); return x; }
    function sameDay(a, b) { return startOfDay(a).getTime() === startOfDay(b).getTime(); }

    function fmtISODate(d) {
        return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    }
    function fmtTimeInput(d) {
        return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
    }
    function fmtTime(d) {
        return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    }
    function fmtHour(h) {
        const d = new Date(); d.setHours(h, 0, 0, 0);
        return d.toLocaleTimeString(undefined, { hour: 'numeric' });
    }
    function escapeHtml(s) {
        return String(s || '').replace(/[&<>"']/g, c => ({
            '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
        }[c]));
    }
})();
