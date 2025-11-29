// Dashboard page JavaScript - Unified Dashboard
let currentProjectId = null;
let selectedMeetingType = 'regular'; // For create meeting modal

// Check authentication
if (!api.isAuthenticated()) {
    window.location.href = '../login.html';
}

// Display user avatar with initials
const user = api.getUser();
if (user) {
    const firstName = user.firstName || user.first_name || '';
    const lastName = user.lastName || user.last_name || '';
    const initials = (firstName.charAt(0) + lastName.charAt(0)).toUpperCase() || user.email.charAt(0).toUpperCase();

    const userAvatar = document.getElementById('userAvatar');
    const userDropdownName = document.getElementById('userDropdownName');

    if (userAvatar) {
        userAvatar.textContent = initials;
    }

    if (userDropdownName) {
        const fullName = `${firstName} ${lastName}`.trim();
        userDropdownName.textContent = fullName || user.email;
    }
}

// Toggle user dropdown menu
window.toggleUserDropdown = function() {
    const dropdown = document.getElementById('userDropdownMenu');
    if (dropdown) {
        dropdown.classList.toggle('show');
    }
}

// Close dropdown when clicking outside
document.addEventListener('click', (event) => {
    const dropdown = document.getElementById('userDropdownMenu');
    const avatar = document.getElementById('userAvatar');

    if (dropdown && avatar && !dropdown.contains(event.target) && !avatar.contains(event.target)) {
        dropdown.classList.remove('show');
    }
});

// ============================================
// UNIFIED DASHBOARD - LOAD ALL PROJECTS
// ============================================

async function loadAllProjects() {
    try {
        const projects = await api.getProjects();
        const container = document.getElementById('allProjects');

        // Also load meetings where user is host (from other users' projects)
        await loadMeetingsImHosting(projects);

        // For each project, load ALL meetings (of any type)
        const projectsWithMeetings = await Promise.all(
            projects.map(async (project) => {
                const meetings = await api.getProjectMeetings(project.id);

                // Fetch recordings and participant count for each meeting
                const meetingsWithDetails = await Promise.all(
                    meetings.map(async (meeting) => {
                        try {
                            const recordings = await api.getMeetingRecordings(meeting.id);
                            let participantCount = 0;

                            if (meeting.meeting_type === 'participant-controlled') {
                                try {
                                    const participants = await api.getAllowedParticipants(meeting.id);
                                    participantCount = participants ? participants.length : 0;
                                } catch (error) {
                                    console.error('Error fetching participants for meeting:', meeting.id, error);
                                }
                            }

                            return { ...meeting, recordings: recordings || [], participant_count: participantCount };
                        } catch (error) {
                            console.error('Error fetching recordings for meeting:', meeting.id, error);
                            return { ...meeting, recordings: [], participant_count: 0 };
                        }
                    })
                );

                return { ...project, meetings: meetingsWithDetails };
            })
        );

        // Separate projects with meetings and empty projects
        const projectsWithMeetingsList = projectsWithMeetings.filter(p => p.meetings.length > 0);
        const emptyProjects = projectsWithMeetings.filter(p => p.meetings.length === 0);

        if (projectsWithMeetingsList.length === 0 && emptyProjects.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon">📁</div>
                    <h3>No projects yet</h3>
                    <p>Create your first project to get started</p>
                    <button onclick="showCreateProjectModal()" class="btn btn-primary">+ Create Project</button>
                </div>
            `;
            return;
        }

        // Render projects with meetings
        let html = projectsWithMeetingsList.map(project => createProjectAccordionHTML(project)).join('');

        // Render empty projects
        if (emptyProjects.length > 0) {
            html += '<div class="empty-projects-section"><h4 class="empty-projects-title">Projects without meetings</h4>';
            html += emptyProjects.map(project => createEmptyProjectCardHTML(project)).join('');
            html += '</div>';
        }

        container.innerHTML = html;

    } catch (error) {
        console.error('Error loading projects:', error);
    }
}

// ============================================
// MEETINGS I'M HOSTING (from other users' projects)
// ============================================

async function loadMeetingsImHosting(userProjects) {
    try {
        const hostedMeetings = await api.getHostedMeetings();
        const userProjectIds = userProjects.map(p => p.id);

        // Filter to meetings NOT in user's own projects
        const meetingsImHosting = hostedMeetings.filter(m => !userProjectIds.includes(m.project_id));

        const section = document.getElementById('meetingsImHostingSection');
        const list = document.getElementById('meetingsImHostingList');

        if (!section || !list) return;

        if (meetingsImHosting.length > 0) {
            section.style.display = 'block';

            // Fetch recordings for each meeting
            const meetingsWithRecordings = await Promise.all(
                meetingsImHosting.map(async (meeting) => {
                    try {
                        const recordings = await api.getMeetingRecordings(meeting.id);
                        let participantCount = 0;
                        if (meeting.meeting_type === 'participant-controlled') {
                            try {
                                const participants = await api.getAllowedParticipants(meeting.id);
                                participantCount = participants ? participants.length : 0;
                            } catch (e) { }
                        }
                        return { ...meeting, recordings: recordings || [], participant_count: participantCount };
                    } catch (error) {
                        return { ...meeting, recordings: [], participant_count: 0 };
                    }
                })
            );

            list.innerHTML = meetingsWithRecordings.map(meeting => createHostedMeetingItemHTML(meeting)).join('');
        } else {
            section.style.display = 'none';
        }
    } catch (error) {
        console.error('Error loading hosted meetings:', error);
        const section = document.getElementById('meetingsImHostingSection');
        if (section) section.style.display = 'none';
    }
}

// ============================================
// PROJECT ACCORDION HTML
// ============================================

function createProjectAccordionHTML(project) {
    const meetingsList = project.meetings.map(meeting => createMeetingItemHTML(meeting)).join('');

    return `
        <div class="project-accordion-item" id="project-${project.id}">
            <div class="project-accordion-header" onclick="toggleProject('${project.id}')">
                <div class="project-info">
                    <h3>${project.project_name}</h3>
                    <p>${project.description || 'No description'}</p>
                    <span class="meeting-count">${project.meetings.length} ${project.meetings.length === 1 ? 'meeting' : 'meetings'}</span>
                </div>
                <div class="accordion-actions">
                    <button class="btn btn-sm btn-primary" onclick="event.stopPropagation(); showCreateMeetingModalForProject('${project.id}')">
                        + Add Meeting
                    </button>
                    <button class="btn btn-sm btn-danger" onclick="event.stopPropagation(); confirmDeleteProject('${project.id}')">
                        Delete Project
                    </button>
                    <span class="accordion-chevron" id="chevron-${project.id}">▼</span>
                </div>
            </div>
            <div class="project-accordion-body" id="meetings-${project.id}">
                <div class="meetings-list">
                    ${meetingsList}
                </div>
            </div>
        </div>
    `;
}

function createEmptyProjectCardHTML(project) {
    return `
        <div class="empty-project-card" id="empty-project-${project.id}">
            <div class="empty-project-info">
                <h4>${project.project_name}</h4>
                <p>${project.description || 'No description'}</p>
                <span class="no-meetings-badge">No meetings yet</span>
            </div>
            <div class="empty-project-actions">
                <button class="btn btn-sm btn-primary" onclick="showCreateMeetingModalForProject('${project.id}')">
                    + Add Meeting
                </button>
                <button class="btn btn-sm btn-danger" onclick="confirmDeleteProject('${project.id}')">
                    Delete
                </button>
            </div>
        </div>
    `;
}

// ============================================
// MEETING CARD HTML - WITH TYPE BADGES
// ============================================

function createMeetingItemHTML(meeting) {
    const status = getMeetingStatus(meeting);
    const hasRecordings = meeting.recordings && meeting.recordings.length > 0;
    const participantCount = meeting.participant_count || 0;
    const isActive = meeting.is_active !== false;
    const isStarted = meeting.is_started || false;
    const type = meeting.meeting_type || 'regular';

    const dateStr = meeting.start_time
        ? new Date(meeting.start_time).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
        : '';

    const inactiveClass = !isActive ? 'meeting-inactive' : '';
    const inactiveBadge = !isActive ? '<span class="badge badge-inactive">Inactive</span>' : '';

    // Type badge with colors
    const typeBadge = getTypeBadgeHTML(type);

    return `
        <div class="meeting-card ${inactiveClass}" id="meeting-${meeting.id}">
            <div class="meeting-card-header">
                <div class="meeting-card-title">
                    <h4>${meeting.meeting_name}</h4>
                    <div class="meeting-card-badges">
                        ${typeBadge}
                        ${inactiveBadge}
                        ${dateStr ? `<span class="badge badge-date">${dateStr}</span>` : ''}
                        <span class="badge badge-status badge-${status.toLowerCase()}">${status}</span>
                        ${type === 'participant-controlled' ? `<span class="badge badge-participants" id="participant-badge-${meeting.id}">${participantCount} participant${participantCount !== 1 ? 's' : ''}</span>` : ''}
                        ${hasRecordings ? `<span class="badge badge-recording badge-clickable" onclick="event.stopPropagation(); playRecording('${meeting.id}')" title="View ${meeting.recordings.length} recording${meeting.recordings.length > 1 ? 's' : ''}">${meeting.recordings.length} rec</span>` : ''}
                        ${meeting.allow_guests && type !== 'participant-controlled' ? '<span class="badge badge-guest">Guests OK</span>' : ''}
                        ${(type === 'hosted' || type === 'participant-controlled') && meeting.host_user_name ? `<span class="badge badge-host" title="Host: ${meeting.host_user_name}">Host: ${meeting.host_user_name.split(' ')[0]}</span>` : ''}
                    </div>
                </div>
                <div class="meeting-card-actions">
                    ${isActive ? `
                    <button class="btn-icon btn-primary" onclick="joinMeeting('${meeting.id}')" title="Join Meeting">
                        <span>Join</span>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/>
                            <polyline points="10 17 15 12 10 7"/>
                            <line x1="15" y1="12" x2="3" y2="12"/>
                        </svg>
                    </button>` : ''}
                    ${type === 'participant-controlled' ? `
                    <button class="btn-icon btn-secondary" onclick="event.stopPropagation(); manageParticipants('${meeting.id}')" title="Manage Participants">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                            <circle cx="9" cy="7" r="4"/>
                            <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
                            <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
                        </svg>
                    </button>` : ''}
                    <button class="btn-icon btn-secondary" onclick="copyMeetingLink('${meeting.id}')" title="Copy Link">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
                            <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
                        </svg>
                    </button>
                    ${isActive ? `
                    <button class="btn-icon btn-secondary" onclick="event.stopPropagation(); showMeetingSettingsModal('${meeting.id}', '${type}')" title="Settings">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <circle cx="12" cy="12" r="3"/>
                            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
                        </svg>
                    </button>` : ''}
                    ${isActive ? `
                    <label class="toggle-auto-rec" title="Auto Recording">
                        <input type="checkbox" id="autoRecording-${meeting.id}" ${meeting.auto_recording ? 'checked' : ''}
                               onchange="handleAutoRecordingToggle('${meeting.id}', this.checked)">
                        <span class="toggle-slider"></span>
                    </label>` : ''}
                    ${isActive ? `
                    <button class="btn-icon btn-danger" onclick="confirmDeleteMeeting('${meeting.id}')" title="Delete">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="3 6 5 6 21 6"/>
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                        </svg>
                    </button>` : `
                    <button class="btn-icon btn-danger-permanent" onclick="confirmPermanentDeleteMeeting('${meeting.id}')" title="Permanently Delete">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="3 6 5 6 21 6"/>
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                            <line x1="10" y1="11" x2="10" y2="17"/>
                            <line x1="14" y1="11" x2="14" y2="17"/>
                        </svg>
                    </button>`}
                </div>
            </div>
            ${!isActive ? `<div class="meeting-inactive-notice">This meeting is inactive. Use "Permanently Delete" to remove it completely.</div>` : ''}
            ${meeting.notes && meeting.notes !== 'No notes' ? `<div class="meeting-card-notes">${meeting.notes}</div>` : ''}
        </div>
    `;
}

function createHostedMeetingItemHTML(meeting) {
    const status = getMeetingStatus(meeting);
    const hasRecordings = meeting.recordings && meeting.recordings.length > 0;
    const participantCount = meeting.participant_count || 0;
    const isActive = meeting.is_active !== false;
    const type = meeting.meeting_type || 'regular';

    const dateStr = meeting.start_time
        ? new Date(meeting.start_time).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
        : '';

    const inactiveClass = !isActive ? 'meeting-inactive' : '';
    const inactiveBadge = !isActive ? '<span class="badge badge-inactive">Inactive</span>' : '';
    const typeBadge = getTypeBadgeHTML(type);

    return `
        <div class="meeting-card hosted-meeting-card ${inactiveClass}" id="meeting-${meeting.id}">
            <div class="meeting-card-header">
                <div class="meeting-card-title">
                    <h4>${meeting.meeting_name}</h4>
                    <div class="meeting-card-badges">
                        ${typeBadge}
                        <span class="badge badge-project" title="From project: ${meeting.project_name || 'Unknown'}">📁 ${meeting.project_name || 'Unknown Project'}</span>
                        ${inactiveBadge}
                        ${dateStr ? `<span class="badge badge-date">${dateStr}</span>` : ''}
                        <span class="badge badge-status badge-${status.toLowerCase()}">${status}</span>
                        ${type === 'participant-controlled' ? `<span class="badge badge-participants">${participantCount} participant${participantCount !== 1 ? 's' : ''}</span>` : ''}
                        ${hasRecordings ? `<span class="badge badge-recording badge-clickable" onclick="event.stopPropagation(); playRecording('${meeting.id}')">${meeting.recordings.length} rec</span>` : ''}
                        ${meeting.allow_guests && type !== 'participant-controlled' ? '<span class="badge badge-guest">Guests OK</span>' : ''}
                        <span class="badge badge-host-you">You are host</span>
                    </div>
                </div>
                <div class="meeting-card-actions">
                    ${isActive ? `
                    <button class="btn-icon btn-primary" onclick="joinMeeting('${meeting.id}')" title="Join Meeting">
                        <span>Join</span>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/>
                            <polyline points="10 17 15 12 10 7"/>
                            <line x1="15" y1="12" x2="3" y2="12"/>
                        </svg>
                    </button>` : ''}
                    ${type === 'participant-controlled' ? `
                    <button class="btn-icon btn-secondary" onclick="event.stopPropagation(); manageParticipants('${meeting.id}')" title="Manage Participants">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                            <circle cx="9" cy="7" r="4"/>
                            <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
                            <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
                        </svg>
                    </button>` : ''}
                    <button class="btn-icon btn-secondary" onclick="copyMeetingLink('${meeting.id}')" title="Copy Link">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
                            <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
                        </svg>
                    </button>
                    ${isActive ? `
                    <button class="btn-icon btn-secondary" onclick="event.stopPropagation(); showMeetingSettingsModal('${meeting.id}', '${type}')" title="Settings">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <circle cx="12" cy="12" r="3"/>
                            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
                        </svg>
                    </button>` : ''}
                    ${isActive ? `
                    <label class="toggle-auto-rec" title="Auto Recording">
                        <input type="checkbox" id="autoRecording-${meeting.id}" ${meeting.auto_recording ? 'checked' : ''}
                               onchange="handleAutoRecordingToggle('${meeting.id}', this.checked)">
                        <span class="toggle-slider"></span>
                    </label>` : ''}
                </div>
            </div>
            ${!isActive ? `<div class="meeting-inactive-notice">This meeting is inactive.</div>` : ''}
            ${meeting.notes && meeting.notes !== 'No notes' ? `<div class="meeting-card-notes">${meeting.notes}</div>` : ''}
        </div>
    `;
}

function getTypeBadgeHTML(type) {
    const badges = {
        'regular': '<span class="badge badge-type badge-type-open">Open</span>',
        'hosted': '<span class="badge badge-type badge-type-hosted">Hosted</span>',
        'participant-controlled': '<span class="badge badge-type badge-type-private">Private</span>'
    };
    return badges[type] || badges['regular'];
}

function getMeetingStatus(meeting) {
    if (!meeting.start_time && !meeting.end_time) {
        return 'Active';
    }

    const now = new Date();
    const start = meeting.start_time ? new Date(meeting.start_time) : null;
    const end = meeting.end_time ? new Date(meeting.end_time) : null;

    if (start && end) {
        if (now < start) return 'Scheduled';
        if (now > end) return 'Ended';
        return 'Active';
    }

    if (start && now < start) return 'Scheduled';
    return 'Active';
}

// ============================================
// ACCORDION TOGGLE
// ============================================

function toggleProject(projectId) {
    try {
        const item = document.getElementById('project-' + projectId);
        if (!item) {
            console.error('Project accordion item not found for ID:', projectId);
            return;
        }
        item.classList.toggle('expanded');
    } catch (error) {
        console.error('Error toggling accordion:', error);
    }
}

// ============================================
// CREATE PROJECT
// ============================================

function showCreateProjectModal() {
    document.getElementById('createProjectModal').classList.add('active');
}

document.getElementById('createProjectForm').addEventListener('submit', async (e) => {
    e.preventDefault();

    const projectName = document.getElementById('projectName').value;
    const description = document.getElementById('projectDescription').value;

    try {
        await api.createProject(projectName, description);
        closeModal('createProjectModal');
        document.getElementById('createProjectForm').reset();
        loadAllProjects();
    } catch (error) {
        alert('Failed to create project: ' + error.message);
    }
});

// ============================================
// CREATE MEETING WITH TYPE SELECTION
// ============================================

// Selected participants for private meetings (during creation)
let createMeetingSelectedParticipants = [];
let createMeetingAllUsers = [];

async function showCreateMeetingModalForProject(projectId) {
    currentProjectId = projectId;
    selectedMeetingType = 'regular';
    createMeetingSelectedParticipants = [];

    const modal = document.getElementById('createMeetingModal');

    // Reset form
    document.getElementById('createMeetingForm').reset();

    // Reset type selection
    document.querySelectorAll('#meetingTypeToggle .type-btn').forEach(btn => {
        btn.classList.remove('active');
        if (btn.dataset.type === 'regular') {
            btn.classList.add('active');
        }
    });

    // Update help text
    document.getElementById('meetingTypeHelp').textContent = 'Anyone can join directly without approval';

    // Hide host and participants selection
    document.getElementById('hostSelectionGroup').style.display = 'none';
    document.getElementById('participantsSelectionGroup').style.display = 'none';

    // Show allow guests toggle
    document.getElementById('allowGuestsToggleGroup').style.display = 'flex';

    modal.classList.add('active');
    await fetchAndPopulateUsers();
}

function selectMeetingType(type) {
    selectedMeetingType = type;

    // Update button states
    document.querySelectorAll('#meetingTypeToggle .type-btn').forEach(btn => {
        btn.classList.remove('active');
        if (btn.dataset.type === type) {
            btn.classList.add('active');
        }
    });

    // Update help text
    const helpTexts = {
        'regular': 'Anyone can join directly without approval',
        'hosted': 'Host must start the meeting before others can join',
        'participant-controlled': 'Only allowed participants can join'
    };
    document.getElementById('meetingTypeHelp').textContent = helpTexts[type];

    // Show/hide host selection
    const hostGroup = document.getElementById('hostSelectionGroup');
    const hostSelect = document.getElementById('meetingHost');
    const hostRequiredMark = document.getElementById('hostRequiredMark');
    const hostHelp = document.getElementById('hostHelp');

    if (type === 'hosted') {
        hostGroup.style.display = 'block';
        hostSelect.required = true;
        hostRequiredMark.style.display = 'inline';
        hostHelp.textContent = 'Required for hosted meetings';
    } else if (type === 'participant-controlled') {
        hostGroup.style.display = 'block';
        hostSelect.required = false;
        hostRequiredMark.style.display = 'none';
        hostHelp.textContent = 'Optional - if set, host must start before participants can join';
    } else {
        hostGroup.style.display = 'none';
        hostSelect.required = false;
        hostSelect.value = '';
    }

    // Show/hide participants selection
    const participantsGroup = document.getElementById('participantsSelectionGroup');
    if (type === 'participant-controlled') {
        participantsGroup.style.display = 'block';
        loadCreateMeetingUsersList();
    } else {
        participantsGroup.style.display = 'none';
        createMeetingSelectedParticipants = [];
    }

    // Show/hide allow guests toggle (hidden for private meetings)
    const allowGuestsToggle = document.getElementById('allowGuestsToggleGroup');
    if (type === 'participant-controlled') {
        allowGuestsToggle.style.display = 'none';
        document.getElementById('allowGuests').checked = false;
    } else {
        allowGuestsToggle.style.display = 'flex';
    }
}

async function loadCreateMeetingUsersList() {
    const list = document.getElementById('createMeetingUsersList');
    const countDisplay = document.getElementById('selectedParticipantsCount');

    list.innerHTML = '<p class="loading-text">Loading users...</p>';

    try {
        createMeetingAllUsers = await api.getAllUsers();
        renderCreateMeetingUsersList(createMeetingAllUsers);
    } catch (error) {
        console.error('Error loading users:', error);
        list.innerHTML = '<p class="error-text">Failed to load users</p>';
    }
}

function renderCreateMeetingUsersList(users) {
    const list = document.getElementById('createMeetingUsersList');
    const countDisplay = document.getElementById('selectedParticipantsCount');

    if (users.length === 0) {
        list.innerHTML = '<p class="empty-text">No users found</p>';
        return;
    }

    list.innerHTML = users.map(user => {
        const email = user.email || '';
        const firstName = user.firstName || '';
        const lastName = user.lastName || '';
        const isSelected = createMeetingSelectedParticipants.includes(email.toLowerCase());

        return `
            <div class="user-select-item-inline ${isSelected ? 'selected' : ''}">
                <div class="user-info-inline">
                    <span class="user-name-inline">${firstName} ${lastName}</span>
                    <span class="user-email-inline">${email}</span>
                </div>
                <label class="checkbox-inline ${!email ? 'disabled' : ''}">
                    <input type="checkbox"
                           value="${email}"
                           data-email="${email}"
                           ${isSelected ? 'checked' : ''}
                           ${!email ? 'disabled' : ''}
                           onchange="handleCreateMeetingParticipantToggle(this)">
                    <span class="checkmark-inline"></span>
                </label>
            </div>
        `;
    }).join('');

    countDisplay.textContent = createMeetingSelectedParticipants.length;
}

function handleCreateMeetingParticipantToggle(checkbox) {
    const email = checkbox.dataset.email.toLowerCase();

    if (checkbox.checked) {
        if (!createMeetingSelectedParticipants.includes(email)) {
            createMeetingSelectedParticipants.push(email);
        }
    } else {
        const index = createMeetingSelectedParticipants.indexOf(email);
        if (index > -1) {
            createMeetingSelectedParticipants.splice(index, 1);
        }
    }

    // Update count
    document.getElementById('selectedParticipantsCount').textContent = createMeetingSelectedParticipants.length;

    // Update visual state
    checkbox.closest('.user-select-item-inline').classList.toggle('selected', checkbox.checked);
}

// Search handler for create meeting users list
document.getElementById('createMeetingUserSearch')?.addEventListener('input', (e) => {
    const searchTerm = e.target.value.toLowerCase();
    const filtered = createMeetingAllUsers.filter(user => {
        const firstName = (user.firstName || '').toLowerCase();
        const lastName = (user.lastName || '').toLowerCase();
        const email = (user.email || '').toLowerCase();
        return firstName.includes(searchTerm) || lastName.includes(searchTerm) || email.includes(searchTerm);
    });
    renderCreateMeetingUsersList(filtered);
});

async function fetchAndPopulateUsers() {
    try {
        const users = await api.getAllUsers();
        const hostSelect = document.getElementById('meetingHost');
        hostSelect.innerHTML = '<option value="">Select Host</option>';

        users.forEach(user => {
            const option = document.createElement('option');
            option.value = user.userId;
            option.textContent = `${user.firstName} ${user.lastName} (${user.email})`;
            hostSelect.appendChild(option);
        });
    } catch (error) {
        console.error('Error fetching users:', error);
    }
}

// Create meeting form submission
document.getElementById('createMeetingForm').addEventListener('submit', async (e) => {
    e.preventDefault();

    if (!currentProjectId) {
        alert('Please select a project first');
        return;
    }

    const meetingName = document.getElementById('meetingName').value;
    const startTime = document.getElementById('startTime').value || null;
    const endTime = document.getElementById('endTime').value || null;
    const notes = document.getElementById('notes').value;
    const allowGuests = document.getElementById('allowGuests').checked;
    const autoRecording = document.getElementById('autoRecording').checked;
    const hostUserId = (selectedMeetingType === 'hosted' || selectedMeetingType === 'participant-controlled')
        ? (document.getElementById('meetingHost').value || null)
        : null;

    // Validate host for hosted meetings
    if (selectedMeetingType === 'hosted' && !hostUserId) {
        alert('Please select a host for the hosted meeting');
        return;
    }

    try {
        // Create the meeting
        const response = await api.createMeeting(
            currentProjectId,
            meetingName,
            startTime,
            endTime,
            notes,
            allowGuests,
            selectedMeetingType,
            autoRecording,
            hostUserId
        );

        // Extract meeting from response (backend returns { success, message, meeting })
        const meeting = response.meeting;

        // If private meeting, add selected participants
        if (selectedMeetingType === 'participant-controlled' && createMeetingSelectedParticipants.length > 0 && meeting) {
            try {
                await api.addMultipleAllowedParticipants(meeting.id, createMeetingSelectedParticipants);
            } catch (error) {
                console.error('Error adding participants:', error);
                // Still continue, meeting was created
            }
        }

        closeModal('createMeetingModal');
        document.getElementById('createMeetingForm').reset();
        createMeetingSelectedParticipants = [];
        loadAllProjects();
    } catch (error) {
        alert('Failed to create meeting: ' + error.message);
    }
});

// ============================================
// DELETE OPERATIONS
// ============================================

async function confirmDeleteProject(projectId) {
    const meetings = await api.getProjectMeetings(projectId);
    if (meetings && meetings.length > 0) {
        alert(`Cannot delete project. Please delete all ${meetings.length} meeting(s) individually first.`);
        return;
    }

    if (confirm('Are you sure you want to delete this project?')) {
        try {
            await api.deleteProject(projectId);
            loadAllProjects();
        } catch (error) {
            alert('Failed to delete project: ' + error.message);
        }
    }
}

function confirmDeleteMeeting(meetingId) {
    if (confirm('Are you sure you want to delete this meeting? (This will mark it as inactive)')) {
        deleteMeeting(meetingId);
    }
}

function confirmPermanentDeleteMeeting(meetingId) {
    if (confirm('WARNING: This will PERMANENTLY delete this meeting and all associated recordings. This action cannot be undone!\n\nAre you sure you want to permanently delete this meeting?')) {
        permanentDeleteMeeting(meetingId);
    }
}

async function deleteMeeting(meetingId) {
    try {
        await api.deleteMeeting(meetingId);
        loadAllProjects();
    } catch (error) {
        alert('Failed to delete meeting: ' + error.message);
    }
}

async function permanentDeleteMeeting(meetingId) {
    try {
        await api.permanentDeleteMeeting(meetingId);
        loadAllProjects();
    } catch (error) {
        alert('Failed to permanently delete meeting: ' + error.message);
    }
}

// ============================================
// MEETING ACTIONS
// ============================================

function joinMeeting(meetingId) {
    window.location.href = `lobby.html?id=${meetingId}`;
}

function copyMeetingLink(meetingId) {
    const link = `${window.location.origin}/pages/vision/lobby.html?id=${meetingId}`;
    navigator.clipboard.writeText(link).then(() => {
        alert('Meeting link copied to clipboard!');
    }).catch(() => {
        const textArea = document.createElement('textarea');
        textArea.value = link;
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
        alert('Meeting link copied to clipboard!');
    });
}

async function handleAutoRecordingToggle(meetingId, value) {
    try {
        await api.toggleAutoRecording(meetingId, value);
        console.log(`Auto-recording ${value ? 'enabled' : 'disabled'} for meeting ${meetingId}`);
    } catch (error) {
        console.error('Failed to toggle auto-recording:', error);
        alert('Failed to toggle auto-recording: ' + error.message);
        const checkbox = document.getElementById(`autoRecording-${meetingId}`);
        if (checkbox) {
            checkbox.checked = !value;
        }
    }
}

// ============================================
// MANAGE PARTICIPANTS MODAL
// ============================================

let currentMeetingId = null;
let allRegisteredUsers = [];
let allowedParticipantEmails = [];
let currentFilteredUsers = [];
let displayedCount = 0;
const BATCH_SIZE = 50;
let isLoadingMore = false;
let currentFilter = 'all';

async function manageParticipants(meetingId) {
    currentMeetingId = meetingId;
    document.getElementById('manageParticipantsModal').classList.add('active');
    await loadAllowedParticipants(meetingId);
    await loadRegisteredUsers();
}

async function loadRegisteredUsers() {
    try {
        allRegisteredUsers = await api.getAllUsers();
        currentFilteredUsers = allRegisteredUsers;
        displayedCount = 0;
        displayRegisteredUsers(currentFilteredUsers, false);
    } catch (error) {
        console.error('Error loading users:', error);
        document.getElementById('registeredUsersList').innerHTML =
            '<p style="color: #dc3545; text-align: center;">Failed to load users</p>';
    }
}

function displayRegisteredUsers(users, append = false) {
    const list = document.getElementById('registeredUsersList');
    const countDisplay = document.getElementById('userCountDisplay');

    if (!append) {
        currentFilteredUsers = users;
        displayedCount = 0;
    }

    const totalUsers = allRegisteredUsers.length;
    const filteredCount = currentFilteredUsers.length;
    countDisplay.textContent = filteredCount === totalUsers
        ? `${totalUsers} user${totalUsers !== 1 ? 's' : ''}`
        : `${filteredCount} of ${totalUsers} users`;

    if (currentFilteredUsers.length === 0) {
        list.innerHTML = '<p style="text-align: center; color: #999; font-size: 0.75rem; padding: 20px;">No users found</p>';
        return;
    }

    const startIndex = displayedCount;
    const endIndex = Math.min(displayedCount + BATCH_SIZE, currentFilteredUsers.length);
    const batch = currentFilteredUsers.slice(startIndex, endIndex);

    const batchHTML = batch.map(user => {
        const email = user.email || '';
        const firstName = user.firstName || '';
        const lastName = user.lastName || '';
        const isAllowed = email ? allowedParticipantEmails.includes(email.toLowerCase()) : false;

        return `
        <div class="user-select-item ${isAllowed ? 'selected' : ''}">
            <div class="user-info-compact">
                <span class="user-name-compact">${firstName} ${lastName}</span>
                <span class="user-email-compact">${email || 'No email'}</span>
            </div>
            <label class="toggle-switch-participant ${!email ? 'disabled' : ''}">
                <input type="checkbox"
                       value="${email}"
                       data-email="${email}"
                       ${isAllowed ? 'checked' : ''}
                       ${!email ? 'disabled' : ''}
                       onchange="handleParticipantToggle(this)">
                <span class="toggle-slider-participant"></span>
            </label>
        </div>
    `;
    }).join('');

    if (append) {
        list.insertAdjacentHTML('beforeend', batchHTML);
    } else {
        list.innerHTML = batchHTML;
    }

    displayedCount = endIndex;

    if (displayedCount < currentFilteredUsers.length) {
        const loadingHTML = '<div id="loading-indicator" style="text-align: center; padding: 12px; color: #999; font-size: 0.75rem;">Scroll for more...</div>';
        list.insertAdjacentHTML('beforeend', loadingHTML);
    }
}

function setupInfiniteScroll() {
    const list = document.getElementById('registeredUsersList');

    list.addEventListener('scroll', () => {
        if (isLoadingMore) return;

        const scrollTop = list.scrollTop;
        const scrollHeight = list.scrollHeight;
        const clientHeight = list.clientHeight;

        if (scrollTop + clientHeight >= scrollHeight - 50) {
            loadMoreUsers();
        }
    });
}

function loadMoreUsers() {
    if (isLoadingMore || displayedCount >= currentFilteredUsers.length) return;

    isLoadingMore = true;

    const loadingIndicator = document.getElementById('loading-indicator');
    if (loadingIndicator) {
        loadingIndicator.remove();
    }

    setTimeout(() => {
        displayRegisteredUsers(currentFilteredUsers, true);
        isLoadingMore = false;
    }, 100);
}

document.addEventListener('DOMContentLoaded', () => {
    setupInfiniteScroll();
});

document.getElementById('userSearchBox')?.addEventListener('input', (e) => {
    const searchTerm = e.target.value.toLowerCase();
    const clearBtn = document.getElementById('clearSearchBtn');

    clearBtn.style.display = searchTerm ? 'flex' : 'none';
    applyFilters();
});

function applyFilters() {
    const searchTerm = document.getElementById('userSearchBox').value.toLowerCase();

    let filteredUsers = allRegisteredUsers.filter(user => {
        const firstName = (user.firstName || '').toLowerCase();
        const lastName = (user.lastName || '').toLowerCase();
        const email = (user.email || '').toLowerCase();

        return firstName.includes(searchTerm) ||
               lastName.includes(searchTerm) ||
               email.includes(searchTerm);
    });

    if (currentFilter === 'selected') {
        filteredUsers = filteredUsers.filter(user =>
            allowedParticipantEmails.includes((user.email || '').toLowerCase())
        );
    } else if (currentFilter === 'unselected') {
        filteredUsers = filteredUsers.filter(user =>
            !allowedParticipantEmails.includes((user.email || '').toLowerCase())
        );
    }

    displayRegisteredUsers(filteredUsers);
}

function clearSearch() {
    document.getElementById('userSearchBox').value = '';
    document.getElementById('clearSearchBtn').style.display = 'none';
    applyFilters();
}

function filterUsers(filter) {
    currentFilter = filter;

    document.querySelectorAll('.filter-btn').forEach(btn => btn.classList.remove('active'));
    event.target.classList.add('active');

    applyFilters();
}

async function loadAllowedParticipants(meetingId) {
    try {
        const participants = await api.getAllowedParticipants(meetingId);
        allowedParticipantEmails = participants.map(p => p.user_email.toLowerCase());

        const badge = document.getElementById('participant-badge-' + meetingId);
        if (badge) {
            const count = participants.length;
            badge.textContent = `${count} participant${count !== 1 ? 's' : ''}`;
        }
    } catch (error) {
        console.error('Error loading participants:', error);
    }
}

async function handleParticipantToggle(checkbox) {
    const userEmail = checkbox.dataset.email;
    const isChecked = checkbox.checked;

    if (!userEmail) {
        alert('Invalid user email');
        checkbox.checked = !isChecked;
        return;
    }

    checkbox.disabled = true;

    try {
        if (isChecked) {
            await api.addAllowedParticipant(currentMeetingId, userEmail);
            if (!allowedParticipantEmails.includes(userEmail.toLowerCase())) {
                allowedParticipantEmails.push(userEmail.toLowerCase());
            }
        } else {
            await api.removeAllowedParticipant(currentMeetingId, userEmail);
            const index = allowedParticipantEmails.indexOf(userEmail.toLowerCase());
            if (index > -1) {
                allowedParticipantEmails.splice(index, 1);
            }
        }

        await loadAllowedParticipants(currentMeetingId);
        checkbox.disabled = false;
        applyFilters();
    } catch (error) {
        checkbox.checked = !isChecked;
        checkbox.disabled = false;
        alert(`Failed to ${isChecked ? 'add' : 'remove'} participant: ${error.message}`);
    }
}

// ============================================
// MODAL FUNCTIONS
// ============================================

function closeModal(modalId) {
    document.getElementById(modalId).classList.remove('active');
}

window.onclick = function(event) {
    if (event.target.classList.contains('modal')) {
        const dialog = event.target.querySelector('.modal-dialog');
        dialog.style.animation = 'none';
        setTimeout(() => {
            dialog.style.animation = 'modalShake 0.5s';
        }, 10);
        setTimeout(() => {
            dialog.style.animation = '';
        }, 510);
    }
}

// ============================================
// RECORDING PLAYER
// ============================================

async function playRecording(meetingId) {
    try {
        const recordings = await api.getMeetingRecordings(meetingId);

        if (!recordings || recordings.length === 0) {
            alert('No recordings found for this meeting');
            return;
        }

        const modal = document.getElementById('recordingPlayerModal');
        const playerContainer = document.getElementById('recordingPlayerContainer');
        const listContainer = document.getElementById('recordingsListContainer');

        const firstRecording = recordings[0];
        if (firstRecording.recording_url) {
            playerContainer.innerHTML = `
                <video controls class="recording-video-player" id="recordingPlayer">
                    <source src="${firstRecording.recording_url}" type="video/mp4">
                    Your browser does not support the video tag.
                </video>
                <div class="recording-actions">
                    <button class="btn-copy-url" onclick="copyRecordingUrl('${firstRecording.recording_url}')" title="Copy recording URL">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                        </svg>
                        Copy URL
                    </button>
                    <a class="btn-download" href="${firstRecording.recording_url}" download title="Download recording">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                            <polyline points="7 10 12 15 17 10"/>
                            <line x1="12" y1="15" x2="12" y2="3"/>
                        </svg>
                        Download
                    </a>
                </div>
            `;
        } else {
            playerContainer.innerHTML = `<p class="recording-unavailable">Recording URL not available</p>`;
        }

        if (recordings.length > 1) {
            listContainer.innerHTML = `
                <div class="recordings-compact-list">
                    <div class="recordings-compact-header">
                        <span>${recordings.length} recordings</span>
                    </div>
                    ${recordings.map((rec, index) => {
                        const date = rec.started_at ? new Date(rec.started_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : 'No date';
                        const time = rec.started_at ? new Date(rec.started_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }) : '--:--';
                        const duration = rec.duration_seconds ? `${Math.floor(rec.duration_seconds / 60)}:${String(rec.duration_seconds % 60).padStart(2, '0')}` : '--:--';
                        return `
                        <div class="rec-item ${index === 0 ? 'playing' : ''}" onclick="loadRecording('${rec.recording_url}', ${index})">
                            <span class="rec-num">${index + 1}</span>
                            <div class="rec-details">
                                <span class="rec-date">${date} ${time}</span>
                                <span class="rec-dur">${duration}</span>
                            </div>
                            <button class="rec-copy" onclick="event.stopPropagation(); copyRecordingUrl('${rec.recording_url}')" title="Copy URL">
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                                </svg>
                            </button>
                            <button class="rec-play" onclick="event.stopPropagation(); loadRecording('${rec.recording_url}', ${index})">▶</button>
                        </div>
                    `;
                    }).join('')}
                </div>
            `;
        } else {
            listContainer.innerHTML = '<p class="single-recording-note">Only one recording available</p>';
        }

        modal.classList.add('active');
    } catch (error) {
        console.error('Error loading recordings:', error);
        alert('Failed to load recordings: ' + error.message);
    }
}

function loadRecording(url, index) {
    const player = document.getElementById('recordingPlayer');
    if (player && url) {
        player.src = url;
        player.load();
        player.play();

        document.querySelectorAll('.rec-item').forEach((item, i) => {
            item.classList.toggle('playing', i === index);
        });

        const copyBtn = document.querySelector('.btn-copy-url');
        const downloadBtn = document.querySelector('.btn-download');
        if (copyBtn) {
            copyBtn.onclick = () => copyRecordingUrl(url);
        }
        if (downloadBtn) {
            downloadBtn.href = url;
        }
    }
}

function copyRecordingUrl(url) {
    navigator.clipboard.writeText(url).then(() => {
        const btn = event?.target?.closest('button');
        if (btn) {
            const originalHTML = btn.innerHTML;
            btn.innerHTML = btn.classList.contains('rec-copy') ? '✓' : `
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="20 6 9 17 4 12"/>
                </svg>
                Copied!
            `;
            btn.style.color = '#10b981';
            setTimeout(() => {
                btn.innerHTML = originalHTML;
                btn.style.color = '';
            }, 2000);
        }
    }).catch(err => {
        console.error('Failed to copy URL:', err);
        alert('Failed to copy URL. Please copy manually: ' + url);
    });
}

function closeRecordingPlayer() {
    const modal = document.getElementById('recordingPlayerModal');
    const player = document.getElementById('recordingPlayer');

    if (player) {
        player.pause();
    }

    modal.classList.remove('active');
}

// ============================================
// MEETING SETTINGS MODAL
// ============================================

let currentSettingsMeeting = null;
let settingsSelectedParticipants = [];
let settingsAllUsers = [];

async function showMeetingSettingsModal(meetingId, type) {
    const modal = document.getElementById('meetingSettingsModal');
    document.getElementById('settingsMeetingId').value = meetingId;
    document.getElementById('settingsMeetingType').value = type;

    const saveBtn = modal.querySelector('.btn-primary');
    if (saveBtn) saveBtn.disabled = true;

    try {
        let meeting = null;

        const projects = await api.getProjects();
        for (const project of projects) {
            const meetings = await api.getProjectMeetings(project.id);
            meeting = meetings.find(m => m.id === meetingId);
            if (meeting) break;
        }

        if (!meeting) {
            try {
                const hostedMeetings = await api.getHostedMeetings();
                meeting = hostedMeetings.find(m => m.id === meetingId);
            } catch (err) {
                console.log('Error fetching hosted meetings:', err);
            }
        }

        if (!meeting) {
            alert('Meeting not found');
            return;
        }

        currentSettingsMeeting = meeting;

        // Update meeting type display
        const typeDisplay = document.getElementById('settingsMeetingTypeDisplay');
        typeDisplay.innerHTML = getTypeBadgeHTML(type);

        await populateSettingsHostDropdown(meeting.host_user_id);

        document.getElementById('settingsAllowGuests').checked = meeting.allow_guests || false;
        document.getElementById('settingsAutoRecording').checked = meeting.auto_recording || false;

        if (meeting.host_user_id) {
            document.getElementById('settingsHost').value = meeting.host_user_id;
        }

        // Show/hide fields based on meeting type
        const allowGuestsGroup = document.getElementById('allowGuestsSettingGroup');
        const hostGroup = document.getElementById('hostSettingGroup');
        const hostHelp = document.getElementById('hostSettingHelp');
        const participantsGroup = document.getElementById('settingsParticipantsGroup');

        if (type === 'participant-controlled') {
            allowGuestsGroup.style.display = 'none';
            hostGroup.style.display = 'block';
            hostHelp.textContent = 'If set, the host must start the meeting before allowed participants can join';
            participantsGroup.style.display = 'block';
            await loadSettingsParticipantsList(meetingId);
        } else if (type === 'hosted') {
            allowGuestsGroup.style.display = 'block';
            hostGroup.style.display = 'block';
            hostHelp.textContent = 'Required - the host must start the meeting before others can join';
            participantsGroup.style.display = 'none';
        } else {
            allowGuestsGroup.style.display = 'block';
            hostGroup.style.display = 'none';
            participantsGroup.style.display = 'none';
        }

        const warningDiv = document.getElementById('settingsInProgressWarning');
        const isStarted = meeting.is_started || false;

        if (isStarted) {
            warningDiv.style.display = 'flex';
            document.getElementById('settingsAllowGuests').disabled = true;
            document.getElementById('settingsHost').disabled = true;
            document.getElementById('settingsAutoRecording').disabled = true;
            if (saveBtn) saveBtn.disabled = true;
        } else {
            warningDiv.style.display = 'none';
            document.getElementById('settingsAllowGuests').disabled = false;
            document.getElementById('settingsHost').disabled = false;
            document.getElementById('settingsAutoRecording').disabled = false;
            if (saveBtn) saveBtn.disabled = false;
        }

        modal.classList.add('active');

    } catch (error) {
        console.error('Error loading meeting settings:', error);
        alert('Failed to load meeting settings: ' + error.message);
    }
}

async function loadSettingsParticipantsList(meetingId) {
    const list = document.getElementById('settingsUsersList');
    const countDisplay = document.getElementById('settingsParticipantsCount');

    list.innerHTML = '<p class="loading-text">Loading users...</p>';

    try {
        // Load allowed participants first
        const participants = await api.getAllowedParticipants(meetingId);
        settingsSelectedParticipants = participants.map(p => p.user_email.toLowerCase());

        // Load all users
        settingsAllUsers = await api.getAllUsers();
        renderSettingsUsersList(settingsAllUsers);
        countDisplay.textContent = settingsSelectedParticipants.length;
    } catch (error) {
        console.error('Error loading users:', error);
        list.innerHTML = '<p class="error-text">Failed to load users</p>';
    }
}

function renderSettingsUsersList(users) {
    const list = document.getElementById('settingsUsersList');

    if (users.length === 0) {
        list.innerHTML = '<p class="empty-text">No users found</p>';
        return;
    }

    list.innerHTML = users.map(user => {
        const email = user.email || '';
        const firstName = user.firstName || '';
        const lastName = user.lastName || '';
        const isSelected = settingsSelectedParticipants.includes(email.toLowerCase());

        return `
            <div class="user-select-item-inline ${isSelected ? 'selected' : ''}">
                <div class="user-info-inline">
                    <span class="user-name-inline">${firstName} ${lastName}</span>
                    <span class="user-email-inline">${email}</span>
                </div>
                <label class="checkbox-inline ${!email ? 'disabled' : ''}">
                    <input type="checkbox"
                           value="${email}"
                           data-email="${email}"
                           ${isSelected ? 'checked' : ''}
                           ${!email ? 'disabled' : ''}
                           onchange="handleSettingsParticipantToggle(this)">
                    <span class="checkmark-inline"></span>
                </label>
            </div>
        `;
    }).join('');
}

async function handleSettingsParticipantToggle(checkbox) {
    const email = checkbox.dataset.email.toLowerCase();
    const isChecked = checkbox.checked;
    const meetingId = document.getElementById('settingsMeetingId').value;

    checkbox.disabled = true;

    try {
        if (isChecked) {
            await api.addAllowedParticipant(meetingId, email);
            if (!settingsSelectedParticipants.includes(email)) {
                settingsSelectedParticipants.push(email);
            }
        } else {
            await api.removeAllowedParticipant(meetingId, email);
            const index = settingsSelectedParticipants.indexOf(email);
            if (index > -1) {
                settingsSelectedParticipants.splice(index, 1);
            }
        }

        document.getElementById('settingsParticipantsCount').textContent = settingsSelectedParticipants.length;
        checkbox.closest('.user-select-item-inline').classList.toggle('selected', isChecked);
        checkbox.disabled = false;
    } catch (error) {
        checkbox.checked = !isChecked;
        checkbox.disabled = false;
        alert(`Failed to ${isChecked ? 'add' : 'remove'} participant: ${error.message}`);
    }
}

document.getElementById('settingsUserSearch')?.addEventListener('input', (e) => {
    const searchTerm = e.target.value.toLowerCase();
    const filtered = settingsAllUsers.filter(user => {
        const firstName = (user.firstName || '').toLowerCase();
        const lastName = (user.lastName || '').toLowerCase();
        const email = (user.email || '').toLowerCase();
        return firstName.includes(searchTerm) || lastName.includes(searchTerm) || email.includes(searchTerm);
    });
    renderSettingsUsersList(filtered);
});

async function populateSettingsHostDropdown(currentHostId = null) {
    const hostSelect = document.getElementById('settingsHost');
    hostSelect.innerHTML = '<option value="">No host (open meeting)</option>';

    try {
        const users = await api.getAllUsers();
        users.forEach(user => {
            const option = document.createElement('option');
            option.value = user.userId;
            option.textContent = `${user.firstName} ${user.lastName} (${user.email})`;
            if (currentHostId && user.userId === currentHostId) {
                option.selected = true;
            }
            hostSelect.appendChild(option);
        });
    } catch (error) {
        console.error('Error fetching users for host selection:', error);
    }
}

async function saveMeetingSettings() {
    const meetingId = document.getElementById('settingsMeetingId').value;
    const type = document.getElementById('settingsMeetingType').value;
    const allowGuests = document.getElementById('settingsAllowGuests').checked;
    const hostUserId = document.getElementById('settingsHost').value || null;
    const autoRecording = document.getElementById('settingsAutoRecording').checked;

    if (type === 'hosted' && !hostUserId) {
        alert('Host is required for hosted meetings');
        return;
    }

    const saveBtn = document.querySelector('#meetingSettingsModal .btn-primary');
    const originalText = saveBtn.textContent;
    saveBtn.textContent = 'Saving...';
    saveBtn.disabled = true;

    try {
        if (currentSettingsMeeting && currentSettingsMeeting.allow_guests !== allowGuests) {
            await api.toggleAllowGuests(meetingId, allowGuests);
        }

        if (currentSettingsMeeting && currentSettingsMeeting.auto_recording !== autoRecording) {
            await api.toggleAutoRecording(meetingId, autoRecording);
        }

        if (currentSettingsMeeting && currentSettingsMeeting.host_user_id !== hostUserId) {
            await api.updateMeetingHost(meetingId, hostUserId);
        }

        closeModal('meetingSettingsModal');
        loadAllProjects();

    } catch (error) {
        console.error('Error saving meeting settings:', error);
        alert('Failed to save settings: ' + error.message);
    } finally {
        saveBtn.textContent = originalText;
        saveBtn.disabled = false;
    }
}

// ============================================
// SIGNALR FOR REAL-TIME HOST CHANGE NOTIFICATIONS
// ============================================

let dashboardConnection = null;

async function initDashboardSignalR() {
    const currentUser = api.getUser();
    if (!currentUser || !currentUser.userId) {
        console.log('No user logged in, skipping SignalR connection');
        return;
    }

    try {
        dashboardConnection = new signalR.HubConnectionBuilder()
            .withUrl(CONFIG.signalRHubUrl, {
                accessTokenFactory: () => localStorage.getItem('authToken')
            })
            .withAutomaticReconnect()
            .build();

        dashboardConnection.on('HostRemovedFromMeeting', (data) => {
            console.log('Host removed from meeting:', data);
            loadAllProjects();
        });

        dashboardConnection.on('HostAddedToMeeting', (data) => {
            console.log('Host added to meeting:', data);
            loadAllProjects();
        });

        await dashboardConnection.start();
        console.log('Dashboard SignalR connected');

        await dashboardConnection.invoke('JoinDashboard', currentUser.userId);
        console.log('Joined dashboard notification group for user:', currentUser.userId);

    } catch (error) {
        console.error('Failed to connect to dashboard SignalR:', error);
    }
}

// ============================================
// INITIALIZE DASHBOARD
// ============================================

if (document.querySelector('.dashboard')) {
    document.addEventListener('DOMContentLoaded', () => {
        loadAllProjects();
        initDashboardSignalR();
    });

    window.addEventListener('beforeunload', async () => {
        if (dashboardConnection) {
            const currentUser = api.getUser();
            if (currentUser && currentUser.userId) {
                try {
                    await dashboardConnection.invoke('LeaveDashboard', currentUser.userId);
                } catch (e) {
                    // Ignore errors during page unload
                }
            }
            await dashboardConnection.stop();
        }
    });
}
