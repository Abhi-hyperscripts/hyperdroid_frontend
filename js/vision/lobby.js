// Lobby page JavaScript
let meetingId = null;
let lobbyConnection = null;
let statusCheckInterval = null;
const participants = new Map();

// Device testing variables
let localStream = null;
let audioContext = null;
let analyser = null;
let microphone = null;
let cameraEnabled = true;
let microphoneEnabled = true;
let selectedCameraId = null;
let selectedMicrophoneId = null;
let selectedSpeakerId = null;
let meetingData = null; // Store meeting details

// Get meeting ID from URL
const urlParams = new URLSearchParams(window.location.search);
meetingId = urlParams.get('id');

if (!meetingId) {
    alert('Invalid meeting link');
    window.location.href = 'dashboard.html';
}

// Check authentication
const isGuest = !api.isAuthenticated();

// Initialize lobby
async function initializeLobby() {
    try {
        // Check meeting status
        meetingData = await api.getMeetingStatus(meetingId);

        if (!meetingData) {
            alert('Meeting not found');
            window.location.href = 'dashboard.html';
            return;
        }

        // Load meeting details in title
        const meetingName = meetingData.meeting_name || meetingData.name || 'this meeting';
        document.getElementById('meetingTitle').textContent = `Ready to join "${meetingName}"?`;

        // For authenticated users, check if they are allowed to join (for participant-controlled meetings)
        if (!isGuest) {
            try {
                const accessCheck = await api.checkMeetingAccess(meetingId);
                if (!accessCheck.canJoin) {
                    // User is not allowed - show elegant error page
                    document.getElementById('deviceTestingSection').style.display = 'none';
                    document.getElementById('waitingLobbySection').style.display = 'block';

                    // Hide spinner and participants list
                    document.querySelector('.spinner').style.display = 'none';
                    document.querySelector('.participants-list').style.display = 'none';

                    // Update icon to lock
                    const lobbyIcon = document.querySelector('.lobby-icon');
                    lobbyIcon.textContent = '🔒';
                    lobbyIcon.style.fontSize = '64px';

                    // Update title
                    document.querySelector('.lobby-title').textContent = 'Access Denied';
                    document.querySelector('.lobby-title').style.color = '#000';

                    // Update subtitle with elegant message
                    const subtitle = document.querySelector('.lobby-subtitle');
                    subtitle.textContent = 'You do not have permission to join this meeting';
                    subtitle.style.color = '#666';
                    subtitle.style.marginBottom = '24px';

                    // Update status message with elegant styling
                    const statusDiv = document.querySelector('.lobby-status');
                    statusDiv.className = 'lobby-status lobby-status-error';
                    statusDiv.innerHTML = `
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align: middle; margin-right: 8px;">
                            <circle cx="12" cy="12" r="10"/>
                            <line x1="12" y1="8" x2="12" y2="12"/>
                            <line x1="12" y1="16" x2="12.01" y2="16"/>
                        </svg>
                        ${accessCheck.message || 'Please contact the meeting host for access'}
                    `;

                    // Update actions with elegant button
                    const actionsDiv = document.querySelector('.lobby-actions');
                    actionsDiv.innerHTML = `
                        <button onclick="leaveLobby()" class="btn btn-elegant-primary">Return to Dashboard</button>
                    `;
                    return; // Stop here, don't proceed
                }
            } catch (error) {
                console.error('Error checking meeting access:', error);
                alert('Failed to verify meeting access: ' + error.message);
                window.location.href = 'dashboard.html';
                return;
            }
        }

        // Initialize device testing for all meetings
        await checkPermissionsAndInitialize();

    } catch (error) {
        console.error('Error initializing lobby:', error);
        alert('Failed to join lobby: ' + error.message);
    }
}

async function loadMeetingDetails() {
    try {
        // You might want to add a new API endpoint to get meeting details
        // For now, we'll just use the meeting ID
        document.getElementById('meetingName').textContent = `Meeting Lobby`;
    } catch (error) {
        console.error('Error loading meeting details:', error);
    }
}

async function setupSignalRConnection() {
    try {
        const hubUrl = CONFIG.signalRHubUrl;

        // Build connection with optional auth token
        const connectionBuilder = new signalR.HubConnectionBuilder()
            .withUrl(hubUrl, {
                accessTokenFactory: () => api.token || ''
            })
            .withAutomaticReconnect()
            .configureLogging(signalR.LogLevel.Information);

        lobbyConnection = connectionBuilder.build();

        // Setup event handlers
        lobbyConnection.on('UserJoinedLobby', (data) => {
            console.log('User joined lobby:', data);
            addParticipant(data.userId || 'guest', data.username, data.isGuest);
        });

        lobbyConnection.on('UserLeftLobby', (data) => {
            console.log('User left lobby:', data);
            removeParticipant(data.userId || 'guest');
        });

        lobbyConnection.on('MeetingStarted', (data) => {
            console.log('Meeting started:', data);
            showMeetingStartedNotification(data.message);

            // Redirect to meeting immediately (Safari compatible)
            // Use window.location.replace for better compatibility
            window.location.replace(`meeting.html?id=${meetingId}`);
        });

        // Handle reconnection
        lobbyConnection.onreconnected(() => {
            console.log('Reconnected to lobby');
            joinLobbyGroup();
        });

        // Start connection
        await lobbyConnection.start();
        console.log('Connected to lobby hub');

        // Join lobby group
        await joinLobbyGroup();

    } catch (error) {
        console.error('Error setting up SignalR connection:', error);
        throw error;
    }
}

async function joinLobbyGroup() {
    try {
        await lobbyConnection.invoke('JoinLobby', meetingId);
        console.log('Joined lobby group');
    } catch (error) {
        console.error('Error joining lobby group:', error);
    }
}

function addParticipant(userId, username, isGuest = false) {
    participants.set(userId, { username, isGuest });
    updateParticipantsList();
}

function removeParticipant(userId) {
    participants.delete(userId);
    updateParticipantsList();
}

function updateParticipantsList() {
    const container = document.getElementById('participantsList');
    const count = document.getElementById('participantCount');

    count.textContent = participants.size;

    if (participants.size === 0) {
        container.innerHTML = '<p style="color: #999; text-align: center;">You are the first one here</p>';
        return;
    }

    container.innerHTML = '';
    participants.forEach((data, userId) => {
        const item = document.createElement('div');
        item.className = 'participant-item';

        const initial = data.username.charAt(0).toUpperCase();
        const guestBadge = data.isGuest ? '<span class="guest-badge">Guest</span>' : '';

        item.innerHTML = `
            <div class="participant-icon">${initial}</div>
            <div class="participant-name">${data.username}</div>
            ${guestBadge}
        `;

        container.appendChild(item);
    });
}

function showMeetingStartedNotification(message) {
    const statusDiv = document.querySelector('.lobby-status');
    statusDiv.className = 'lobby-status';
    statusDiv.style.background = '#d4edda';
    statusDiv.style.borderColor = '#28a745';
    statusDiv.style.color = '#155724';
    statusDiv.innerHTML = `
        <div style="margin-bottom: 10px;">✓ ${message}</div>
        <button onclick="window.location.replace('meeting.html?id=${meetingId}')"
                style="background: #28a745; color: white; border: none; padding: 10px 20px; border-radius: 5px; cursor: pointer; font-size: 14px;">
            Join Meeting Now
        </button>
    `;

    // Hide spinner
    document.querySelector('.spinner').style.display = 'none';
}

async function checkMeetingStatus() {
    try {
        const status = await api.getMeetingStatus(meetingId);

        if (status && status.is_started) {
            showMeetingStartedNotification('Meeting has started!');
            // Auto-redirect immediately (Safari compatible)
            window.location.replace(`meeting.html?id=${meetingId}`);
        }
    } catch (error) {
        console.error('Error checking meeting status:', error);
    }
}

function startStatusCheck() {
    // Check status every 10 seconds
    statusCheckInterval = setInterval(checkMeetingStatus, 10000);
}

function stopStatusCheck() {
    if (statusCheckInterval) {
        clearInterval(statusCheckInterval);
        statusCheckInterval = null;
    }
}

async function leaveLobby() {
    stopStatusCheck();

    if (lobbyConnection) {
        try {
            await lobbyConnection.invoke('LeaveLobby', meetingId);
            await lobbyConnection.stop();
        } catch (error) {
            console.error('Error leaving lobby:', error);
        }
    }

    if (isGuest) {
        window.location.href = '../../index.html';
    } else {
        window.location.href = 'dashboard.html';
    }
}

// Handle page unload
window.addEventListener('beforeunload', async () => {
    stopStatusCheck();
    if (lobbyConnection) {
        try {
            await lobbyConnection.invoke('LeaveLobby', meetingId);
        } catch (error) {
            console.error('Error leaving lobby on unload:', error);
        }
    }
});

// ========== DEVICE TESTING FUNCTIONS ==========

// Check permissions and initialize devices
async function checkPermissionsAndInitialize() {
    try {
        // Check if permissions are already granted
        const permissions = await navigator.permissions.query({ name: 'camera' });

        if (permissions.state === 'granted') {
            await initializeDevices();
        } else {
            // Show permission request UI
            showPermissionRequest();
        }
    } catch (error) {
        console.error('Error checking permissions:', error);
        // Try to initialize anyway (some browsers don't support permissions API)
        await initializeDevices();
    }
}

// Show permission request UI
function showPermissionRequest() {
    document.getElementById('permissionRequest').style.display = 'flex';
    document.getElementById('localVideo').style.display = 'none';
    document.getElementById('cameraOffPlaceholder').style.display = 'none';
}

// Request permissions
async function requestPermissions() {
    try {
        await initializeDevices();
        document.getElementById('permissionRequest').style.display = 'none';
    } catch (error) {
        showError('Failed to get camera/microphone access: ' + error.message);
    }
}

// Initialize camera and microphone
async function initializeDevices() {
    try {
        // Request camera and microphone access
        localStream = await navigator.mediaDevices.getUserMedia({
            video: { width: { ideal: 1280 }, height: { ideal: 720 } },
            audio: true
        });

        // Show video preview
        const videoElement = document.getElementById('localVideo');
        videoElement.srcObject = localStream;
        videoElement.style.display = 'block';
        document.getElementById('permissionRequest').style.display = 'none';
        document.getElementById('cameraOffPlaceholder').style.display = 'none';

        // Initialize audio level monitoring
        initializeAudioLevelMonitoring();

        // Populate device lists
        await populateDeviceList();

        console.log('Devices initialized successfully');
    } catch (error) {
        console.error('Error initializing devices:', error);

        if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
            showError('Camera and microphone access denied. Please allow access and try again.');
            showPermissionRequest();
        } else if (error.name === 'NotFoundError') {
            showError('No camera or microphone found. Please connect devices and try again.');
        } else {
            showError('Failed to initialize devices: ' + error.message);
        }
    }
}

// Initialize audio level monitoring
function initializeAudioLevelMonitoring() {
    try {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        analyser = audioContext.createAnalyser();
        analyser.fftSize = 256;

        const audioTracks = localStream.getAudioTracks();
        if (audioTracks.length > 0) {
            microphone = audioContext.createMediaStreamSource(new MediaStream([audioTracks[0]]));
            microphone.connect(analyser);

            // Start monitoring audio level
            monitorAudioLevel();
        }
    } catch (error) {
        console.error('Error initializing audio monitoring:', error);
    }
}

// Monitor audio level
function monitorAudioLevel() {
    if (!analyser || !microphoneEnabled) {
        requestAnimationFrame(monitorAudioLevel);
        return;
    }

    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(dataArray);

    // Calculate average volume
    const average = dataArray.reduce((a, b) => a + b) / dataArray.length;
    const percentage = Math.min((average / 128) * 100, 100);

    // Update indicator
    const indicator = document.getElementById('micLevelIndicator');
    if (indicator) {
        indicator.style.width = percentage + '%';

        // Change color based on level
        if (percentage > 70) {
            indicator.style.background = '#28a745'; // Green for good level
        } else if (percentage > 30) {
            indicator.style.background = '#ffc107'; // Yellow for medium
        } else {
            indicator.style.background = '#6c757d'; // Gray for low
        }
    }

    requestAnimationFrame(monitorAudioLevel);
}

// Populate device lists
async function populateDeviceList() {
    try {
        const devices = await navigator.mediaDevices.enumerateDevices();

        const cameraSelect = document.getElementById('cameraSelect');
        const microphoneSelect = document.getElementById('microphoneSelect');
        const speakerSelect = document.getElementById('speakerSelect');

        // Clear existing options (except first)
        cameraSelect.innerHTML = '<option value="">Select Camera</option>';
        microphoneSelect.innerHTML = '<option value="">Select Microphone</option>';
        speakerSelect.innerHTML = '<option value="">Select Speaker</option>';

        let cameraCount = 0;
        let micCount = 0;
        let speakerCount = 0;

        devices.forEach(device => {
            const option = document.createElement('option');
            option.value = device.deviceId;

            if (device.kind === 'videoinput') {
                option.text = device.label || `Camera ${++cameraCount}`;
                cameraSelect.appendChild(option);

                // Select current camera
                if (localStream) {
                    const videoTrack = localStream.getVideoTracks()[0];
                    if (videoTrack && videoTrack.getSettings().deviceId === device.deviceId) {
                        cameraSelect.value = device.deviceId;
                        selectedCameraId = device.deviceId;
                    }
                }
            } else if (device.kind === 'audioinput') {
                option.text = device.label || `Microphone ${++micCount}`;
                microphoneSelect.appendChild(option);

                // Select current microphone
                if (localStream) {
                    const audioTrack = localStream.getAudioTracks()[0];
                    if (audioTrack && audioTrack.getSettings().deviceId === device.deviceId) {
                        microphoneSelect.value = device.deviceId;
                        selectedMicrophoneId = device.deviceId;
                    }
                }
            } else if (device.kind === 'audiooutput') {
                option.text = device.label || `Speaker ${++speakerCount}`;
                speakerSelect.appendChild(option);

                // Select default speaker
                if (!selectedSpeakerId && device.deviceId === 'default') {
                    speakerSelect.value = device.deviceId;
                    selectedSpeakerId = device.deviceId;
                }
            }
        });
    } catch (error) {
        console.error('Error populating device list:', error);
    }
}

// Toggle camera
async function toggleCamera() {
    const btn = document.getElementById('toggleCameraBtn');
    const status = document.getElementById('cameraStatus');
    const videoElement = document.getElementById('localVideo');
    const placeholder = document.getElementById('cameraOffPlaceholder');

    cameraEnabled = !cameraEnabled;

    if (cameraEnabled) {
        // Turn camera on
        if (!localStream || !localStream.getVideoTracks().length) {
            try {
                const stream = await navigator.mediaDevices.getUserMedia({
                    video: { deviceId: selectedCameraId ? { exact: selectedCameraId } : undefined }
                });

                if (localStream) {
                    stream.getVideoTracks().forEach(track => {
                        localStream.addTrack(track);
                    });
                } else {
                    localStream = stream;
                }

                videoElement.srcObject = localStream;
            } catch (error) {
                showError('Failed to enable camera: ' + error.message);
                cameraEnabled = false;
                return;
            }
        } else {
            localStream.getVideoTracks().forEach(track => track.enabled = true);
        }

        videoElement.style.display = 'block';
        placeholder.style.display = 'none';
        btn.classList.add('active');
        status.textContent = 'Camera On';
    } else {
        // Turn camera off
        if (localStream) {
            localStream.getVideoTracks().forEach(track => track.enabled = false);
        }

        videoElement.style.display = 'none';
        placeholder.style.display = 'flex';
        btn.classList.remove('active');
        status.textContent = 'Camera Off';
    }
}

// Toggle microphone
async function toggleMicrophone() {
    const btn = document.getElementById('toggleMicBtn');
    const status = document.getElementById('micStatus');

    microphoneEnabled = !microphoneEnabled;

    if (microphoneEnabled) {
        // Turn microphone on
        if (!localStream || !localStream.getAudioTracks().length) {
            try {
                const stream = await navigator.mediaDevices.getUserMedia({
                    audio: { deviceId: selectedMicrophoneId ? { exact: selectedMicrophoneId } : undefined }
                });

                if (localStream) {
                    stream.getAudioTracks().forEach(track => {
                        localStream.addTrack(track);
                    });
                } else {
                    localStream = stream;
                }

                // Reinitialize audio monitoring
                initializeAudioLevelMonitoring();
            } catch (error) {
                showError('Failed to enable microphone: ' + error.message);
                microphoneEnabled = false;
                return;
            }
        } else {
            localStream.getAudioTracks().forEach(track => track.enabled = true);
        }

        btn.classList.add('active');
        status.textContent = 'Microphone On';
    } else {
        // Turn microphone off
        if (localStream) {
            localStream.getAudioTracks().forEach(track => track.enabled = false);
        }

        btn.classList.remove('active');
        status.textContent = 'Microphone Off';
    }
}

// Change camera
async function changeCamera() {
    const select = document.getElementById('cameraSelect');
    selectedCameraId = select.value;

    if (!selectedCameraId) return;

    try {
        // Stop current video tracks
        if (localStream) {
            localStream.getVideoTracks().forEach(track => track.stop());
        }

        // Get new video stream
        const stream = await navigator.mediaDevices.getUserMedia({
            video: { deviceId: { exact: selectedCameraId } }
        });

        // Replace video track
        const videoTrack = stream.getVideoTracks()[0];
        if (localStream) {
            const oldTrack = localStream.getVideoTracks()[0];
            if (oldTrack) {
                localStream.removeTrack(oldTrack);
            }
            localStream.addTrack(videoTrack);
        } else {
            localStream = stream;
        }

        // Update video element
        const videoElement = document.getElementById('localVideo');
        videoElement.srcObject = localStream;

        // Ensure video is enabled if camera was on
        if (cameraEnabled) {
            videoTrack.enabled = true;
        } else {
            videoTrack.enabled = false;
        }
    } catch (error) {
        showError('Failed to change camera: ' + error.message);
    }
}

// Change microphone
async function changeMicrophone() {
    const select = document.getElementById('microphoneSelect');
    selectedMicrophoneId = select.value;

    if (!selectedMicrophoneId) return;

    try {
        // Stop current audio tracks
        if (localStream) {
            localStream.getAudioTracks().forEach(track => track.stop());
        }

        // Get new audio stream
        const stream = await navigator.mediaDevices.getUserMedia({
            audio: { deviceId: { exact: selectedMicrophoneId } }
        });

        // Replace audio track
        const audioTrack = stream.getAudioTracks()[0];
        if (localStream) {
            const oldTrack = localStream.getAudioTracks()[0];
            if (oldTrack) {
                localStream.removeTrack(oldTrack);
            }
            localStream.addTrack(audioTrack);
        } else {
            localStream = stream;
        }

        // Reinitialize audio monitoring
        if (audioContext) {
            audioContext.close();
        }
        initializeAudioLevelMonitoring();

        // Ensure microphone is enabled if mic was on
        if (microphoneEnabled) {
            audioTrack.enabled = true;
        } else {
            audioTrack.enabled = false;
        }
    } catch (error) {
        showError('Failed to change microphone: ' + error.message);
    }
}

// Change speaker
async function changeSpeaker() {
    const select = document.getElementById('speakerSelect');
    selectedSpeakerId = select.value;

    if (!selectedSpeakerId) return;

    try {
        const videoElement = document.getElementById('localVideo');
        if (typeof videoElement.setSinkId !== 'undefined') {
            await videoElement.setSinkId(selectedSpeakerId);
            console.log('Speaker changed successfully');
        } else {
            console.warn('Browser does not support speaker selection');
        }
    } catch (error) {
        showError('Failed to change speaker: ' + error.message);
    }
}

// Proceed to meeting after device testing
async function proceedToMeeting() {
    // Store device states in sessionStorage
    sessionStorage.setItem('preMeetingCameraEnabled', cameraEnabled);
    sessionStorage.setItem('preMeetingMicEnabled', microphoneEnabled);
    sessionStorage.setItem('preMeetingCameraId', selectedCameraId || '');
    sessionStorage.setItem('preMeetingMicId', selectedMicrophoneId || '');
    sessionStorage.setItem('preMeetingSpeakerId', selectedSpeakerId || '');

    // Stop local stream (will be reinitialized in meeting page)
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
    }

    // Close audio context (check if not already closed)
    if (audioContext && audioContext.state !== 'closed') {
        audioContext.close();
    }

    // If meetingData is not loaded yet, load it now
    if (!meetingData) {
        try {
            meetingData = await api.getMeetingStatus(meetingId);
            if (!meetingData) {
                showError('Failed to load meeting details');
                return;
            }
        } catch (error) {
            console.error('Error loading meeting data:', error);
            showError('Failed to load meeting details: ' + error.message);
            return;
        }
    }

    // Check if this is a hosted meeting that hasn't started
    if (meetingData.meeting_type === 'hosted' && !meetingData.is_started) {
        // Check if user is the host
        if (!isGuest) {
            const user = api.getUser();
            if (user && meetingData.host_user_id === user.userId) {
                // Host goes directly to meeting and starts it
                window.location.href = `meeting.html?id=${meetingId}`;
                return;
            }
        }

        // Non-host: Show waiting lobby section
        document.getElementById('deviceTestingSection').style.display = 'none';
        document.getElementById('waitingLobbySection').style.display = 'block';

        // Load meeting details for waiting lobby
        await loadMeetingDetails();

        // Setup SignalR connection
        await setupSignalRConnection();

        // Start periodic status check
        startStatusCheck();
    } else {
        // Regular or participant-controlled meeting - go directly to meeting
        window.location.href = `meeting.html?id=${meetingId}`;
    }
}

// Cancel join
function cancelJoin() {
    // Stop local stream
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
    }

    // Close audio context (check if not already closed)
    if (audioContext && audioContext.state !== 'closed') {
        audioContext.close();
    }

    // Redirect to dashboard or previous page
    if (isGuest) {
        window.location.href = '../../index.html';
    } else {
        if (document.referrer && document.referrer.includes(window.location.host)) {
            window.history.back();
        } else {
            window.location.href = 'dashboard.html';
        }
    }
}

// Show error message
function showError(message) {
    const errorElement = document.getElementById('errorMessage');
    errorElement.textContent = message;
    errorElement.style.display = 'block';

    // Auto-hide after 5 seconds
    setTimeout(() => {
        errorElement.style.display = 'none';
    }, 5000);
}

// Clean up on page unload
window.addEventListener('beforeunload', async () => {
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
    }
    if (audioContext && audioContext.state !== 'closed') {
        audioContext.close();
    }

    stopStatusCheck();
    if (lobbyConnection) {
        try {
            await lobbyConnection.invoke('LeaveLobby', meetingId);
        } catch (error) {
            console.error('Error leaving lobby on unload:', error);
        }
    }
});

// Initialize on page load
initializeLobby();
