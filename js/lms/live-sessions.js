// LMS Live Sessions JavaScript

let sessions = [];

document.addEventListener('DOMContentLoaded', async () => {
    Navigation.init('lms', '../');
    if (!api.isAuthenticated()) {
        window.location.href = '../login.html';
        return;
    }

    // Initialize roles and show schedule button for instructors
    lmsRoles.init();
    if (lmsRoles.isInstructor()) {
        const btn = document.getElementById('btnScheduleSession');
        if (btn) btn.style.display = '';
    }

    await loadSessions();
});

/**
 * Load all live sessions
 */
async function loadSessions() {
    const upcomingGrid = document.getElementById('upcomingSessionsGrid');
    const pastGrid = document.getElementById('pastSessionsGrid');

    try {
        const data = await api.request('/lms/live-sessions');
        sessions = (data.sessions || data || []).map(s => ({
            ...s,
            scheduled_at: s.scheduledAt || s.scheduled_at,
            duration_minutes: s.durationMinutes || s.duration_minutes,
            instructor_name: s.instructorName || s.instructor_name,
            course_title: s.courseTitle || s.course_title,
            recording_url: s.recordingUrl || s.recording_url,
            course_id: s.courseId || s.course_id,
            max_attendees: s.maxAttendees || s.max_attendees
        }));

        const now = new Date();
        const upcoming = sessions.filter(s => new Date(s.scheduled_at) > now);
        const past = sessions.filter(s => new Date(s.scheduled_at) <= now);

        // Sort upcoming by date ascending
        upcoming.sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at));
        // Sort past by date descending
        past.sort((a, b) => new Date(b.scheduled_at) - new Date(a.scheduled_at));

        // Render upcoming sessions
        if (upcoming.length === 0) {
            upcomingGrid.innerHTML = `
                <div class="empty-state">
                    <p>No upcoming live sessions</p>
                </div>`;
        } else {
            upcomingGrid.innerHTML = upcoming.map(renderUpcomingSession).join('');
        }

        // Render past sessions
        if (past.length === 0) {
            pastGrid.innerHTML = `
                <div class="empty-state">
                    <p>No past sessions</p>
                </div>`;
        } else {
            pastGrid.innerHTML = past.map(renderPastSession).join('');
        }
    } catch (error) {
        console.error('Error loading sessions:', error);
        upcomingGrid.innerHTML = '<div class="empty-state"><p>Error loading sessions</p></div>';
        pastGrid.innerHTML = '';
        showToast('Error loading live sessions', 'error');
    }
}

/**
 * Render an upcoming session card
 */
function renderUpcomingSession(session) {
    const date = formatSessionDate(session.scheduled_at);
    const duration = session.duration_minutes ? `${session.duration_minutes} min` : '';
    const isLive = isSessionLive(session);
    const cancelled = isSessionCancelled(session);
    const statusBadge = cancelled
        ? '<span class="session-badge session-cancelled">Cancelled</span>'
        : isLive
            ? '<span class="session-badge session-live">LIVE NOW</span>'
            : '<span class="session-badge session-upcoming">Upcoming</span>';

    return `
        <div class="session-card">
            <div class="session-card-header">
                ${statusBadge}
                <span class="session-duration">${duration}</span>
            </div>
            <h4 class="session-title">${escapeHtml(session.title)}</h4>
            <div class="session-meta">
                <div class="session-meta-item">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
                        <line x1="16" y1="2" x2="16" y2="6"/>
                        <line x1="8" y1="2" x2="8" y2="6"/>
                        <line x1="3" y1="10" x2="21" y2="10"/>
                    </svg>
                    ${date}
                </div>
                <div class="session-meta-item">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/>
                        <circle cx="12" cy="7" r="4"/>
                    </svg>
                    ${escapeHtml(session.instructor_name || 'Instructor')}
                </div>
                ${session.course_title ? `
                <div class="session-meta-item">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M2 3h6a4 4 0 014 4v14a3 3 0 00-3-3H2z"/>
                        <path d="M22 3h-6a4 4 0 00-4 4v14a3 3 0 013-3h7z"/>
                    </svg>
                    ${escapeHtml(session.course_title)}
                </div>` : ''}
            </div>
            ${session.description ? `<p class="session-description">${escapeHtml(truncate(session.description, 120))}</p>` : ''}
            <div class="session-card-footer">
                ${cancelled
                    ? '<span class="text-muted" style="font-size:12.5px;">This session was cancelled.</span>'
                    : `<button class="btn btn-primary" onclick="${isLive ? `joinSession('${session.id}')` : `registerForSession('${session.id}')`}">
                        ${isLive ? 'Join Now' : 'Register'}
                       </button>
                       ${isLive ? '' : `<button class="btn btn-secondary btn-sm" onclick="cancelSessionRegistration('${session.id}')">Cancel my seat</button>`}`}
            </div>
            ${renderSessionAdminActions(session)}
        </div>`;
}

/**
 * Render a past session card
 */
function renderPastSession(session) {
    const date = formatSessionDate(session.scheduled_at);
    const hasRecording = session.recording_url;

    return `
        <div class="session-card session-past">
            <div class="session-card-header">
                <span class="session-badge session-ended">Ended</span>
            </div>
            <h4 class="session-title">${escapeHtml(session.title)}</h4>
            <div class="session-meta">
                <div class="session-meta-item">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
                        <line x1="16" y1="2" x2="16" y2="6"/>
                        <line x1="8" y1="2" x2="8" y2="6"/>
                        <line x1="3" y1="10" x2="21" y2="10"/>
                    </svg>
                    ${date}
                </div>
                <div class="session-meta-item">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/>
                        <circle cx="12" cy="7" r="4"/>
                    </svg>
                    ${escapeHtml(session.instructor_name || 'Instructor')}
                </div>
            </div>
            <div class="session-card-footer">
                ${hasRecording ? `
                    <a href="${escapeHtml(session.recording_url)}" class="btn-secondary" target="_blank">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polygon points="5 3 19 12 5 21 5 3"/>
                        </svg>
                        Watch Recording
                    </a>` : '<span class="text-muted">No recording available</span>'}
            </div>
        </div>`;
}

/**
 * Join a live session
 */
async function joinSession(sessionId) {
    try {
        const data = await api.request(`/lms/live-sessions/${sessionId}/join`, {
            method: 'POST'
        });
        if (data.join_url) {
            window.open(data.join_url, '_blank');
        } else {
            showToast('Registered for session successfully', 'success');
            await loadSessions();
        }
    } catch (error) {
        console.error('Error joining session:', error);
        showToast('Error joining session', 'error');
    }
}

/**
 * Show schedule session modal
 */
function showScheduleModal() {
    document.getElementById('sessionTitle').value = '';
    HRMSDatePicker.setDateTimeValue('sessionDate', '');
    document.getElementById('sessionDuration').value = '60';
    document.getElementById('sessionDescription').value = '';
    loadCourseOptions();
    document.getElementById('scheduleSessionModal').style.display = 'flex';
}

/**
 * Close schedule session modal
 */
function closeScheduleModal() {
    document.getElementById('scheduleSessionModal').style.display = 'none';
}

/**
 * Load course options for the schedule form
 */
async function loadCourseOptions() {
    const select = document.getElementById('sessionCourse');
    try {
        const data = await api.request('/lms/courses');
        const courses = data.courses || data || [];
        select.innerHTML = '<option value="">Select a course</option>';
        courses.forEach(c => {
            select.innerHTML += `<option value="${c.id}">${escapeHtml(c.title)}</option>`;
        });
    } catch (error) {
        console.error('Error loading courses:', error);
    }
}

/**
 * Schedule a new live session
 */
async function scheduleSession() {
    const title = document.getElementById('sessionTitle').value.trim();
    const courseId = document.getElementById('sessionCourse').value;
    const sessionErr = HRMSDatePicker.validateDateTimePair('sessionDate', 'Date & Time');
    if (sessionErr) { showToast(sessionErr, 'error'); return; }
    const scheduledAt = HRMSDatePicker.getDateTimeValue('sessionDate');
    const duration = parseInt(document.getElementById('sessionDuration').value) || 60;
    const description = document.getElementById('sessionDescription').value.trim();

    if (!title) {
        showToast('Please enter a session title', 'error');
        return;
    }
    if (!scheduledAt) {
        showToast('Please select a date and time', 'error');
        return;
    }

    const btn = document.getElementById('btnSubmitSession');
    btn.disabled = true;
    btn.textContent = 'Scheduling...';

    try {
        await api.request('/lms/live-sessions', {
            method: 'POST',
            body: JSON.stringify({
                title,
                courseId: courseId || null,
                scheduledAt: new Date(scheduledAt).toISOString(),
                durationMinutes: duration,
                description: description || null
            })
        });
        showToast('Session scheduled successfully', 'success');
        closeScheduleModal();
        await loadSessions();
    } catch (error) {
        console.error('Error scheduling session:', error);
        showToast('Error scheduling session', 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Schedule';
    }
}

// ==================== Utility Functions ====================

/**
 * Whether a learner can join right now.
 *
 * The STATUS the instructor set wins over the clock, in both directions. This
 * used to read the scheduled time alone and ignore status entirely, which meant
 * the field the backend keeps — and the control an instructor uses — changed
 * nothing a learner could see: opening a session early did nothing, and a
 * CANCELLED session still offered a join button at its scheduled hour.
 */
function isSessionLive(session) {
    const status = session.status || session.Status;
    if (status === 'live') return true;                       // opened by the instructor
    if (status === 'cancelled' || status === 'completed') return false;

    const now = new Date();
    const start = new Date(session.scheduled_at || session.scheduledAt);
    const end = new Date(start.getTime() + (session.duration_minutes || session.durationMinutes || 60) * 60000);
    return now >= start && now <= end;
}

/** A cancelled session is not joinable and should not invite a registration. */
function isSessionCancelled(session) {
    return (session.status || session.Status) === 'cancelled';
}

function formatSessionDate(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    // Quote-safe. Serialising a TEXT node to innerHTML escapes & < > and
    // nothing else, so a value containing a double quote used to break
    // straight out of any quoted HTML attribute it was interpolated into
    // — and lead names, company names and WhatsApp display names all
    // arrive from outside. Over-escaping is free in text context, where
    // &quot; renders as a plain quote.
    return div.innerHTML.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function truncate(str, len) {
    if (!str || str.length <= len) return str;
    return str.substring(0, len) + '...';
}

/* ═══════════════════════════════════════════════════════════════════════════
   INSTRUCTOR CONTROLS
   
   The page could list sessions, create one and join it. Everything after that —
   editing, cancelling, moving a session to 'live' so learners can actually get
   in, registering for a seat, and seeing who registered — was backend-only:
   five endpoints with no caller. A session could be scheduled and then never
   touched again, and nobody could see who was coming.
   ═══════════════════════════════════════════════════════════════════════════ */

/** The statuses live_sessions.status accepts. NOT 'in_progress' — the column
 *  rejects it, and the Copilot tool used to advertise it, which is how we found
 *  the mismatch. 'live' is what makes a session joinable. */
const SESSION_STATUSES = [
    { value: 'scheduled', label: 'Scheduled' },
    { value: 'live',      label: 'Live now' },
    { value: 'completed', label: 'Completed' },
    { value: 'cancelled', label: 'Cancelled' }
];

function canManageSessions() {
    // Same roles the endpoints require; hiding the controls from a learner keeps
    // the page honest rather than offering buttons that answer 403.
    return typeof lmsRoles !== 'undefined' && lmsRoles.isInstructorOrAbove
        ? lmsRoles.isInstructorOrAbove()
        : true;
}

function renderSessionAdminActions(session) {
    if (!canManageSessions()) return '';
    return `
        <div class="session-admin-actions">
            <select class="form-control form-control-sm session-status-select"
                    onchange="setSessionStatus('${session.id}', this.value)"
                    title="Move this session between states — learners can only join a LIVE session">
                ${SESSION_STATUSES.map(s =>
                    `<option value="${s.value}" ${session.status === s.value ? 'selected' : ''}>${s.label}</option>`
                ).join('')}
            </select>
            <div class="session-admin-buttons">
                <button class="btn btn-sm btn-outline-secondary" onclick="openSessionAttendees('${session.id}')">Attendees</button>
                <button class="btn btn-sm btn-outline-secondary" onclick="openSessionAttendance('${session.id}')" title="Who actually joined">Attendance</button>
                <button class="btn btn-sm btn-outline-secondary" onclick="openSessionEditor('${session.id}')">Edit</button>
                <button class="btn-icon danger" onclick="deleteSession('${session.id}')" title="Delete session">&times;</button>
            </div>
        </div>`;
}

async function setSessionStatus(sessionId, status) {
    try {
        await api.request(`/lms/live-sessions/${sessionId}/status`, {
            method: 'PUT', body: JSON.stringify({ status })
        });
        showToast(`Session marked ${status}`, 'success');
        await loadSessions();
    } catch (e) {
        showToast(e.message || 'Could not change the status', 'error');
        await loadSessions();   // put the dropdown back to the truth
    }
}

async function deleteSession(sessionId) {
    if (!confirm('Delete this session?\n\nIts registrations and attendance go with it.')) return;
    try {
        await api.request(`/lms/live-sessions/${sessionId}`, { method: 'DELETE' });
        showToast('Session deleted', 'success');
        await loadSessions();
    } catch (e) { showToast(e.message || 'Could not delete the session', 'error'); }
}

// ─── edit ───────────────────────────────────────────────────────────────────

let editingSessionId = null;

async function openSessionEditor(sessionId) {
    editingSessionId = sessionId;
    try {
        const s = await api.request(`/lms/live-sessions/${sessionId}`);
        document.getElementById('editSessionTitle').value = s.title || '';
        document.getElementById('editSessionDescription').value = s.description || '';
        document.getElementById('editSessionDuration').value = s.durationMinutes || s.duration_minutes || 60;
        document.getElementById('editSessionMeetingId').value = s.meetingId || s.meeting_id || '';
        const when = s.scheduledAt || s.scheduled_at;
        // datetime-local wants a local 'YYYY-MM-DDTHH:mm' with no zone suffix.
        if (when) {
            const d = new Date(when);
            const pad = n => String(n).padStart(2, '0');
            document.getElementById('editSessionWhen').value =
                `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
        }
        document.getElementById('editSessionModal').style.display = 'flex';
    } catch (e) { showToast(e.message || 'Could not load the session', 'error'); }
}

function closeSessionEditor() {
    document.getElementById('editSessionModal').style.display = 'none';
    editingSessionId = null;
}

async function saveSessionEdit() {
    const title = document.getElementById('editSessionTitle').value.trim();
    if (!title) { showToast('The session needs a title', 'error'); return; }
    const when = document.getElementById('editSessionWhen').value;
    if (!when) { showToast('The session needs a date and time', 'error'); return; }

    try {
        await api.request(`/lms/live-sessions/${editingSessionId}`, {
            method: 'PUT',
            body: JSON.stringify({
                id: editingSessionId,
                title,
                description: document.getElementById('editSessionDescription').value.trim() || null,
                scheduledAt: new Date(when).toISOString(),
                durationMinutes: parseInt(document.getElementById('editSessionDuration').value, 10) || 60,
                meetingId: document.getElementById('editSessionMeetingId').value.trim() || null
            })
        });
        closeSessionEditor();
        showToast('Session updated', 'success');
        await loadSessions();
    } catch (e) { showToast(e.message || 'Could not save the session', 'error'); }
}

// ─── attendees + registration ───────────────────────────────────────────────

async function openSessionAttendees(sessionId) {
    const host = document.getElementById('attendeesList');
    document.getElementById('attendeesModal').style.display = 'flex';
    host.innerHTML = '<p class="text-muted">Loading…</p>';
    try {
        const rows = await api.request(`/lms/learning/sessions/${sessionId}/registrations`);
        host.innerHTML = rows.length === 0
            ? '<p class="text-muted qb-hint">Nobody has registered yet.</p>'
            : `<div class="qb-question-list">${rows.map(r => `
                <div class="qb-question-row">
                    <div class="qb-question-main">
                        <div class="qb-question-text">${escapeHtml(r.userId)}</div>
                        <div class="qb-question-meta">
                            <span class="badge">${escapeHtml(r.status)}</span>
                            <span>${new Date(r.registeredAt).toLocaleString()}</span>
                        </div>
                    </div>
                </div>`).join('')}</div>`;
    } catch (e) {
        host.innerHTML = '<p class="text-muted">Could not load the attendee list.</p>';
    }
}

function closeAttendees() {
    document.getElementById('attendeesModal').style.display = 'none';
}

/**
 * Take a seat. The server decides registered vs waitlisted from the session's
 * capacity — in one statement, so two learners racing for the last seat cannot
 * both get it — and tells us which it was.
 */
async function registerForSession(sessionId) {
    try {
        const res = await api.request(`/lms/learning/sessions/${sessionId}/register`, { method: 'POST' });
        const status = (res && (res.status || res.Status)) || 'registered';
        showToast(status === 'waitlisted'
            ? 'That session is full — you are on the waiting list and will be moved up if a seat frees.'
            : 'You have a seat on that session.', 'success');
        await loadSessions();
    } catch (e) { showToast(e.message || 'Could not register', 'error'); }
}

async function cancelSessionRegistration(sessionId) {
    try {
        await api.request(`/lms/learning/sessions/${sessionId}/register`, { method: 'DELETE' });
        showToast('Registration cancelled — the next person on the waiting list moves up.', 'success');
        await loadSessions();
    } catch (e) { showToast(e.message || 'Could not cancel', 'error'); }
}
