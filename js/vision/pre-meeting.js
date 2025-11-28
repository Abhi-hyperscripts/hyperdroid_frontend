// Pre-meeting page JavaScript
let localStream = null;
let audioContext = null;
let analyser = null;
let microphone = null;
let cameraEnabled = true;
let microphoneEnabled = true;
let meetingId = null;
let selectedCameraId = null;
let selectedMicrophoneId = null;
let selectedSpeakerId = null;

// Get meeting ID from URL
const urlParams = new URLSearchParams(window.location.search);
meetingId = urlParams.get('id');

if (!meetingId) {
    alert('Meeting ID is required');
    window.location.href = 'dashboard.html';
}

// Initialize page
document.addEventListener('DOMContentLoaded', async () => {
    await loadMeetingDetails();
    await checkPermissionsAndInitialize();
});

// Load meeting details
async function loadMeetingDetails() {
    try {
        const response = await fetch(`${CONFIG.apiBaseUrl}/meetings/${meetingId}/status`);
        if (response.ok) {
            const meeting = await response.json();
            document.getElementById('meetingTitle').textContent = `Ready to join "${meeting.meeting_name}"?`;
        }
    } catch (error) {
        console.error('Error loading meeting details:', error);
    }
}

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

// Join meeting
async function joinMeeting() {
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

    // Close audio context
    if (audioContext) {
        audioContext.close();
    }

    // Check meeting type and redirect appropriately
    try {
        const response = await fetch(`${CONFIG.apiBaseUrl}/meetings/${meetingId}/status`);
        if (response.ok) {
            const meeting = await response.json();

            // If hosted meeting and not started yet, go to lobby
            if (meeting.meeting_type === 'hosted' && !meeting.is_started) {
                // Check if user is the host
                const user = api.getUser();
                if (user && meeting.host_user_id === user.userId) {
                    // Host goes directly to meeting and starts it
                    window.location.href = `meeting.html?id=${meetingId}`;
                } else {
                    // Non-host goes to waiting lobby
                    window.location.href = `lobby.html?id=${meetingId}`;
                }
            } else {
                // Regular or participant-controlled meeting - go directly to meeting
                window.location.href = `meeting.html?id=${meetingId}`;
            }
        } else {
            showError('Failed to check meeting status');
        }
    } catch (error) {
        console.error('Error checking meeting status:', error);
        // Default to meeting page
        window.location.href = `meeting.html?id=${meetingId}`;
    }
}

// Cancel join
function cancelJoin() {
    // Stop local stream
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
    }

    // Close audio context
    if (audioContext) {
        audioContext.close();
    }

    // Redirect to dashboard or previous page
    if (document.referrer && document.referrer.includes(window.location.host)) {
        window.history.back();
    } else {
        window.location.href = 'dashboard.html';
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
window.addEventListener('beforeunload', () => {
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
    }
    if (audioContext) {
        audioContext.close();
    }
});
