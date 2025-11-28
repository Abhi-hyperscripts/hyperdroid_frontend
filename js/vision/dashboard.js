// Dashboard page JavaScript
let currentProjectId = null;
let currentMeetingType = 'regular';

// Check authentication
if (!api.isAuthenticated()) {
    window.location.href = '../login.html';
}

// Display user avatar with initials
const user = api.getUser();
if (user) {
    // Generate initials for avatar
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

// Toggle user dropdown menu (make it globally accessible)
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

// Load projects
async function loadProjects() {
    try {
        const projects = await api.getProjects();
        const grid = document.getElementById('projectsGrid');
        grid.innerHTML = '';

        if (projects.length === 0) {
            grid.innerHTML = '<p style="grid-column: 1/-1; text-align: center;">No projects yet. Create one to get started!</p>';
            return;
        }

        projects.forEach(project => {
            const card = document.createElement('div');
            card.className = 'project-card';
            card.innerHTML = `
                <h3>${project.project_name}</h3>
                <p>${project.description || 'No description'}</p>
                <div class="project-actions">
                    <button onclick="viewProject('${project.id}')" class="btn btn-primary">View Meetings</button>
                    <button onclick="deleteProject('${project.id}')" class="btn btn-danger">Delete</button>
                </div>
            `;
            grid.appendChild(card);
        });
    } catch (error) {
        console.error('Error loading projects:', error);
        alert('Failed to load projects');
    }
}

// Create project
document.getElementById('createProjectForm').addEventListener('submit', async (e) => {
    e.preventDefault();

    const projectName = document.getElementById('projectName').value;
    const description = document.getElementById('projectDescription').value;

    try {
        await api.createProject(projectName, description);
        closeModal('createProjectModal');
        document.getElementById('createProjectForm').reset();
        // Reload the current tab's projects
        if (typeof loadProjectsByType === 'function') {
            loadProjectsByType(currentMeetingType);
        }
    } catch (error) {
        alert('Failed to create project: ' + error.message);
    }
});

// View project meetings
async function viewProject(projectId) {
    currentProjectId = projectId;

    try {
        const meetings = await api.getProjectMeetings(projectId);
        document.getElementById('viewProjectModal').classList.add('active');

        const container = document.getElementById('meetingsContainer');
        container.innerHTML = '';

        if (meetings.length === 0) {
            container.innerHTML = '<p>No meetings yet. Create one to get started!</p>';
            return;
        }

        meetings.forEach(meeting => {
            const meetingDiv = document.createElement('div');
            meetingDiv.className = 'project-card';
            meetingDiv.style.marginBottom = '15px';

            // Add visual indicator for inactive meetings
            const isActive = meeting.is_active !== false; // Default to true if undefined
            if (!isActive) {
                meetingDiv.style.opacity = '0.7';
                meetingDiv.style.border = '2px dashed #ffc107';
            }

            const meetingType = meeting.meeting_type === 'hosted'
                ? 'Hosted Meeting'
                : meeting.meeting_type === 'participant-controlled'
                    ? 'Participant-Controlled'
                    : 'Open Meeting';
            const meetingTypeColor = meeting.meeting_type === 'hosted'
                ? '#6f42c1'
                : meeting.meeting_type === 'participant-controlled'
                    ? '#e83e8c'
                    : '#17a2b8';

            // Add inactive badge
            const activeBadge = !isActive
                ? '<span style="background: #ffc107; color: #000; padding: 2px 8px; border-radius: 12px; font-size: 11px; margin-left: 8px;">⏸ Inactive</span>'
                : '';

            const guestLinkHtml = meeting.meeting_type === 'participant-controlled'
                ? `<p style="color: #e83e8c; font-weight: bold;">🔒 Participant-Controlled Meeting</p>
                   <p style="font-size: 12px;">Only allowed users can join this meeting.</p>
                   <button onclick="manageParticipants('${meeting.id}')" class="btn btn-secondary" style="font-size: 12px; padding: 4px 8px; margin-top: 5px;">Manage Allowed Participants</button>`
                : meeting.allow_guests
                    ? `<p style="color: #28a745; font-weight: bold;">✓ Guest access enabled</p>
                       <p style="font-size: 12px;">Guest link: <code style="background: #f0f0f0; padding: 2px 6px; border-radius: 3px;">${window.location.origin}/pages/vision/guest-join.html?id=${meeting.id}</code>
                       <button onclick="copyGuestLink('${meeting.id}')" class="btn btn-secondary" style="font-size: 12px; padding: 4px 8px;">Copy Link</button></p>`
                    : '<p style="color: #999;">Guest access disabled - sign in required</p>';

            const recordingBadge = meeting.auto_recording
                ? '<span style="background: #dc3545; color: white; padding: 2px 8px; border-radius: 12px; font-size: 11px; margin-left: 8px;">⏺ Auto-Recording</span>'
                : '<span style="background: #6c757d; color: white; padding: 2px 8px; border-radius: 12px; font-size: 11px; margin-left: 8px;">⏺ Manual</span>';

            const isStarted = meeting.is_started || false;
            const lockIndicator = isStarted ? ' <span style="color: #ffc107;">🔒</span>' : '';
            const disabledAttr = isStarted ? 'disabled' : '';
            const disabledStyle = isStarted ? 'opacity: 0.6; cursor: not-allowed;' : 'cursor: pointer;';

            // Show host info for hosted meetings
            const hostInfo = meeting.meeting_type === 'hosted' && meeting.host_user_id
                ? `<p style="color: #6f42c1;"><strong>Host:</strong> ${meeting.host_user_id}</p>`
                : '';

            // Meeting link (always shown for all meetings)
            const meetingLink = `${window.location.origin}/pages/vision/lobby.html?id=${meeting.id}`;
            const meetingLinkHtml = `
                <p style="font-size: 12px; margin-top: 10px;">
                    <strong>Meeting Link:</strong>
                    <code style="background: #f0f0f0; padding: 2px 6px; border-radius: 3px; font-size: 11px;">${meetingLink}</code>
                    <button onclick="copyMeetingLink('${meeting.id}')" class="btn btn-secondary" style="font-size: 12px; padding: 4px 8px; margin-left: 5px;">Copy Link</button>
                </p>
            `;

            meetingDiv.innerHTML = `
                <div style="display: flex; justify-content: space-between; align-items: center;">
                    <h4>${meeting.meeting_name} <span style="background: ${meetingTypeColor}; color: white; padding: 2px 8px; border-radius: 12px; font-size: 11px;">${meetingType}</span>${recordingBadge}${activeBadge}${lockIndicator}</h4>
                </div>
                ${!isActive ? '<p style="color: #856404; background: #fff3cd; padding: 8px; border-radius: 4px; font-size: 13px;">⏸ This meeting is currently inactive. It will automatically reactivate when someone joins.</p>' : ''}
                <p>${meeting.notes || 'No notes'}</p>
                ${meeting.start_time ? `<p><strong>Start:</strong> ${new Date(meeting.start_time).toLocaleString()}</p>` : ''}
                ${meeting.end_time ? `<p><strong>End:</strong> ${new Date(meeting.end_time).toLocaleString()}</p>` : ''}
                ${hostInfo}
                ${meetingLinkHtml}
                ${guestLinkHtml}
                ${isStarted ? '<p style="color: #ffc107; font-size: 12px;">🔒 Settings locked while meeting is in progress</p>' : ''}
                <div style="margin-top: 10px; display: flex; gap: 15px; align-items: center;">
                    ${meeting.meeting_type !== 'participant-controlled' ? `
                    <label style="display: flex; align-items: center; font-size: 14px; ${disabledStyle}">
                        <input type="checkbox" id="allowGuests_${meeting.id}" ${meeting.allow_guests ? 'checked' : ''} ${disabledAttr}
                               onchange="toggleAllowGuests('${meeting.id}', this.checked)" style="margin-right: 5px;">
                        Allow Guests
                    </label>` : ''}
                    <label style="display: flex; align-items: center; font-size: 14px; ${disabledStyle}">
                        <input type="checkbox" id="autoRecording_${meeting.id}" ${meeting.auto_recording ? 'checked' : ''} ${disabledAttr}
                               onchange="toggleAutoRecording('${meeting.id}', this.checked)" style="margin-right: 5px;">
                        Auto-Recording
                    </label>
                </div>
                <div class="project-actions">
                    <button onclick="joinMeeting('${meeting.id}')" class="btn btn-success">Join Meeting</button>
                    <button onclick="deleteMeeting('${meeting.id}')" class="btn btn-danger">Delete</button>
                </div>
            `;
            container.appendChild(meetingDiv);
        });
    } catch (error) {
        alert('Failed to load meetings: ' + error.message);
    }
}

// Create meeting
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
    // Use current tab's meeting type instead of non-existent select element
    const meetingType = currentMeetingType;
    const autoRecording = document.getElementById('autoRecording').checked;
    const hostUserId = (meetingType === 'hosted' || meetingType === 'participant-controlled')
        ? (document.getElementById('meetingHost').value || null)
        : null;

    // Validate host selection for hosted meetings
    if (meetingType === 'hosted' && !hostUserId) {
        alert('Please select a host for the hosted meeting');
        return;
    }

    try {
        await api.createMeeting(currentProjectId, meetingName, startTime, endTime, notes, allowGuests, meetingType, autoRecording, hostUserId);
        closeModal('createMeetingModal');
        document.getElementById('createMeetingForm').reset();
        viewProject(currentProjectId);
    } catch (error) {
        alert('Failed to create meeting: ' + error.message);
    }
});

// Delete project
async function deleteProject(projectId) {
    if (!confirm('Are you sure you want to delete this project?')) return;

    try {
        await api.deleteProject(projectId);
        // Reload the current tab's projects
        if (typeof loadProjectsByType === 'function') {
            loadProjectsByType(currentMeetingType);
        }
    } catch (error) {
        alert('Failed to delete project: ' + error.message);
    }
}

// Delete meeting
async function deleteMeeting(meetingId) {
    if (!confirm('Are you sure you want to delete this meeting?')) return;

    try {
        await api.deleteMeeting(meetingId);
        viewProject(currentProjectId);
    } catch (error) {
        alert('Failed to delete meeting: ' + error.message);
    }
}

// Handle auto-recording toggle
async function handleAutoRecordingToggle(meetingId, value) {
    try {
        await api.toggleAutoRecording(meetingId, value);
        // No need to reload - the checkbox state is already updated
        console.log(`Auto-recording ${value ? 'enabled' : 'disabled'} for meeting ${meetingId}`);
    } catch (error) {
        console.error('Failed to toggle auto-recording:', error);
        alert('Failed to toggle auto-recording: ' + error.message);
        // Revert the checkbox
        const checkbox = document.getElementById(`autoRecording-${meetingId}`);
        if (checkbox) {
            checkbox.checked = !value;
        }
    }
}

// Join meeting
function joinMeeting(meetingId) {
    window.location.href = `lobby.html?id=${meetingId}`;
}

// Copy meeting link to clipboard
function copyMeetingLink(meetingId) {
    const link = `${window.location.origin}/pages/vision/lobby.html?id=${meetingId}`;
    navigator.clipboard.writeText(link).then(() => {
        alert('Meeting link copied to clipboard!');
    }).catch(() => {
        // Fallback for older browsers
        const textArea = document.createElement('textarea');
        textArea.value = link;
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
        alert('Meeting link copied to clipboard!');
    });
}

// Copy guest link to clipboard
function copyGuestLink(meetingId) {
    const link = `${window.location.origin}/pages/vision/guest-join.html?id=${meetingId}`;
    navigator.clipboard.writeText(link).then(() => {
        alert('Guest link copied to clipboard!');
    }).catch(() => {
        // Fallback for older browsers
        const textArea = document.createElement('textarea');
        textArea.value = link;
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
        alert('Guest link copied to clipboard!');
    });
}

// Modal functions
function showCreateProjectModal() {
    document.getElementById('createProjectModal').classList.add('active');
}

async function showCreateMeetingModal() {
    closeModal('viewProjectModal');
    document.getElementById('createMeetingModal').classList.add('active');

    // Fetch and populate users for host selection
    await fetchAndPopulateUsers();
}

function closeModal(modalId) {
    document.getElementById(modalId).classList.remove('active');
}

// Static backdrop - modals only close via close button
// Add shake animation when clicking outside to indicate static backdrop
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

// Toggle allow guests
async function toggleAllowGuests(meetingId, value) {
    try {
        await api.toggleAllowGuests(meetingId, value);
        viewProject(currentProjectId);
    } catch (error) {
        const errorMsg = error.message.includes('Cannot change') || error.message.includes('locked')
            ? 'Cannot change guest access while meeting is in progress. Please wait until the meeting ends.'
            : 'Failed to toggle guest access: ' + error.message;
        alert(errorMsg);
        // Revert checkbox
        document.getElementById(`allowGuests_${meetingId}`).checked = !value;
    }
}

// Toggle auto recording
async function toggleAutoRecording(meetingId, value) {
    try {
        await api.toggleAutoRecording(meetingId, value);
        viewProject(currentProjectId);
    } catch (error) {
        const errorMsg = error.message.includes('Cannot change') || error.message.includes('locked')
            ? 'Cannot change auto-recording while meeting is in progress. Please wait until the meeting ends.'
            : 'Failed to toggle auto-recording: ' + error.message;
        alert(errorMsg);
        // Revert checkbox
        document.getElementById(`autoRecording_${meetingId}`).checked = !value;
    }
}

// Fetch and populate users for host selection
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

// Show/hide host selection based on meeting type (only for old dashboard)
const meetingTypeSelect = document.getElementById('meetingType');
if (meetingTypeSelect) {
    meetingTypeSelect.addEventListener('change', (e) => {
        const hostGroup = document.getElementById('hostSelectionGroup');
        const hostSelect = document.getElementById('meetingHost');
        const hostLabel = hostGroup.querySelector('label');
        const hostHelp = hostGroup.querySelector('small');

        if (e.target.value === 'hosted') {
            hostGroup.style.display = 'block';
            hostSelect.required = true;
            hostLabel.innerHTML = 'Host <span style="color: red;">*</span>';
            hostHelp.textContent = 'Required for hosted meetings';
        } else if (e.target.value === 'participant-controlled') {
            hostGroup.style.display = 'block';
            hostSelect.required = false;
            hostLabel.textContent = 'Host (Optional)';
            hostHelp.textContent = 'If set, the host must start the meeting before allowed participants can join';
        } else {
            hostGroup.style.display = 'none';
            hostSelect.required = false;
            hostSelect.value = '';
        }
    });
}

// Manage allowed participants
let currentMeetingId = null;
let allRegisteredUsers = [];
let allowedParticipantEmails = [];

// Infinite scroll variables
let currentFilteredUsers = [];
let displayedCount = 0;
const BATCH_SIZE = 50;
let isLoadingMore = false;

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
        displayRegisteredUsers(currentFilteredUsers, false); // false = reset list
    } catch (error) {
        console.error('Error loading users:', error);
        document.getElementById('registeredUsersList').innerHTML =
            '<p style="color: #dc3545; text-align: center;">Failed to load users</p>';
    }
}

let currentFilter = 'all'; // all, selected, unselected

function displayRegisteredUsers(users, append = false) {
    const list = document.getElementById('registeredUsersList');
    const countDisplay = document.getElementById('userCountDisplay');

    // Update current filtered users
    if (!append) {
        currentFilteredUsers = users;
        displayedCount = 0;
    }

    // Update count
    const totalUsers = allRegisteredUsers.length;
    const filteredCount = currentFilteredUsers.length;
    countDisplay.textContent = filteredCount === totalUsers
        ? `${totalUsers} user${totalUsers !== 1 ? 's' : ''}`
        : `${filteredCount} of ${totalUsers} users`;

    if (currentFilteredUsers.length === 0) {
        list.innerHTML = '<p style="text-align: center; color: #999; font-size: 0.75rem; padding: 20px;">No users found</p>';
        return;
    }

    // Calculate batch to display
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

    // Add loading indicator if there are more users
    if (displayedCount < currentFilteredUsers.length) {
        const loadingHTML = '<div id="loading-indicator" style="text-align: center; padding: 12px; color: #999; font-size: 0.75rem;">Scroll for more...</div>';
        list.insertAdjacentHTML('beforeend', loadingHTML);
    }
}

// Setup infinite scroll
function setupInfiniteScroll() {
    const list = document.getElementById('registeredUsersList');

    list.addEventListener('scroll', () => {
        if (isLoadingMore) return;

        const scrollTop = list.scrollTop;
        const scrollHeight = list.scrollHeight;
        const clientHeight = list.clientHeight;

        // Check if scrolled near bottom (within 50px)
        if (scrollTop + clientHeight >= scrollHeight - 50) {
            loadMoreUsers();
        }
    });
}

function loadMoreUsers() {
    if (isLoadingMore || displayedCount >= currentFilteredUsers.length) return;

    isLoadingMore = true;

    // Remove loading indicator
    const loadingIndicator = document.getElementById('loading-indicator');
    if (loadingIndicator) {
        loadingIndicator.remove();
    }

    // Small delay to simulate loading (optional, for UX)
    setTimeout(() => {
        displayRegisteredUsers(currentFilteredUsers, true); // true = append
        isLoadingMore = false;
    }, 100);
}

// Initialize infinite scroll when modal opens
document.addEventListener('DOMContentLoaded', () => {
    setupInfiniteScroll();
});

// Search functionality
document.getElementById('userSearchBox').addEventListener('input', (e) => {
    const searchTerm = e.target.value.toLowerCase();
    const clearBtn = document.getElementById('clearSearchBtn');

    // Show/hide clear button
    clearBtn.style.display = searchTerm ? 'flex' : 'none';

    // Apply search filter
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

    // Apply selection filter
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

    // Update button states
    document.querySelectorAll('.filter-btn').forEach(btn => btn.classList.remove('active'));
    event.target.classList.add('active');

    applyFilters();
}

async function loadAllowedParticipants(meetingId) {
    try {
        const participants = await api.getAllowedParticipants(meetingId);
        allowedParticipantEmails = participants.map(p => p.user_email.toLowerCase());

        // Update participant count badge in dashboard (if it exists)
        const badge = document.getElementById('participant-badge-' + meetingId);
        if (badge) {
            const count = participants.length;
            badge.textContent = `${count} participant${count !== 1 ? 's' : ''}`;
        }
    } catch (error) {
        console.error('Error loading participants:', error);
        // Don't alert, just log the error
    }
}

// Handle participant checkbox toggle (add/remove)
async function handleParticipantToggle(checkbox) {
    const userEmail = checkbox.dataset.email;
    const isChecked = checkbox.checked;

    // Validate email
    if (!userEmail) {
        alert('Invalid user email');
        checkbox.checked = !isChecked;
        return;
    }

    // Disable the checkbox while processing
    checkbox.disabled = true;

    try {
        if (isChecked) {
            // Add participant
            await api.addAllowedParticipant(currentMeetingId, userEmail);
            // Update local state
            if (!allowedParticipantEmails.includes(userEmail.toLowerCase())) {
                allowedParticipantEmails.push(userEmail.toLowerCase());
            }
        } else {
            // Remove participant
            await api.removeAllowedParticipant(currentMeetingId, userEmail);
            // Update local state
            const index = allowedParticipantEmails.indexOf(userEmail.toLowerCase());
            if (index > -1) {
                allowedParticipantEmails.splice(index, 1);
            }
        }

        // Reload allowed participants list to show updated state
        await loadAllowedParticipants(currentMeetingId);

        // Re-enable the checkbox
        checkbox.disabled = false;

        // Refresh the user list to update checkmarks and counts
        applyFilters();
    } catch (error) {
        // Revert checkbox state on error
        checkbox.checked = !isChecked;
        checkbox.disabled = false;
        alert(`Failed to ${isChecked ? 'add' : 'remove'} participant: ${error.message}`);
    }
}

// Load projects on page load (disabled for new dashboard - using tab-based loading instead)
// loadProjects();

// ============================================
// TAB SWITCHING FUNCTIONALITY
// ============================================

function switchMeetingType(type) {
    currentMeetingType = type;
    
    // Update tab buttons
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.remove('active');
        if (btn.dataset.type === type) {
            btn.classList.add('active');
        }
    });
    
    // Update tab content
    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.remove('active');
    });
    document.getElementById(type + '-tab').classList.add('active');
    
    // Load projects for this meeting type
    loadProjectsByType(type);
}

// ============================================
// LOAD PROJECTS BY MEETING TYPE
// ============================================

async function loadProjectsByType(type) {
    try {
        const projects = await api.getProjects();
        const container = document.getElementById(type + 'Projects');

        // Filter projects by meeting type (check meetings)
        const filteredProjects = await Promise.all(
            projects.map(async (project) => {
                const meetings = await api.getProjectMeetings(project.id);
                const typeMeetings = meetings.filter(m => m.meeting_type === type);

                // Fetch recordings and participant count for each meeting
                const meetingsWithRecordings = await Promise.all(
                    typeMeetings.map(async (meeting) => {
                        try {
                            const recordings = await api.getMeetingRecordings(meeting.id);
                            let participantCount = 0;

                            // Fetch participant count only for participant-controlled meetings
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

                return { ...project, meetings: meetingsWithRecordings };
            })
        );

        const projectsWithMeetings = filteredProjects.filter(p => p.meetings.length > 0);

        if (projectsWithMeetings.length === 0) {
            container.innerHTML = '<div class="empty-state"><div class="empty-state-icon">' + getTypeIcon(type) + '</div><h3>No ' + getTypeLabel(type) + ' yet</h3><p>Create your first project to get started</p><button onclick="showCreateProjectModal(\'' + type + '\')" class="btn btn-primary">+ Create Project</button></div>';
            return;
        }

        container.innerHTML = projectsWithMeetings.map(project => createProjectAccordionHTML(project, type)).join('');

    } catch (error) {
        console.error('Error loading projects:', error);
    }
}

function getTypeIcon(type) {
    const icons = {
        'regular': '🌐',
        'hosted': '🎯',
        'participant-controlled': '🔒'
    };
    return icons[type] || '📁';
}

function getTypeLabel(type) {
    const labels = {
        'regular': 'Open Meetings',
        'hosted': 'Hosted Meetings',
        'participant-controlled': 'Private Meetings'
    };
    return labels[type] || 'Meetings';
}

// Initialize dashboard on page load
if (document.querySelector('.dashboard')) {
    document.addEventListener('DOMContentLoaded', () => {
        switchMeetingType('regular');
    });
}

// ============================================
// ACCORDION HTML GENERATION
// ============================================

function createProjectAccordionHTML(project, type) {
    const meetingsList = project.meetings.map(meeting => createMeetingItemHTML(meeting, type)).join('');
    const uniqueId = `${type}-${project.id}`; // Make ID unique per tab

    return `
        <div class="project-accordion-item" id="project-${uniqueId}">
            <div class="project-accordion-header" onclick="toggleProject('${uniqueId}')">
                <div class="project-info">
                    <h3>${project.project_name}</h3>
                    <p>${project.description || 'No description'}</p>
                    <span class="meeting-count">${project.meetings.length} ${project.meetings.length === 1 ? 'meeting' : 'meetings'}</span>
                </div>
                <div class="accordion-actions">
                    <button class="btn btn-sm btn-primary" onclick="event.stopPropagation(); showCreateMeetingModalForProject('${project.id}', '${type}')">
                        + Add Meeting
                    </button>
                    <button class="btn btn-sm btn-danger" onclick="event.stopPropagation(); confirmDeleteProject('${project.id}')">
                        Delete Project
                    </button>
                    <span class="accordion-chevron" id="chevron-${uniqueId}">▼</span>
                </div>
            </div>
            <div class="project-accordion-body" id="meetings-${uniqueId}">
                <div class="meetings-list">
                    ${meetingsList}
                </div>
            </div>
        </div>
    `;
}

function createMeetingItemHTML(meeting, type) {
    const status = getMeetingStatus(meeting);
    const hasRecordings = meeting.recordings && meeting.recordings.length > 0;
    const participantCount = meeting.participant_count || 0;

    // Format date more compactly
    const dateStr = meeting.start_time
        ? new Date(meeting.start_time).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
        : '';

    return `
        <div class="meeting-card" id="meeting-${meeting.id}">
            <div class="meeting-card-header">
                <div class="meeting-card-title">
                    <h4>${meeting.meeting_name}</h4>
                    <div class="meeting-card-badges">
                        ${dateStr ? `<span class="badge badge-date">${dateStr}</span>` : ''}
                        <span class="badge badge-status badge-${status.toLowerCase()}">${status}</span>
                        ${type === 'participant-controlled' ? `<span class="badge badge-participants" id="participant-badge-${meeting.id}">${participantCount} participant${participantCount !== 1 ? 's' : ''}</span>` : ''}
                        ${hasRecordings ? `<span class="badge badge-recording badge-clickable" onclick="event.stopPropagation(); playRecording('${meeting.id}')" title="View ${meeting.recordings.length} recording${meeting.recordings.length > 1 ? 's' : ''}">${meeting.recordings.length} rec</span>` : ''}
                    </div>
                </div>
                <div class="meeting-card-actions">
                    <button class="btn-icon btn-primary" onclick="joinMeeting('${meeting.id}')" title="Join Meeting">
                        <span>Join</span>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/>
                            <polyline points="10 17 15 12 10 7"/>
                            <line x1="15" y1="12" x2="3" y2="12"/>
                        </svg>
                    </button>
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
                    <label class="toggle-auto-rec" title="Auto Recording">
                        <input type="checkbox" id="autoRecording-${meeting.id}" ${meeting.auto_recording ? 'checked' : ''}
                               onchange="handleAutoRecordingToggle('${meeting.id}', this.checked)">
                        <span class="toggle-slider"></span>
                    </label>
                    <button class="btn-icon btn-danger" onclick="confirmDeleteMeeting('${meeting.id}')" title="Delete">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="3 6 5 6 21 6"/>
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                        </svg>
                    </button>
                </div>
            </div>
            ${meeting.notes && meeting.notes !== 'No notes' ? `<div class="meeting-card-notes">${meeting.notes}</div>` : ''}
        </div>
    `;
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
// ACCORDION TOGGLE FUNCTIONS
// ============================================

function toggleProject(projectId) {
    try {
        const item = document.getElementById('project-' + projectId);
        if (!item) {
            console.error('Project accordion item not found for ID:', projectId);
            return;
        }

        const wasExpanded = item.classList.contains('expanded');
        item.classList.toggle('expanded');
        const isExpanded = item.classList.contains('expanded');

        console.log(`Accordion toggle - Project ${projectId}: ${wasExpanded ? 'expanded' : 'collapsed'} → ${isExpanded ? 'expanded' : 'collapsed'}`);
    } catch (error) {
        console.error('Error toggling accordion:', error);
    }
}

async function toggleParticipantsList(meetingId) {
    const container = document.getElementById('participants-' + meetingId);
    if (!container) return;

    if (container.style.display === 'none' || !container.style.display) {
        container.style.display = 'block';
        await loadMeetingParticipants(meetingId);
    } else {
        container.style.display = 'none';
    }
}

async function loadMeetingParticipants(meetingId) {
    const container = document.getElementById('participants-' + meetingId);
    if (!container) return;

    container.innerHTML = '<p style="text-align: center; color: #999; padding: 8px; font-size: 0.75rem;">Loading...</p>';

    try {
        const participants = await api.getAllowedParticipants(meetingId);

        // Simple count display with click to open modal
        container.innerHTML = `
            <div class="participants-count-display" onclick="manageParticipants('${meetingId}')" title="Click to manage participants">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                    <circle cx="9" cy="7" r="4"></circle>
                    <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
                    <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
                </svg>
                <span>${participants.length} participant${participants.length !== 1 ? 's' : ''}</span>
            </div>
        `;
    } catch (error) {
        console.error('Error loading participants:', error);
        container.innerHTML = '<p style="text-align: center; color: #dc3545; padding: 8px; font-size: 0.75rem;">Failed to load</p>';
    }
}

// ============================================
// MODAL FUNCTIONS FOR NEW DASHBOARD
// ============================================

function showCreateProjectModal(type) {
    const modal = document.getElementById('createProjectModal');
    const typeInput = document.getElementById('projectMeetingType');

    if (typeInput) {
        typeInput.value = type;
    }

    modal.classList.add('active');
}

async function showCreateMeetingModalForProject(projectId, type) {
    currentProjectId = projectId;
    const modal = document.getElementById('createMeetingModal');
    const typeInput = document.getElementById('currentMeetingType');

    if (typeInput) {
        typeInput.value = type;
    }

    modal.classList.add('active');
    await fetchAndPopulateUsers();
}

function confirmDeleteProject(projectId) {
    if (confirm('Are you sure you want to delete this project? All meetings will also be deleted.')) {
        deleteProjectFromDashboard(projectId);
    }
}

function confirmDeleteMeeting(meetingId) {
    if (confirm('Are you sure you want to delete this meeting?')) {
        deleteMeetingFromDashboard(meetingId);
    }
}

async function deleteProjectFromDashboard(projectId) {
    try {
        await api.deleteProject(projectId);
        loadProjectsByType(currentMeetingType);
    } catch (error) {
        alert('Failed to delete project: ' + error.message);
    }
}

async function deleteMeetingFromDashboard(meetingId) {
    try {
        await api.deleteMeeting(meetingId);
        loadProjectsByType(currentMeetingType);
    } catch (error) {
        alert('Failed to delete meeting: ' + error.message);
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

        // Display first recording by default
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

        // Display list of all recordings - ultra compact design
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

        // Update playing state on recording items
        document.querySelectorAll('.rec-item').forEach((item, i) => {
            if (i === index) {
                item.classList.add('playing');
            } else {
                item.classList.remove('playing');
            }
        });

        // Update action buttons with new URL
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

// Copy recording URL to clipboard
function copyRecordingUrl(url) {
    navigator.clipboard.writeText(url).then(() => {
        // Show brief success feedback
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
