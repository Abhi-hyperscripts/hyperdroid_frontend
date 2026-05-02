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
    const statusBadge = isLive
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
                <button class="btn btn-primary" onclick="joinSession('${session.id}')">
                    ${isLive ? 'Join Now' : 'Register'}
                </button>
            </div>
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

function isSessionLive(session) {
    const now = new Date();
    const start = new Date(session.scheduled_at);
    const end = new Date(start.getTime() + (session.duration_minutes || 60) * 60000);
    return now >= start && now <= end;
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
    return div.innerHTML;
}

function truncate(str, len) {
    if (!str || str.length <= len) return str;
    return str.substring(0, len) + '...';
}
