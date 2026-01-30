// Meeting page JavaScript
let room;
let signalRConnection;
let localParticipant;
let micEnabled = true;
let cameraEnabled = true;
let meetingId;
let participantZoomLevels = {}; // Store zoom levels for each participant
let isAnyoneScreenSharing = false; // Track if anyone is sharing screen
let chatWasVisibleBeforeScreenShare = false; // Track chat visibility before screen share
let activeSpeakerManager = null; // Active speaker detection manager
let audioResumed = false; // Track if we've already handled audio resume

// Global handler to resume all audio elements on first user interaction
// This is needed for mobile Safari which blocks autoplay until user gesture
function setupAudioResumeHandler() {
    const resumeAllAudio = () => {
        if (audioResumed) return;
        audioResumed = true;

        console.log('User interaction detected - resuming all audio elements');
        document.querySelectorAll('audio').forEach(audio => {
            if (audio.paused && audio.srcObject) {
                audio.play().catch(e => console.warn('Failed to resume audio:', e));
            }
        });

        // Also resume AudioContext if suspended (Safari requirement)
        if (window.AudioContext || window.webkitAudioContext) {
            const AudioContextClass = window.AudioContext || window.webkitAudioContext;
            if (AudioContextClass.prototype.resume) {
                // Resume any suspended audio contexts
                document.querySelectorAll('audio, video').forEach(el => {
                    if (el.captureStream) {
                        try {
                            const ctx = new AudioContextClass();
                            if (ctx.state === 'suspended') {
                                ctx.resume();
                            }
                        } catch (e) {
                            // Ignore errors
                        }
                    }
                });
            }
        }

        // Remove the listeners after first interaction
        document.removeEventListener('click', resumeAllAudio);
        document.removeEventListener('touchstart', resumeAllAudio);
        document.removeEventListener('keydown', resumeAllAudio);
    };

    document.addEventListener('click', resumeAllAudio);
    document.addEventListener('touchstart', resumeAllAudio);
    document.addEventListener('keydown', resumeAllAudio);
}

// Call immediately to setup the handler
setupAudioResumeHandler();

// Safari-compatible video track attachment
// Safari has issues with track.attach() - use srcObject with MediaStream instead
function attachVideoTrackSafari(track, videoElement, participantIdentity) {
    // Use srcObject approach which works better in Safari
    if (track.mediaStreamTrack) {
        videoElement.srcObject = new MediaStream([track.mediaStreamTrack]);
        console.log(`Video track attached via srcObject for ${participantIdentity}`);
    } else {
        // Fallback to track.attach() if mediaStreamTrack not available
        track.attach(videoElement);
        console.log(`Video track attached via track.attach() for ${participantIdentity}`);
    }

    // Ensure video plays (Safari requires explicit play)
    const playPromise = videoElement.play();
    if (playPromise !== undefined) {
        playPromise.catch(() => {
            console.warn('Video autoplay blocked for', participantIdentity, '- will play on user interaction');
            const resumeVideo = () => {
                videoElement.play().catch(err => console.warn('Video play retry failed:', err));
                document.removeEventListener('click', resumeVideo);
                document.removeEventListener('touchstart', resumeVideo);
            };
            document.addEventListener('click', resumeVideo, { once: true });
            document.addEventListener('touchstart', resumeVideo, { once: true });
        });
    }
}

// Global handler to resume all video elements on first user interaction (for Safari)
let videoResumed = false;
function setupVideoResumeHandler() {
    const resumeAllVideo = () => {
        if (videoResumed) return;
        videoResumed = true;

        console.log('User interaction detected - resuming all video elements');
        document.querySelectorAll('video').forEach(video => {
            if (video.paused && video.srcObject) {
                video.play().catch(e => console.warn('Failed to resume video:', e));
            }
        });

        document.removeEventListener('click', resumeAllVideo);
        document.removeEventListener('touchstart', resumeAllVideo);
        document.removeEventListener('keydown', resumeAllVideo);
    };

    document.addEventListener('click', resumeAllVideo);
    document.addEventListener('touchstart', resumeAllVideo);
    document.addEventListener('keydown', resumeAllVideo);
}

// Call immediately to setup the video handler
setupVideoResumeHandler();

// Recording state
let mediaRecorder = null;
let recordedChunks = [];
let isRecording = false;
let isPaused = false;
let recordingStartTime = null;
let recordingTimerInterval = null;

// Screen share zoom and pan state
let screenShareZoom = 1;
let screenSharePanX = 0;
let screenSharePanY = 0;
let isDragging = false;
let dragStartX = 0;
let dragStartY = 0;
let dragStartPanX = 0;
let dragStartPanY = 0;

// Hand raise state
let handRaised = false;
let raisedHands = new Set(); // Track who has their hand raised

// Picture-in-Picture state
let pipEnabled = false;

// Virtual background state
let currentBackground = 'none';
let backgroundCanvas = null;
let backgroundContext = null;
let backgroundImage = null;
let bodyPixNet = null; // BodyPix model
let cocoSsdModel = null; // COCO-SSD object detection model
let segmentationRunning = false;
let virtualBackgroundStream = null;
let originalVideoTrack = null;
let originalCameraPublication = null; // Store the original LiveKit camera publication
let tempCanvas = null; // Reusable temp canvas for processing
let tempCtx = null;
let maskCanvas = null; // Reusable mask canvas for segmentation
let maskCtx = null;
let previousMaskCanvas = null; // For temporal smoothing
let previousMaskCtx = null;
let frameCount = 0; // Frame counter for throttling

// Library loading state for lazy loading
let virtualBackgroundLibsLoaded = false;
let virtualBackgroundLibsLoading = false;

// Three.js variables for virtual background
let threeScene = null;
let threeCamera = null;
let threeRenderer = null;
let videoTexture = null;
let backgroundTexture = null;
let maskTexture = null;
let videoMesh = null;
let backgroundMesh = null;

// Get meeting ID from URL
const urlParams = new URLSearchParams(window.location.search);
meetingId = urlParams.get('id');

if (!meetingId) {
    Toast.error('Meeting ID not provided');
    window.location.href = '../login.html';
}

// Check if user is authenticated or guest
const isGuest = sessionStorage.getItem('isGuest') === 'true';
const isAuthenticated = api.isAuthenticated();

// If neither authenticated nor guest, redirect to guest join page
if (!isAuthenticated && !isGuest) {
    window.location.href = `guest-join.html?id=${meetingId}`;
}

// Initialize meeting
async function initializeMeeting() {
    try {
        // Check meeting status first
        const meetingStatus = await api.getMeetingStatus(meetingId);

        if (!meetingStatus) {
            Toast.error('Meeting not found');
            window.location.href = 'dashboard.html';
            return;
        }

        // Get current user info
        const user = isGuest ? null : api.getUser();
        const isHostUser = user && meetingStatus.host_user_id === user.userId;

        // Show participants button to all users (host controls are restricted in loadParticipants)
        const participantsBtn = document.getElementById('participantsBtn');
        if (participantsBtn) {
            participantsBtn.style.display = 'inline-block';
        }

        // If it's a hosted meeting and not started, check if user is host
        if (meetingStatus.is_host_controlled && !meetingStatus.is_started) {
            if (!isHostUser) {
                // Non-host users should wait in lobby
                window.location.href = `lobby.html?id=${meetingId}`;
                return;
            } else {
                // Host can join but should start the meeting
                showStartMeetingButton();
            }
        }

        let tokenData;
        let participantName;

        if (isGuest) {
            // Guest user - use stored token and info
            const guestMeetingId = sessionStorage.getItem('guestMeetingId');

            // Verify guest is joining the correct meeting
            if (guestMeetingId !== meetingId) {
                Toast.error('Invalid guest session');
                sessionStorage.clear();
                window.location.href = `guest-join.html?id=${meetingId}`;
                return;
            }

            tokenData = {
                token: sessionStorage.getItem('guestToken'),
                ws_url: sessionStorage.getItem('guestWsUrl')
            };
            participantName = sessionStorage.getItem('guestName');

            console.log('Joining as guest:', participantName);
        } else {
            // Authenticated user - use existing flow
            if (!user) {
                throw new Error('User not authenticated');
            }
            participantName = user.email || 'User';

            // Get LiveKit token
            tokenData = await api.getLiveKitToken(meetingId, participantName);
        }

        // Connect to LiveKit
        await connectToLiveKit(tokenData.ws_url, tokenData.token);

        // Connect to SignalR chat (for both authenticated users and guests)
        await connectToSignalR(participantName);

        // Check if recording is already in progress when joining
        if (tokenData.meeting && tokenData.meeting.is_recording) {
            console.log('Meeting is already being recorded, showing overlay');
            // Small delay to ensure layout is rendered first
            setTimeout(() => showServerRecordingOverlay(true), 500);
        }

        // Load chat history only for authenticated users
        if (!isGuest) {
            // Chat history disabled - only show messages from current session
            // await loadChatHistory();
        }

    } catch (error) {
        console.error('Error initializing meeting:', error);
        Toast.error('Failed to join meeting: ' + error.message);

        if (isGuest) {
            sessionStorage.clear();
            window.location.href = `guest-join.html?id=${meetingId}`;
        } else {
            window.location.href = 'dashboard.html';
        }
    }
}

// Connect to LiveKit
async function connectToLiveKit(wsUrl, token) {
    try {
        // Fetch ICE servers from backend (REQUIRED)
        console.log('Fetching ICE servers from backend...');
        const iceServers = await CONFIG.fetchIceServers();
        console.log('ICE servers loaded:', iceServers);

        if (!iceServers || iceServers.length === 0) {
            throw new Error('No ICE servers available. Cannot establish WebRTC connection.');
        }

        // Configure RTC options with TURN/STUN servers and simulcast
        const roomOptions = {
            adaptiveStream: true,
            dynacast: true,
            videoCaptureDefaults: {
                resolution: LivekitClient.VideoPresets.h1080.resolution,
            },
            publishDefaults: {
                simulcast: true,  // Enable simulcast for adaptive quality (camera only)
                videoEncoding: {
                    maxBitrate: 6_000_000,  // 6 Mbps for sharp 1080p
                    maxFramerate: 30,
                },
                // Screen share: Use VP9 codec (better for screen content) with high bitrate
                screenShareEncoding: {
                    maxBitrate: 30_000_000,  // 30 Mbps for maximum quality
                    maxFramerate: 30,
                },
                screenShareSimulcastLayers: [],  // DISABLE simulcast - full quality only
                videoCodec: 'vp9',  // VP9 is optimized for screen sharing
                backupCodec: false, // Don't fall back to lower quality codec
            }
        };

        room = new LivekitClient.Room(roomOptions);

        // Handle participant events
        room.on('participantConnected', (participant) => {
            console.log('Participant connected:', participant.identity);
            // NOTE: addParticipant() is now handled by ActiveSpeakerManager layout system
            // The old addParticipant() function created duplicate DOM elements
            // addParticipant(participant);
        });

        room.on('participantDisconnected', (participant) => {
            console.log('Participant disconnected:', participant.identity);
            removeParticipant(participant);
        });

        room.on('trackSubscribed', (track, publication, participant) => {
            console.log('Track subscribed:', track.kind, 'source:', publication.source);
            attachTrack(track, publication, participant);
        });

        room.on('trackUnsubscribed', (track, publication, participant) => {
            console.log('Track unsubscribed:', track.kind);
            detachTrack(track, publication, participant);
        });

        // Handle local participant track published (for camera toggle)
        room.on('localTrackPublished', (publication) => {
            console.log('Local track published:', publication.kind);
            if (publication.track && publication.kind === 'video') {
                const video = document.querySelector('#local-participant video');
                if (video) {
                    publication.track.attach(video);
                }
                // Hide placeholder when video is published
                const localDiv = document.getElementById('local-participant');
                if (localDiv) {
                    updateCameraOffPlaceholder(localDiv, true);
                }
            }
        });

        // Handle local participant track unpublished (when camera is turned off)
        room.on('localTrackUnpublished', (publication) => {
            console.log('Local track unpublished:', publication.kind);
            if (publication.kind === 'video' && publication.source === 'camera') {
                const localDiv = document.getElementById('local-participant');
                if (localDiv) {
                    updateCameraOffPlaceholder(localDiv, false);
                }
            }
        });

        // Handle remote participant track muted (video off)
        room.on('trackMuted', (publication, participant) => {
            console.log('Track muted:', publication.kind, 'from', participant.identity);
            if (publication.kind === 'video' && publication.source === 'camera') {
                const participantDiv = document.getElementById(`participant-${participant.identity}`);
                if (participantDiv) {
                    updateCameraOffPlaceholder(participantDiv, false);
                }
            }
        });

        // Handle remote participant track unmuted (video on)
        room.on('trackUnmuted', (publication, participant) => {
            console.log('Track unmuted:', publication.kind, 'from', participant.identity);
            if (publication.kind === 'video' && publication.source === 'camera') {
                const participantDiv = document.getElementById(`participant-${participant.identity}`);
                if (participantDiv) {
                    updateCameraOffPlaceholder(participantDiv, true);
                }
            }
        });

        // Configure connection options with ICE servers fetched from backend
        const connectOptions = {
            autoSubscribe: true,  // Auto-subscribe to all tracks to show all participant videos
            rtcConfig: {
                iceServers: iceServers,
                iceTransportPolicy: 'all'
            }
        };

        // Connect to room
        await room.connect(wsUrl, token, connectOptions);

        localParticipant = room.localParticipant;

        // Read lobby preferences from sessionStorage
        const preMeetingMicEnabled = sessionStorage.getItem('preMeetingMicEnabled');
        const preMeetingCameraEnabled = sessionStorage.getItem('preMeetingCameraEnabled');

        // Determine initial states based on lobby preferences (default to true if not set)
        const shouldEnableMic = preMeetingMicEnabled === null ? true : preMeetingMicEnabled === 'true';
        const shouldEnableCamera = preMeetingCameraEnabled === null ? true : preMeetingCameraEnabled === 'true';

        console.log('Lobby preferences - Mic:', shouldEnableMic, 'Camera:', shouldEnableCamera);

        // Enable/disable microphone based on lobby preference
        try {
            await room.localParticipant.setMicrophoneEnabled(shouldEnableMic);
            micEnabled = shouldEnableMic;
            console.log('Microphone ' + (shouldEnableMic ? 'enabled' : 'disabled') + ' based on lobby preference');

            // Update UI to reflect mic state
            const micBtn = document.getElementById('micBtn');
            if (micBtn) {
                micBtn.classList.toggle('active', micEnabled);
            }
        } catch (micError) {
            console.error('Failed to set microphone state:', micError);
            micEnabled = false;
            // Show user-friendly error
            const micBtn = document.getElementById('micBtn');
            if (micBtn) {
                micBtn.classList.remove('active');
                micBtn.title = 'Microphone permission denied. Click to try again.';
            }
        }

        // Enable/disable camera based on lobby preference
        try {
            await room.localParticipant.setCameraEnabled(shouldEnableCamera);
            cameraEnabled = shouldEnableCamera;
            console.log('Camera ' + (shouldEnableCamera ? 'enabled' : 'disabled') + ' based on lobby preference');

            // Update UI to reflect camera state
            const camBtn = document.getElementById('camBtn');
            if (camBtn) {
                camBtn.classList.toggle('active', cameraEnabled);
            }
        } catch (camError) {
            console.error('Failed to set camera state:', camError);
            cameraEnabled = false;
            // Show user-friendly error
            const camBtn = document.getElementById('camBtn');
            if (camBtn) {
                camBtn.classList.remove('active');
                camBtn.title = 'Camera permission denied. Click to try again.';
            }
            // Show alert to user only if they wanted camera enabled
            if (shouldEnableCamera) {
                const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
                const isAndroid = /Android/i.test(navigator.userAgent);
                const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);

                let message = 'Camera access was denied.\n\n';
                if (isAndroid) {
                    message += 'To enable camera on Android:\n';
                    message += '1. Tap the lock/info icon in the address bar\n';
                    message += '2. Tap "Site settings" or "Permissions"\n';
                    message += '3. Allow Camera access\n';
                    message += '4. Refresh the page';
                } else if (isIOS) {
                    message += 'To enable camera on iOS:\n';
                    message += '1. Go to Settings > Safari (or your browser)\n';
                    message += '2. Tap "Camera"\n';
                    message += '3. Select "Allow"\n';
                    message += '4. Return to this page and refresh';
                } else {
                    message += 'Please allow camera access in your browser settings and refresh the page.';
                }
                Toast.warning(message, 10000);
            }
        }

        // Clear the lobby preferences from sessionStorage after applying
        sessionStorage.removeItem('preMeetingMicEnabled');
        sessionStorage.removeItem('preMeetingCameraEnabled');
        sessionStorage.removeItem('preMeetingCameraId');
        sessionStorage.removeItem('preMeetingMicId');
        sessionStorage.removeItem('preMeetingSpeakerId');

        // Display local participant
        addLocalParticipant();

        // Add any existing remote participants
        room.remoteParticipants.forEach((participant) => {
            console.log('Adding existing participant:', participant.identity);
            addParticipant(participant);
        });

        // Initialize Active Speaker Manager with adaptive quality
        console.log('Initializing Active Speaker Detection...');
        activeSpeakerManager = new ActiveSpeakerManager(room);

        activeSpeakerManager.onLayoutChange = (layout) => {
            console.log('Active speaker layout updated:', {
                mainSpeaker: layout.mainSpeaker?.identity,
                videoCount: layout.videoParticipants.length,
                audioOnlyCount: layout.audioOnlyParticipants.length
            });

            // Update participant UI based on active speaker layout
            updateParticipantLayout(layout);
        };

        activeSpeakerManager.onSpeakerUpdate = (speaker) => {
            if (speaker) {
                console.log('Main speaker is now:', speaker.identity);
            }
        };

        // Initialize active speakers
        activeSpeakerManager.initializeActiveSpeakers();

        // Start periodic cleanup of stale participant tiles (helps on mobile)
        startStaleParticipantCleanup();

        console.log('Connected to LiveKit room with Active Speaker Detection (Main: 1080p, Small: 360p)');
    } catch (error) {
        console.error('Error connecting to LiveKit:', error);
        throw error;
    }
}

// Connect to SignalR
async function connectToSignalR(guestName = null) {
    // Check if explicitly joining as guest (prioritize this over token check)
    // This handles the case where an authenticated user chooses to join as a guest
    const isGuestSession = sessionStorage.getItem('isGuest') === 'true';
    const token = getAuthToken();

    // For guests, pass name in query string (check this FIRST)
    if (isGuestSession && guestName) {
        signalRConnection = new signalR.HubConnectionBuilder()
            .withUrl(`${CONFIG.signalRHubUrl}?guestName=${encodeURIComponent(guestName)}`)
            .withAutomaticReconnect()
            .build();

        // Setup event handlers and start connection for guests
        setupSignalREventHandlers();
        await signalRConnection.start();
        await signalRConnection.invoke('JoinMeeting', meetingId);
        console.log('Connected to SignalR hub as guest:', guestName);
        return;
    }

    // For authenticated users, use token factory
    if (token) {
        signalRConnection = new signalR.HubConnectionBuilder()
            .withUrl(CONFIG.signalRHubUrl, {
                accessTokenFactory: () => token
            })
            .withAutomaticReconnect()
            .build();

        setupSignalREventHandlers();
        await signalRConnection.start();
        await signalRConnection.invoke('JoinMeeting', meetingId);
        console.log('Connected to SignalR hub as authenticated user');
        return;
    }

    throw new Error('No authentication method available');
}

// Setup SignalR event handlers
function setupSignalREventHandlers() {
    signalRConnection.on('ReceiveMessage', (data) => {
        addChatMessage(data.username, data.message, data.messageType);
    });

    signalRConnection.on('UserJoined', (data) => {
        addChatMessage('System', `${data.username} joined the meeting`, 'system');
    });

    signalRConnection.on('UserLeft', (data) => {
        addChatMessage('System', `${data.username} left the meeting`, 'system');
    });

    signalRConnection.on('HandRaised', (data) => {
        console.log(`${data.username} raised hand`);
        raisedHands.add(data.username);
        updateHandRaiseIndicator(data.username, true);
        addChatMessage('System', `${data.username} raised their hand ✋`, 'system');
    });

    signalRConnection.on('HandLowered', (data) => {
        console.log(`${data.username} lowered hand`);
        raisedHands.delete(data.username);
        updateHandRaiseIndicator(data.username, false);
    });

    signalRConnection.on('ReactionReceived', (data) => {
        console.log(`${data.username} sent reaction: ${data.emoji}`);
        showReactionAnimation(data.emoji, data.username);
    });

    signalRConnection.on('ParticipantMutedByHost', (data) => {
        console.log(`Participant ${data.participantIdentity} was muted by ${data.mutedBy}`);

        // Check if it's the current user who was muted
        if (room && room.localParticipant.identity === data.participantIdentity) {
            // Update UI to show muted state
            const micBtn = document.getElementById('micBtn');
            if (micBtn) {
                micBtn.classList.remove('active');
                micEnabled = false;
            }

            // Show notification
            addChatMessage('System', `You were muted by the host (${data.mutedBy})`, 'system');
        }
    });

    signalRConnection.on('AllParticipantsMutedByHost', (data) => {
        console.log(`All participants were muted by ${data.mutedBy}`);

        // Check if current user has audio enabled
        if (room && micEnabled) {
            // Update UI to show muted state
            const micBtn = document.getElementById('micBtn');
            if (micBtn) {
                micBtn.classList.remove('active');
                micEnabled = false;
            }

            // Show notification
            addChatMessage('System', `All participants were muted by the host (${data.mutedBy})`, 'system');
        }
    });

    signalRConnection.on('ParticipantRemovedByHost', (data) => {
        console.log(`Participant ${data.participantIdentity} was removed by ${data.removedBy}`);

        // Check if it's the current user who was removed
        if (room && room.localParticipant.identity === data.participantIdentity) {
            Toast.error(`You have been removed from the meeting by the host (${data.removedBy})`);

            // Disconnect and redirect
            room.disconnect();
            if (isGuest) {
                sessionStorage.clear();
                window.location.href = '../login.html';
            } else {
                window.location.href = 'dashboard.html';
            }
        } else {
            // Another participant was removed - clean up their UI elements immediately
            console.log(`Removing UI elements for kicked participant: ${data.participantIdentity}`);
            removeParticipant(data.participantIdentity);

            // Show system message
            addChatMessage('System', `${data.participantIdentity} was removed from the meeting by ${data.removedBy}`, 'system');
        }
    });

    // Server-side recording started (LiveKit Egress)
    signalRConnection.on('RecordingStarted', (data) => {
        console.log('Server recording started:', data);
        showServerRecordingOverlay(true);
        addChatMessage('System', 'Recording has started', 'system');
    });

    // Server-side recording stopped (LiveKit Egress)
    signalRConnection.on('RecordingStopped', (data) => {
        console.log('Server recording stopped:', data);
        showServerRecordingOverlay(false);
        addChatMessage('System', 'Recording has stopped', 'system');
    });
}

// Add local participant video
function addLocalParticipant() {
    const videoContainer = document.getElementById('videoContainer');
    const participantDiv = document.createElement('div');
    participantDiv.className = 'video-participant';
    participantDiv.id = 'local-participant';
    participantZoomLevels['local'] = 1;

    const video = document.createElement('video');
    video.autoplay = true;
    video.muted = true;
    video.playsInline = true;

    const nameTag = document.createElement('div');
    nameTag.className = 'participant-name';
    nameTag.textContent = 'You';

    // Add zoom controls
    const zoomControls = createZoomControls('local');

    participantDiv.appendChild(video);
    participantDiv.appendChild(nameTag);
    participantDiv.appendChild(zoomControls);
    videoContainer.appendChild(participantDiv);

    // Attach local tracks
    room.localParticipant.videoTrackPublications.forEach((publication) => {
        if (publication.track) {
            video.srcObject = new MediaStream([publication.track.mediaStreamTrack]);
        }
    });
}

// Add remote participant
function addParticipant(participant) {
    const videoContainer = document.getElementById('videoContainer');
    const participantDiv = document.createElement('div');
    participantDiv.className = 'video-participant';
    participantDiv.id = `participant-${participant.identity}`;
    participantZoomLevels[participant.identity] = 1;

    const video = document.createElement('video');
    video.autoplay = true;
    video.playsInline = true;

    const nameTag = document.createElement('div');
    nameTag.className = 'participant-name';
    nameTag.textContent = participant.name || participant.identity;

    // Add zoom controls
    const zoomControls = createZoomControls(participant.identity);

    participantDiv.appendChild(video);
    participantDiv.appendChild(nameTag);
    participantDiv.appendChild(zoomControls);
    videoContainer.appendChild(participantDiv);

    // Attach any existing video tracks (using Safari-compatible method)
    participant.videoTrackPublications.forEach((publication) => {
        if (publication.track && publication.isSubscribed) {
            attachVideoTrackSafari(publication.track, video, participant.identity);
        }
    });

    // Attach any existing audio tracks
    participant.audioTrackPublications.forEach((publication) => {
        if (publication.track && publication.isSubscribed) {
            let audio = document.createElement('audio');
            audio.autoplay = true;
            audio.playsInline = true;
            audio.dataset.participantId = participant.identity;
            participantDiv.appendChild(audio);
            publication.track.attach(audio);

            // Handle mobile Safari autoplay
            const playPromise = audio.play();
            if (playPromise !== undefined) {
                playPromise.catch(() => {
                    console.warn('Audio autoplay blocked for', participant.identity, '- will play on user interaction');
                    const resumeAudio = () => {
                        audio.play().catch(e => console.warn('Audio play retry failed:', e));
                        document.removeEventListener('click', resumeAudio);
                        document.removeEventListener('touchstart', resumeAudio);
                    };
                    document.addEventListener('click', resumeAudio, { once: true });
                    document.addEventListener('touchstart', resumeAudio, { once: true });
                });
            }
        }
    });
}

// Remove participant
function removeParticipant(participantOrIdentity) {
    // Support both participant object and identity string for backwards compatibility
    const identity = typeof participantOrIdentity === 'string' ? participantOrIdentity : participantOrIdentity.identity;
    const participantSid = typeof participantOrIdentity === 'object' ? participantOrIdentity.sid : null;

    console.log(`Removing participant: ${identity}`);

    // Remove from active speaker manager
    if (activeSpeakerManager && participantSid) {
        activeSpeakerManager.removeParticipant(participantSid);
    }

    // Remove video tile
    const participantDiv = document.getElementById(`participant-${identity}`);
    if (participantDiv) {
        console.log(`Removing video tile for: ${identity}`);
        participantDiv.remove();
    }

    // Remove audio-only tile if present
    const audioOnlyDiv = document.getElementById(`audio-only-${identity}`);
    if (audioOnlyDiv) {
        console.log(`Removing audio-only tile for: ${identity}`);
        audioOnlyDiv.remove();
    }

    // Clean up zoom level tracking
    if (participantZoomLevels[identity]) {
        delete participantZoomLevels[identity];
    }

    // Remove from raised hands tracking
    raisedHands.delete(identity);

    console.log(`Participant ${identity} fully removed from UI`);
}

// Periodic cleanup of stale participant tiles (for mobile reliability)
function cleanupStaleParticipants() {
    if (!room) return;

    const videoContainer = document.getElementById('videoContainer');
    if (!videoContainer) return;

    // Get all current remote participant identities
    const activeParticipants = new Set(
        Array.from(room.remoteParticipants.values()).map(p => p.identity)
    );

    // Find all participant tiles in the DOM
    const allTiles = videoContainer.querySelectorAll('[id^="participant-"], [id^="audio-only-"]');

    allTiles.forEach(tile => {
        // Extract identity from tile ID
        let identity = null;
        if (tile.id.startsWith('participant-')) {
            identity = tile.id.replace('participant-', '');
        } else if (tile.id.startsWith('audio-only-')) {
            identity = tile.id.replace('audio-only-', '');
        }

        // Skip local participant
        if (identity === room.localParticipant?.identity || tile.id === 'local-participant') {
            return;
        }

        // Remove tile if participant is no longer active
        if (identity && !activeParticipants.has(identity)) {
            console.log(`Cleaning up stale tile for disconnected participant: ${identity}`);
            tile.remove();
        }
    });
}

// Start periodic cleanup every 5 seconds
let staleCleanupInterval = null;
function startStaleParticipantCleanup() {
    if (staleCleanupInterval) return;
    staleCleanupInterval = setInterval(cleanupStaleParticipants, 5000);
    console.log('Started periodic stale participant cleanup');
}

function stopStaleParticipantCleanup() {
    if (staleCleanupInterval) {
        clearInterval(staleCleanupInterval);
        staleCleanupInterval = null;
        console.log('Stopped periodic stale participant cleanup');
    }
}

// Track current layout state to avoid unnecessary rebuilds
let currentLayoutState = {
    mainSpeakerIdentity: null,
    smallTileIdentities: []
};

// Update participant layout based on active speaker detection
// OPTIMIZED: Only rebuild when layout actually changes to prevent flickering
function updateParticipantLayout(layout) {
    const videoContainer = document.getElementById('videoContainer');
    const mainSpeaker = layout.mainSpeaker;
    const videoParticipants = layout.videoParticipants || [];

    // Determine what the new layout should be
    let newMainSpeakerIdentity = null;
    let newSmallTileIdentities = [];

    // Determine main speaker identity
    // Check if main speaker is the local participant (compare with local participant's identity)
    const localIdentity = room.localParticipant?.identity;
    const isMainSpeakerLocal = !mainSpeaker ||
                               mainSpeaker.participantSid === 'local' ||
                               mainSpeaker.identity === localIdentity;

    if (isMainSpeakerLocal) {
        newMainSpeakerIdentity = 'local';
    } else {
        const mainParticipant = room.remoteParticipants.get(mainSpeaker.identity);
        if (mainParticipant) {
            newMainSpeakerIdentity = mainSpeaker.identity;
        } else if (videoParticipants.length > 0) {
            const fallbackParticipant = room.remoteParticipants.get(videoParticipants[0].identity);
            if (fallbackParticipant) {
                newMainSpeakerIdentity = fallbackParticipant.identity;
            } else {
                newMainSpeakerIdentity = 'local';
            }
        } else {
            newMainSpeakerIdentity = 'local';
        }
    }

    // Determine small tile identities
    const maxSmallTiles = 4;
    if (newMainSpeakerIdentity !== 'local') {
        newSmallTileIdentities.push('local');
    }
    videoParticipants.forEach((vpData) => {
        if (newSmallTileIdentities.length >= maxSmallTiles) return;
        if (vpData.identity === newMainSpeakerIdentity) return;
        if (room.remoteParticipants.get(vpData.identity)) {
            newSmallTileIdentities.push(vpData.identity);
        }
    });

    // Check if layout actually changed
    const mainSpeakerChanged = currentLayoutState.mainSpeakerIdentity !== newMainSpeakerIdentity;
    const smallTilesChanged = currentLayoutState.smallTileIdentities.length !== newSmallTileIdentities.length ||
        !currentLayoutState.smallTileIdentities.every((id, i) => id === newSmallTileIdentities[i]);
    const layoutChanged = mainSpeakerChanged || smallTilesChanged;

    if (!layoutChanged) {
        // Layout hasn't changed - skip rebuild to prevent flickering
        return;
    }

    // Update current layout state
    currentLayoutState = {
        mainSpeakerIdentity: newMainSpeakerIdentity,
        smallTileIdentities: [...newSmallTileIdentities]
    };

    // Clear video container
    videoContainer.innerHTML = '';

    // Create main speaker container
    const mainSpeakerContainer = document.createElement('div');
    mainSpeakerContainer.className = 'main-speaker-container';

    // Add recording overlay to main speaker container
    const recordingOverlay = document.createElement('div');
    recordingOverlay.className = 'recording-overlay';
    recordingOverlay.id = 'recordingOverlay';
    recordingOverlay.innerHTML = '<span class="recording-dot"></span>Recording <span id="recordingTimeOverlay">00:00</span>';
    mainSpeakerContainer.appendChild(recordingOverlay);

    // Create small tiles container
    const smallTilesContainer = document.createElement('div');
    smallTilesContainer.className = 'small-tiles-container';

    // Add main speaker
    if (newMainSpeakerIdentity === 'local') {
        addParticipantToContainer(room.localParticipant, mainSpeakerContainer, 'main-speaker-tile', true);
    } else {
        const mainParticipant = room.remoteParticipants.get(newMainSpeakerIdentity);
        if (mainParticipant) {
            addParticipantToContainer(mainParticipant, mainSpeakerContainer, 'main-speaker-tile', false);
        }
    }

    // Add small tiles
    newSmallTileIdentities.forEach((identity) => {
        if (identity === 'local') {
            addParticipantToContainer(room.localParticipant, smallTilesContainer, 'small-tile', true);
        } else {
            const participant = room.remoteParticipants.get(identity);
            if (participant) {
                addParticipantToContainer(participant, smallTilesContainer, 'small-tile', false);
            }
        }
    });

    // Append containers to video container
    videoContainer.appendChild(mainSpeakerContainer);

    // Only add small tiles container if there are small tiles
    if (newSmallTileIdentities.length > 0) {
        videoContainer.appendChild(smallTilesContainer);
        videoContainer.classList.remove('single-participant');
    } else {
        // Single participant - add class for full width layout
        videoContainer.classList.add('single-participant');
    }
}

// Helper function to get initials from name
function getInitials(name) {
    if (!name) return '?';
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) {
        return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }
    return name.substring(0, 2).toUpperCase();
}

// Helper function to create camera-off placeholder
function createCameraOffPlaceholder(name) {
    const placeholder = document.createElement('div');
    placeholder.className = 'camera-off-placeholder';

    const initials = getInitials(name);

    placeholder.innerHTML = `
        <div class="camera-off-avatar">
            <div class="pulse-ring"></div>
            <div class="pulse-ring"></div>
            <div class="pulse-ring"></div>
            <div class="avatar-circle">${initials}</div>
        </div>
        <div class="camera-off-audio-indicator">
            <div class="audio-wave">
                <div class="wave-bar"></div>
                <div class="wave-bar"></div>
                <div class="wave-bar"></div>
                <div class="wave-bar"></div>
            </div>
            <span>Audio Only</span>
        </div>
    `;

    return placeholder;
}

// Helper function to check if participant has active video
function hasActiveVideo(participant, isLocal) {
    const trackPublications = isLocal
        ? participant.videoTrackPublications
        : participant.videoTrackPublications;

    for (const [, publication] of trackPublications) {
        if (publication.source === 'camera' && publication.track && !publication.track.isMuted) {
            return true;
        }
    }
    return false;
}

// Helper function to update camera-off placeholder visibility
function updateCameraOffPlaceholder(participantDiv, hasVideo) {
    const placeholder = participantDiv.querySelector('.camera-off-placeholder');
    if (placeholder) {
        if (hasVideo) {
            placeholder.classList.remove('visible');
        } else {
            placeholder.classList.add('visible');
        }
    }
}

// Helper function to add participant to a container
function addParticipantToContainer(participant, container, className, isLocal) {
    const participantDiv = document.createElement('div');
    participantDiv.className = `video-participant ${className}`;
    participantDiv.id = isLocal ? 'local-participant' : `participant-${participant.identity}`;

    const video = document.createElement('video');
    video.autoplay = true;
    video.muted = isLocal;
    video.playsInline = true;
    video.style.width = '100%';
    video.style.height = '100%';
    video.style.objectFit = 'cover';

    const nameTag = document.createElement('div');
    nameTag.className = 'participant-name';
    const displayName = isLocal ? 'You' : (participant.name || participant.identity);
    nameTag.textContent = displayName;

    // Create camera-off placeholder with avatar
    const cameraOffPlaceholder = createCameraOffPlaceholder(displayName);

    participantDiv.appendChild(video);
    participantDiv.appendChild(cameraOffPlaceholder);
    participantDiv.appendChild(nameTag);

    // Check initial video state
    let hasVideo = false;

    // Attach tracks
    if (isLocal) {
        const localTracks = room.localParticipant.videoTrackPublications;
        localTracks.forEach((publication) => {
            if (publication.track && publication.source === 'camera') {
                publication.track.attach(video);
                if (!publication.track.isMuted) {
                    hasVideo = true;
                }
            }
        });
    } else {
        // Attach video track for remote participants (using Safari-compatible method)
        participant.videoTrackPublications.forEach((publication) => {
            if (publication.track && publication.isSubscribed && publication.source === 'camera') {
                attachVideoTrackSafari(publication.track, video, participant.identity);
                if (!publication.track.isMuted) {
                    hasVideo = true;
                }
            }
        });

        // Attach audio track for remote participants
        participant.audioTrackPublications.forEach((publication) => {
            if (publication.track && publication.isSubscribed) {
                const audio = document.createElement('audio');
                audio.autoplay = true;
                audio.playsInline = true;
                audio.dataset.participantId = participant.identity;
                participantDiv.appendChild(audio);
                publication.track.attach(audio);

                // Handle mobile Safari autoplay
                const playPromise = audio.play();
                if (playPromise !== undefined) {
                    playPromise.catch(() => {
                        console.warn('Audio autoplay blocked for', participant.identity, '- will play on user interaction');
                        const resumeAudio = () => {
                            audio.play().catch(e => console.warn('Audio play retry failed:', e));
                            document.removeEventListener('click', resumeAudio);
                            document.removeEventListener('touchstart', resumeAudio);
                        };
                        document.addEventListener('click', resumeAudio, { once: true });
                        document.addEventListener('touchstart', resumeAudio, { once: true });
                    });
                }
            }
        });
    }

    // Show placeholder if no video
    updateCameraOffPlaceholder(participantDiv, hasVideo);

    container.appendChild(participantDiv);
}

// Add audio-only participant indicator
function addAudioOnlyParticipant(participant) {
    const videoContainer = document.getElementById('videoContainer');
    const audioOnlyDiv = document.createElement('div');
    audioOnlyDiv.className = 'audio-only-participant';
    audioOnlyDiv.id = `audio-only-${participant.identity}`;

    const icon = document.createElement('div');
    icon.className = 'audio-only-icon';
    icon.innerHTML = '🎤';

    const nameTag = document.createElement('div');
    nameTag.className = 'participant-name';
    nameTag.textContent = participant.name || participant.identity;

    audioOnlyDiv.appendChild(icon);
    audioOnlyDiv.appendChild(nameTag);
    videoContainer.appendChild(audioOnlyDiv);
}

// Attach track to participant
function attachTrack(track, publication, participant) {
    // Handle screen share tracks separately
    if (publication.source === 'screen_share') {
        const screenShareVideo = document.getElementById('screenShareVideo');
        const screenShareContainer = document.getElementById('screenShareContainer');
        const screenShareName = document.getElementById('screenShareName');
        const videoContainer = document.getElementById('videoContainer');
        const chatSidebar = document.querySelector('.chat-sidebar');
        const screenBtn = document.getElementById('screenBtn');
        const screenShareControls = document.getElementById('screenShareControls');

        // Set highest quality for screen share - we want crisp text and details
        publication.setVideoQuality(LivekitClient.VideoQuality.HIGH);
        console.log('Screen share quality set to HIGH for best viewing experience');

        // Use Safari-compatible method for screen share
        attachVideoTrackSafari(track, screenShareVideo, `${participant.identity}-screenshare`);

        screenShareContainer.style.display = 'flex';
        videoContainer.classList.add('minimized');
        // Save chat visibility state before hiding
        chatWasVisibleBeforeScreenShare = chatSidebar.classList.contains('visible');
        chatSidebar.style.display = 'none';
        chatSidebar.classList.remove('visible');
        screenShareName.textContent = `${participant.name || participant.identity} is sharing`;

        // Mark that someone is sharing and disable button for others
        isAnyoneScreenSharing = true;
        // Disable active speaker switching while screen share is active
        if (activeSpeakerManager) {
            activeSpeakerManager.setScreenShareActive(true);
        }
        const isLocalParticipant = participant.identity === room.localParticipant.identity;
        if (!isLocalParticipant) {
            screenBtn.disabled = true;
            screenBtn.style.opacity = '0.5';
            screenBtn.style.cursor = 'not-allowed';
            // Show controls only for viewers, not the person sharing
            screenShareControls.style.display = 'flex';

            // Enable drag to pan and wheel zoom for viewers
            screenShareVideo.style.cursor = 'grab';
            screenShareVideo.addEventListener('mousedown', onScreenShareMouseDown);
            screenShareVideo.addEventListener('mousemove', onScreenShareMouseMove);
            screenShareVideo.addEventListener('mouseup', onScreenShareMouseUp);
            screenShareVideo.addEventListener('mouseleave', onScreenShareMouseLeave);
            screenShareVideo.addEventListener('wheel', onScreenShareWheel, { passive: false });
        } else {
            // Hide controls for the person who is sharing
            screenShareControls.style.display = 'none';
            screenShareVideo.style.cursor = 'default';
        }

        // Reset zoom and pan when new screen share starts
        resetScreenShare();
        return;
    }

    const participantDiv = document.getElementById(`participant-${participant.identity}`);
    if (participantDiv) {
        if (track.kind === 'video') {
            const video = participantDiv.querySelector('video');
            if (video) {
                // Use Safari-compatible method
                attachVideoTrackSafari(track, video, participant.identity);

                // CRITICAL: Update camera-off placeholder visibility after video track is attached
                updateCameraOffPlaceholder(participantDiv, !track.isMuted);
            }
        } else if (track.kind === 'audio') {
            // Create or get audio element for this participant
            let audio = participantDiv.querySelector('audio');
            if (!audio) {
                audio = document.createElement('audio');
                audio.autoplay = true;
                audio.playsInline = true;
                // Add data attribute to identify the participant for this audio
                audio.dataset.participantId = participant.identity;
                participantDiv.appendChild(audio);
            }
            track.attach(audio);

            // Handle mobile Safari autoplay - attempt play with user gesture fallback
            const playPromise = audio.play();
            if (playPromise !== undefined) {
                playPromise.catch(() => {
                    console.warn('Audio autoplay blocked for', participant.identity, '- will play on user interaction');
                    // Add one-time click handler to resume audio on any user interaction
                    const resumeAudio = () => {
                        audio.play().catch(e => console.warn('Audio play retry failed:', e));
                        document.removeEventListener('click', resumeAudio);
                        document.removeEventListener('touchstart', resumeAudio);
                    };
                    document.addEventListener('click', resumeAudio, { once: true });
                    document.addEventListener('touchstart', resumeAudio, { once: true });
                });
            }
        }
    } else {
        // Participant element doesn't exist yet - race condition between track subscription and DOM creation
        // This happens when trackSubscribed fires before participantConnected has finished updating the layout
        console.warn(`Participant element not found for ${participant.identity}, ensuring participant is in active speakers...`);

        // CRITICAL FIX: Manually add participant to activeSpeakers if not already there
        // This is the root cause - trackSubscribed can fire before participantConnected
        if (activeSpeakerManager) {
            const existingInSpeakers = activeSpeakerManager.activeSpeakers.find(
                s => s.participantSid === participant.sid || s.identity === participant.identity
            );

            if (!existingInSpeakers) {
                console.log(`Adding ${participant.identity} to activeSpeakers (was missing)`);
                activeSpeakerManager.activeSpeakers.push({
                    participantSid: participant.sid,
                    identity: participant.identity,
                    lastActiveTime: Date.now(),
                    isSpeaking: false
                });
                activeSpeakerManager.sortSpeakers();
                activeSpeakerManager.updateMainSpeaker();
            }

            // Reset layout state to force a rebuild (bypass change detection)
            currentLayoutState = { mainSpeakerIdentity: null, smallTileIdentities: [] };

            // Force layout refresh to create the participant element
            activeSpeakerManager.notifyLayoutChange();
        }

        // Use exponential backoff for retries
        const retryAttachTrack = (retryCount, delay) => {
            setTimeout(() => {
                const retryDiv = document.getElementById(`participant-${participant.identity}`);
                if (retryDiv) {
                    if (track.kind === 'video') {
                        const video = retryDiv.querySelector('video');
                        if (video) {
                            // Use Safari-compatible method
                            attachVideoTrackSafari(track, video, participant.identity);
                            console.log(`Video track attached for ${participant.identity} (retry ${retryCount} successful)`);

                            // Update camera-off placeholder visibility
                            updateCameraOffPlaceholder(retryDiv, !track.isMuted);
                        }
                    } else if (track.kind === 'audio') {
                        let audio = retryDiv.querySelector('audio');
                        if (!audio) {
                            audio = document.createElement('audio');
                            audio.autoplay = true;
                            audio.playsInline = true;
                            audio.dataset.participantId = participant.identity;
                            retryDiv.appendChild(audio);
                        }
                        track.attach(audio);
                        audio.play().catch(() => {});
                        console.log(`Audio track attached for ${participant.identity} (retry ${retryCount} successful)`);
                    }
                } else if (retryCount < 5) {
                    // Exponential backoff: 100ms, 200ms, 400ms, 800ms, 1600ms
                    console.warn(`Element still not found for ${participant.identity}, retry ${retryCount + 1}/5 in ${delay * 2}ms`);

                    // Force layout rebuild before next retry
                    if (activeSpeakerManager) {
                        currentLayoutState = { mainSpeakerIdentity: null, smallTileIdentities: [] };
                        activeSpeakerManager.notifyLayoutChange();
                    }

                    retryAttachTrack(retryCount + 1, delay * 2);
                } else {
                    console.error(`Failed to attach ${track.kind} track for ${participant.identity} after 5 retries`);
                }
            }, delay);
        };

        // Start retry with initial 100ms delay
        retryAttachTrack(1, 100);
    }
}

// Detach track
function detachTrack(track, publication, participant) {
    // Handle screen share detachment
    if (publication.source === 'screen_share') {
        const screenShareVideo = document.getElementById('screenShareVideo');
        const screenShareContainer = document.getElementById('screenShareContainer');
        const videoContainer = document.getElementById('videoContainer');
        const chatSidebar = document.querySelector('.chat-sidebar');
        const screenBtn = document.getElementById('screenBtn');
        const screenShareControls = document.getElementById('screenShareControls');

        track.detach(screenShareVideo);
        screenShareContainer.style.display = 'none';
        videoContainer.classList.remove('minimized');
        // Only restore chat visibility if it was open before screen share
        if (chatWasVisibleBeforeScreenShare) {
            chatSidebar.style.display = 'flex';
            chatSidebar.classList.add('visible');
        }
        screenShareControls.style.display = 'none';

        // Remove drag and wheel event listeners
        screenShareVideo.removeEventListener('mousedown', onScreenShareMouseDown);
        screenShareVideo.removeEventListener('mousemove', onScreenShareMouseMove);
        screenShareVideo.removeEventListener('mouseup', onScreenShareMouseUp);
        screenShareVideo.removeEventListener('mouseleave', onScreenShareMouseLeave);
        screenShareVideo.removeEventListener('wheel', onScreenShareWheel);
        screenShareVideo.style.cursor = 'default';

        // Mark that no one is sharing and re-enable button
        isAnyoneScreenSharing = false;
        // Re-enable active speaker switching when screen share ends
        if (activeSpeakerManager) {
            activeSpeakerManager.setScreenShareActive(false);
        }
        screenBtn.disabled = false;
        screenBtn.style.opacity = '1';
        screenBtn.style.cursor = 'pointer';

        // Reset zoom and pan
        resetScreenShare();
        return;
    }

    const participantDiv = document.getElementById(`participant-${participant.identity}`);
    if (participantDiv) {
        const video = participantDiv.querySelector('video');
        if (video) {
            track.detach(video);
        }
    }

    // On mobile, participantDisconnected event may not fire reliably
    // Check if participant is still in the room after a short delay
    setTimeout(() => {
        const isStillConnected = room && Array.from(room.remoteParticipants.values())
            .some(p => p.identity === participant.identity);

        if (!isStillConnected) {
            console.log(`Participant ${participant.identity} no longer in room, cleaning up stale tile`);
            removeParticipant(participant);
        }
    }, 500);
}

// Toggle microphone
let micToggleInProgress = false;
async function toggleMic() {
    // Prevent double-clicks / race conditions
    if (micToggleInProgress) {
        console.log('Mic toggle already in progress, ignoring');
        return;
    }

    const micBtn = document.getElementById('micBtn');
    if (!micBtn) return;

    micToggleInProgress = true;
    micBtn.disabled = true;

    const newState = !micEnabled;

    try {
        await room.localParticipant.setMicrophoneEnabled(newState);
        micEnabled = newState;
        micBtn.classList.toggle('active', micEnabled);
        console.log('Microphone toggled:', micEnabled ? 'ON' : 'OFF');
    } catch (error) {
        console.error('Failed to toggle microphone:', error);
        // Show user-friendly error with device-specific instructions
        const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
        const isAndroid = /Android/i.test(navigator.userAgent);
        const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);

        if (error.name === 'NotAllowedError' || error.message?.includes('Permission') || error.message?.includes('denied')) {
            let message = 'Microphone access was denied.\n\n';
            if (isAndroid) {
                message += 'To enable microphone on Android:\n';
                message += '1. Tap the lock/info icon in the address bar\n';
                message += '2. Tap "Site settings" or "Permissions"\n';
                message += '3. Allow Microphone access\n';
                message += '4. Refresh the page';
            } else if (isIOS) {
                message += 'To enable microphone on iOS:\n';
                message += '1. Go to Settings > Safari (or your browser)\n';
                message += '2. Tap "Microphone"\n';
                message += '3. Select "Allow"\n';
                message += '4. Return to this page and refresh';
            } else {
                message += 'Please check your browser permissions and try again.';
            }
            Toast.warning(message, 10000);
        } else {
            // For other errors, try to re-acquire mic permission
            try {
                await navigator.mediaDevices.getUserMedia({ audio: true });
                // Retry the toggle
                await room.localParticipant.setMicrophoneEnabled(newState);
                micEnabled = newState;
                micBtn.classList.toggle('active', micEnabled);
            } catch (retryError) {
                console.error('Retry failed:', retryError);
                let message = 'Unable to toggle microphone.\n\n';
                if (isMobile) {
                    message += 'Please try:\n';
                    message += '1. Refresh the page\n';
                    message += '2. Check microphone permissions in browser settings\n';
                    message += '3. Restart your browser';
                } else {
                    message += 'Please refresh the page and try again.';
                }
                Toast.warning(message, 10000);
            }
        }
    } finally {
        micToggleInProgress = false;
        micBtn.disabled = false;
    }
}

// Toggle camera
let cameraToggleInProgress = false;
async function toggleCamera() {
    // Prevent double-clicks / race conditions
    if (cameraToggleInProgress) {
        console.log('Camera toggle already in progress, ignoring');
        return;
    }

    const camBtn = document.getElementById('camBtn');
    if (!camBtn) return;

    cameraToggleInProgress = true;
    camBtn.disabled = true;

    const newState = !cameraEnabled;

    try {
        await room.localParticipant.setCameraEnabled(newState);
        cameraEnabled = newState;
        camBtn.classList.toggle('active', cameraEnabled);
        console.log('Camera toggled:', cameraEnabled ? 'ON' : 'OFF');

        // Update camera-off placeholder visibility
        const localDiv = document.getElementById('local-participant');
        if (localDiv) {
            updateCameraOffPlaceholder(localDiv, cameraEnabled);
        }

        // Re-attach video track to local video element after enabling
        if (cameraEnabled) {
            const video = document.querySelector('#local-participant video');
            if (video) {
                // Wait for the new track to be published, with proper retry
                let retries = 0;
                const maxRetries = 10;
                const attachVideoTrack = () => {
                    const cameraPublication = Array.from(room.localParticipant.videoTrackPublications.values())
                        .find(pub => pub.source === 'camera' && pub.track);

                    if (cameraPublication && cameraPublication.track) {
                        video.srcObject = new MediaStream([cameraPublication.track.mediaStreamTrack]);
                        console.log('Camera track reattached successfully');
                    } else if (retries < maxRetries) {
                        retries++;
                        setTimeout(attachVideoTrack, 100);
                    } else {
                        console.warn('Could not find camera track after', maxRetries, 'retries');
                    }
                };
                setTimeout(attachVideoTrack, 100);
            }
        }
    } catch (error) {
        console.error('Failed to toggle camera:', error);
        // Show user-friendly error with device-specific instructions
        const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
        const isAndroid = /Android/i.test(navigator.userAgent);
        const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);

        if (error.name === 'NotAllowedError' || error.message?.includes('Permission') || error.message?.includes('denied')) {
            let message = 'Camera access was denied.\n\n';
            if (isAndroid) {
                message += 'To enable camera on Android:\n';
                message += '1. Tap the lock/info icon in the address bar\n';
                message += '2. Tap "Site settings" or "Permissions"\n';
                message += '3. Allow Camera access\n';
                message += '4. Refresh the page';
            } else if (isIOS) {
                message += 'To enable camera on iOS:\n';
                message += '1. Go to Settings > Safari (or your browser)\n';
                message += '2. Tap "Camera"\n';
                message += '3. Select "Allow"\n';
                message += '4. Return to this page and refresh';
            } else {
                message += 'Please allow camera access in your browser settings and refresh the page.';
            }
            Toast.warning(message, 10000);
        } else if (error.name === 'NotReadableError' || error.message?.includes('in use') || error.message?.includes('Could not start')) {
            let message = 'Camera is not available.\n\n';
            if (isMobile) {
                message += 'This may be because:\n';
                message += '- Another app is using the camera\n';
                message += '- Camera hardware issue\n\n';
                message += 'Try:\n';
                message += '1. Close other apps using the camera\n';
                message += '2. Refresh the page\n';
                message += '3. Restart your browser';
            } else {
                message += 'The camera may be in use by another application. Close other apps and try again.';
            }
            Toast.warning(message, 10000);
        } else {
            // For other errors, try to re-acquire camera permission
            try {
                await navigator.mediaDevices.getUserMedia({ video: true });
                // Retry the toggle
                await room.localParticipant.setCameraEnabled(newState);
                cameraEnabled = newState;
                camBtn.classList.toggle('active', cameraEnabled);
            } catch (retryError) {
                console.error('Retry failed:', retryError);
                let message = 'Unable to toggle camera.\n\n';
                if (isMobile) {
                    message += 'Please try:\n';
                    message += '1. Refresh the page\n';
                    message += '2. Check camera permissions in browser settings\n';
                    message += '3. Restart your browser';
                } else {
                    message += 'Please refresh the page and try again.';
                }
                Toast.warning(message, 10000);
            }
        }
    } finally {
        cameraToggleInProgress = false;
        camBtn.disabled = false;
    }
}

// Toggle screen share
async function toggleScreenShare() {
    const isSharing = room.localParticipant.isScreenShareEnabled;
    const screenBtn = document.getElementById('screenBtn');

    // Don't allow starting screen share if someone else is already sharing
    if (!isSharing && isAnyoneScreenSharing) {
        Toast.warning('Someone else is already sharing their screen. Please wait until they stop.');
        return;
    }

    if (isSharing) {
        await room.localParticipant.setScreenShareEnabled(false);
        screenBtn.classList.remove('active');

        // Re-attach camera video after stopping screen share
        const video = document.querySelector('#local-participant video');
        if (video && cameraEnabled) {
            setTimeout(() => {
                room.localParticipant.videoTrackPublications.forEach((publication) => {
                    if (publication.track && publication.source === 'camera') {
                        video.srcObject = new MediaStream([publication.track.mediaStreamTrack]);
                    }
                });
            }, 100);
        }
    } else {
        // Enable screen share with MAXIMUM QUALITY settings for crisp text
        // Capture at native resolution, optimize for text/detail content
        await room.localParticipant.setScreenShareEnabled(true, {
            audio: false, // No audio - save bandwidth for video quality
            video: {
                displaySurface: 'monitor', // Prefer full screen capture
            },
            contentHint: 'text', // Optimize encoding for text clarity
            resolution: { width: 3840, height: 2160 }, // Request 4K capture
        });
        screenBtn.classList.add('active');
        console.log('Screen share started with 4K resolution and text optimization');

        // Apply contentHint and log encoding stats
        setTimeout(async () => {
            for (const [_, publication] of room.localParticipant.videoTrackPublications) {
                if (publication.source === 'screen_share' && publication.track) {
                    const mediaStreamTrack = publication.track.mediaStreamTrack;

                    // Set contentHint for text optimization
                    if (mediaStreamTrack && 'contentHint' in mediaStreamTrack) {
                        mediaStreamTrack.contentHint = 'text';
                        console.log('Applied contentHint=text to screen share track');
                    }

                    // Log actual capture settings
                    const settings = mediaStreamTrack.getSettings();
                    console.log('Screen share capture settings:', {
                        width: settings.width,
                        height: settings.height,
                        frameRate: settings.frameRate,
                        displaySurface: settings.displaySurface
                    });
                }
            }
        }, 1000);
    }
}

// Toggle recording
async function toggleRecording() {
    if (!isRecording) {
        await startRecording();
    } else {
        await stopRecording();
    }
}

// Start recording
async function startRecording() {
    try {
        // Get all audio and video tracks from the meeting
        const tracks = [];

        // Add local participant tracks
        room.localParticipant.audioTrackPublications.forEach((pub) => {
            if (pub.track) tracks.push(pub.track.mediaStreamTrack);
        });
        room.localParticipant.videoTrackPublications.forEach((pub) => {
            if (pub.track && pub.source === 'camera') {
                tracks.push(pub.track.mediaStreamTrack);
            }
        });

        // Add remote participant tracks
        room.remoteParticipants.forEach((participant) => {
            participant.audioTrackPublications.forEach((pub) => {
                if (pub.track && pub.isSubscribed) {
                    tracks.push(pub.track.mediaStreamTrack);
                }
            });
            participant.videoTrackPublications.forEach((pub) => {
                if (pub.track && pub.isSubscribed && pub.source === 'camera') {
                    tracks.push(pub.track.mediaStreamTrack);
                }
            });
        });

        if (tracks.length === 0) {
            Toast.warning('No tracks available to record. Please enable your camera or microphone.');
            return;
        }

        // Create a MediaStream from all tracks
        const stream = new MediaStream(tracks);

        // Create MediaRecorder
        const options = {
            mimeType: 'video/webm;codecs=vp8,opus',
            videoBitsPerSecond: 2500000 // 2.5 Mbps
        };

        // Fallback to default if codec not supported
        if (!MediaRecorder.isTypeSupported(options.mimeType)) {
            options.mimeType = 'video/webm';
        }

        mediaRecorder = new MediaRecorder(stream, options);
        recordedChunks = [];

        mediaRecorder.ondataavailable = (event) => {
            if (event.data.size > 0) {
                recordedChunks.push(event.data);
            }
        };

        mediaRecorder.onstop = () => {
            downloadRecording();
        };

        mediaRecorder.start(1000); // Collect data every second

        isRecording = true;
        isPaused = false;
        recordingStartTime = Date.now();

        // Update UI
        const recordBtn = document.getElementById('recordBtn');
        if (recordBtn) {
            recordBtn.classList.add('active');
            const label = recordBtn.querySelector('.menu-label');
            if (label) label.textContent = 'Stop Recording';
        }
        const recordingStatus = document.getElementById('recordingStatus');
        if (recordingStatus) {
            recordingStatus.classList.add('visible');
        }

        // Show recording overlay on video
        const recordingOverlay = document.getElementById('recordingOverlay');
        if (recordingOverlay) {
            recordingOverlay.classList.add('visible');
        }

        // Start timer
        recordingTimerInterval = setInterval(updateRecordingTimer, 1000);

        console.log('Recording started');
    } catch (error) {
        console.error('Error starting recording:', error);
        Toast.error('Failed to start recording: ' + error.message);
    }
}

// Pause recording
function pauseRecording() {
    if (mediaRecorder && mediaRecorder.state === 'recording') {
        mediaRecorder.pause();
        isPaused = true;

        // Update UI
        const recordBtn = document.getElementById('recordBtn');
        if (recordBtn) {
            const label = recordBtn.querySelector('.menu-label');
            if (label) label.textContent = 'Resume';
        }
        const recordingStatus = document.getElementById('recordingStatus');
        if (recordingStatus) {
            recordingStatus.style.color = 'var(--color-warning)';
            recordingStatus.innerHTML = '⏸️ Paused... <span id="recordingTime">00:00</span>';
        }

        // Stop timer
        if (recordingTimerInterval) {
            clearInterval(recordingTimerInterval);
            recordingTimerInterval = null;
        }

        console.log('Recording paused');
    }
}

// Resume recording
function resumeRecording() {
    if (mediaRecorder && mediaRecorder.state === 'paused') {
        mediaRecorder.resume();
        isPaused = false;

        // Update UI
        const recordBtn = document.getElementById('recordBtn');
        if (recordBtn) {
            const label = recordBtn.querySelector('.menu-label');
            if (label) label.textContent = 'Pause';
        }
        const recordingStatus = document.getElementById('recordingStatus');
        if (recordingStatus) {
            recordingStatus.style.color = 'var(--color-danger)';
            recordingStatus.innerHTML = '🔴 Recording... <span id="recordingTime">00:00</span>';
        }

        // Restart timer
        recordingTimerInterval = setInterval(updateRecordingTimer, 1000);

        console.log('Recording resumed');
    }
}

// Stop recording and download
async function stopRecording() {
    if (mediaRecorder && (mediaRecorder.state === 'recording' || mediaRecorder.state === 'paused')) {
        mediaRecorder.stop();

        // Stop timer
        if (recordingTimerInterval) {
            clearInterval(recordingTimerInterval);
            recordingTimerInterval = null;
        }

        // Reset UI
        const recordBtn = document.getElementById('recordBtn');
        if (recordBtn) {
            recordBtn.classList.remove('active');
            const label = recordBtn.querySelector('.menu-label');
            if (label) label.textContent = 'Record';
        }
        const recordingStatus = document.getElementById('recordingStatus');
        if (recordingStatus) {
            recordingStatus.classList.remove('visible');
        }

        // Hide recording overlay on video
        const recordingOverlay = document.getElementById('recordingOverlay');
        if (recordingOverlay) {
            recordingOverlay.classList.remove('visible');
        }

        isRecording = false;
        isPaused = false;
        recordingStartTime = null;

        console.log('Recording stopped');
    }
}

// Show/hide server-side recording overlay (LiveKit Egress)
let serverRecordingStartTime = null;
let serverRecordingTimerInterval = null;

function showServerRecordingOverlay(show) {
    const recordingOverlay = document.getElementById('recordingOverlay');
    if (!recordingOverlay) return;

    if (show) {
        recordingOverlay.classList.add('visible');
        serverRecordingStartTime = Date.now();
        // Start timer for server recording
        serverRecordingTimerInterval = setInterval(updateServerRecordingTimer, 1000);
        console.log('Server recording overlay shown');
    } else {
        recordingOverlay.classList.remove('visible');
        serverRecordingStartTime = null;
        if (serverRecordingTimerInterval) {
            clearInterval(serverRecordingTimerInterval);
            serverRecordingTimerInterval = null;
        }
        // Reset timer display
        const overlayTimer = document.getElementById('recordingTimeOverlay');
        if (overlayTimer) {
            overlayTimer.textContent = '00:00';
        }
        console.log('Server recording overlay hidden');
    }
}

function updateServerRecordingTimer() {
    if (serverRecordingStartTime) {
        const elapsed = Math.floor((Date.now() - serverRecordingStartTime) / 1000);
        const overlayTimer = document.getElementById('recordingTimeOverlay');
        if (overlayTimer) {
            overlayTimer.textContent = formatTime(elapsed);
        }
    }
}

// Update recording timer
function updateRecordingTimer() {
    if (recordingStartTime) {
        const elapsed = Math.floor((Date.now() - recordingStartTime) / 1000);
        const formattedTime = formatTime(elapsed);

        // Update header timer
        const timerElement = document.getElementById('recordingTime');
        if (timerElement) {
            timerElement.textContent = formattedTime;
        }

        // Update overlay timer
        const overlayTimer = document.getElementById('recordingTimeOverlay');
        if (overlayTimer) {
            overlayTimer.textContent = formattedTime;
        }
    }
}

// Format time (seconds to MM:SS)
function formatTime(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

// Download recording
function downloadRecording() {
    if (recordedChunks.length === 0) {
        console.log('No recorded data to download');
        return;
    }

    const blob = new Blob(recordedChunks, { type: 'video/webm' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');

    // Generate filename with timestamp
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    link.download = `meeting-recording-${timestamp}.webm`;
    link.href = url;

    // Trigger download
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    // Clean up
    setTimeout(() => URL.revokeObjectURL(url), 100);

    console.log('Recording downloaded');

    // Reset
    mediaRecorder = null;
    recordedChunks = [];
}

// Load chat history
async function loadChatHistory() {
    try {
        const messages = await api.getChatHistory(meetingId);
        messages.forEach(msg => {
            addChatMessage(msg.user_id || 'Unknown', msg.message, msg.message_type);
        });
    } catch (error) {
        console.error('Error loading chat history:', error);
    }
}

// Send chat message
async function sendMessage() {
    const input = document.getElementById('chatInput');
    const message = input.value.trim();

    if (message && signalRConnection) {
        try {
            await signalRConnection.invoke('SendMessage', meetingId, message);
            input.value = '';
        } catch (error) {
            console.error('Error sending message:', error);
        }
    }
}

// Handle Enter key in chat
function handleChatKeyPress(event) {
    if (event.key === 'Enter') {
        sendMessage();
    }
}

// Add chat message to UI
function addChatMessage(sender, message, type = 'text') {
    const chatMessages = document.getElementById('chatMessages');
    const messageDiv = document.createElement('div');
    messageDiv.className = 'chat-message';

    const senderDiv = document.createElement('div');
    senderDiv.className = 'chat-message-sender';
    senderDiv.textContent = sender;

    const textDiv = document.createElement('div');
    textDiv.className = 'chat-message-text';
    textDiv.textContent = message;

    if (type === 'system') {
        senderDiv.style.color = 'var(--text-muted)';
        textDiv.style.fontStyle = 'italic';
    }

    messageDiv.appendChild(senderDiv);
    messageDiv.appendChild(textDiv);
    chatMessages.appendChild(messageDiv);

    // Scroll to bottom
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

// Create zoom controls
function createZoomControls(participantId) {
    const zoomControls = document.createElement('div');
    zoomControls.className = 'zoom-controls';

    const zoomInBtn = document.createElement('button');
    zoomInBtn.className = 'zoom-btn';
    zoomInBtn.textContent = '+';
    zoomInBtn.onclick = () => zoomParticipant(participantId, 0.2);

    const zoomOutBtn = document.createElement('button');
    zoomOutBtn.className = 'zoom-btn';
    zoomOutBtn.textContent = '−';
    zoomOutBtn.onclick = () => zoomParticipant(participantId, -0.2);

    const resetBtn = document.createElement('button');
    resetBtn.className = 'zoom-btn';
    resetBtn.textContent = '⟲';
    resetBtn.onclick = () => resetZoom(participantId);

    zoomControls.appendChild(zoomInBtn);
    zoomControls.appendChild(zoomOutBtn);
    zoomControls.appendChild(resetBtn);

    return zoomControls;
}

// Zoom participant video
function zoomParticipant(participantId, delta) {
    const currentZoom = participantZoomLevels[participantId] || 1;
    const newZoom = Math.max(0.5, Math.min(3, currentZoom + delta)); // Limit between 0.5x and 3x
    participantZoomLevels[participantId] = newZoom;

    const participantDiv = participantId === 'local'
        ? document.getElementById('local-participant')
        : document.getElementById(`participant-${participantId}`);

    if (participantDiv) {
        const video = participantDiv.querySelector('video');
        if (video) {
            video.style.transform = `scale(${newZoom})`;
        }
    }
}

// Reset zoom
function resetZoom(participantId) {
    participantZoomLevels[participantId] = 1;

    const participantDiv = participantId === 'local'
        ? document.getElementById('local-participant')
        : document.getElementById(`participant-${participantId}`);

    if (participantDiv) {
        const video = participantDiv.querySelector('video');
        if (video) {
            video.style.transform = 'scale(1)';
        }
    }
}

// Zoom screen share
function zoomScreenShare(delta) {
    screenShareZoom = Math.max(0.5, Math.min(3, screenShareZoom + delta));
    updateScreenShareTransform();
}

// Pan screen share
function panScreenShare(deltaX, deltaY) {
    screenSharePanX += deltaX;
    screenSharePanY += deltaY;
    updateScreenShareTransform();
}

// Reset screen share view
function resetScreenShare() {
    screenShareZoom = 1;
    screenSharePanX = 0;
    screenSharePanY = 0;
    updateScreenShareTransform();
}

// Update screen share transform
function updateScreenShareTransform() {
    const video = document.getElementById('screenShareVideo');
    if (video) {
        video.style.transform = `scale(${screenShareZoom}) translate(${screenSharePanX}px, ${screenSharePanY}px)`;
    }
}

// Mouse drag handlers for screen share
function onScreenShareMouseDown(e) {
    isDragging = true;
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    dragStartPanX = screenSharePanX;
    dragStartPanY = screenSharePanY;
    e.target.style.cursor = 'grabbing';
}

function onScreenShareMouseMove(e) {
    if (!isDragging) return;

    const deltaX = e.clientX - dragStartX;
    const deltaY = e.clientY - dragStartY;

    screenSharePanX = dragStartPanX + deltaX;
    screenSharePanY = dragStartPanY + deltaY;

    updateScreenShareTransform();
}

function onScreenShareMouseUp(e) {
    if (isDragging) {
        isDragging = false;
        e.target.style.cursor = 'grab';
    }
}

function onScreenShareMouseLeave(e) {
    if (isDragging) {
        isDragging = false;
        e.target.style.cursor = 'grab';
    }
}

// Mouse wheel zoom handler for screen share
function onScreenShareWheel(e) {
    e.preventDefault();

    // Determine zoom direction (positive = zoom in, negative = zoom out)
    const delta = e.deltaY > 0 ? -0.1 : 0.1;

    zoomScreenShare(delta);
}

// Capture screenshot of screen share with current zoom/pan
function captureScreenShareScreenshot() {
    const video = document.getElementById('screenShareVideo');
    const container = document.getElementById('screenShareContainer');

    if (!video || video.readyState < 2) {
        Toast.warning('Screen share video is not ready. Please try again.');
        return;
    }

    try {
        // Create a canvas matching the container size (visible area)
        const canvas = document.createElement('canvas');
        const containerRect = container.getBoundingClientRect();
        canvas.width = containerRect.width;
        canvas.height = containerRect.height;

        const ctx = canvas.getContext('2d');

        // Fill with black background
        ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--gray-950').trim() || '#09090b';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // Save context state
        ctx.save();

        // Apply transformations to match the current view
        // Move to center of canvas
        ctx.translate(canvas.width / 2, canvas.height / 2);

        // Apply zoom (scale)
        ctx.scale(screenShareZoom, screenShareZoom);

        // Apply pan (translate) - note: pan values are already in pixels
        ctx.translate(screenSharePanX, screenSharePanY);

        // Calculate video dimensions maintaining aspect ratio (object-fit: contain)
        const videoAspect = video.videoWidth / video.videoHeight;
        const containerAspect = canvas.width / canvas.height;

        let drawWidth, drawHeight;
        if (videoAspect > containerAspect) {
            // Video is wider - fit to width
            drawWidth = canvas.width - 20; // Account for 10px padding
            drawHeight = drawWidth / videoAspect;
        } else {
            // Video is taller - fit to height
            drawHeight = canvas.height - 20; // Account for 10px padding
            drawWidth = drawHeight * videoAspect;
        }

        // Draw video centered
        ctx.drawImage(
            video,
            -drawWidth / 2,
            -drawHeight / 2,
            drawWidth,
            drawHeight
        );

        // Restore context state
        ctx.restore();

        // Convert canvas to blob and download
        canvas.toBlob((blob) => {
            if (blob) {
                const url = URL.createObjectURL(blob);
                const link = document.createElement('a');

                // Generate filename with timestamp
                const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
                link.download = `screenshare-${timestamp}.png`;
                link.href = url;

                // Trigger download
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);

                // Clean up
                setTimeout(() => URL.revokeObjectURL(url), 100);

                console.log('Screenshot captured with zoom:', screenShareZoom, 'pan:', screenSharePanX, screenSharePanY);
            } else {
                Toast.error('Failed to capture screenshot. Please try again.');
            }
        }, 'image/png');
    } catch (error) {
        console.error('Error capturing screenshot:', error);
        Toast.error('Failed to capture screenshot: ' + error.message);
    }
}

// Copy meeting link to clipboard
function copyMeetingLink() {
    const meetingUrl = window.location.origin + window.location.pathname + '?id=' + meetingId;

    navigator.clipboard.writeText(meetingUrl).then(() => {
        const btn = document.getElementById('copyLinkBtn');
        const originalText = btn.textContent;
        btn.textContent = '✓ Link Copied!';
        btn.style.backgroundColor = 'var(--color-success)';

        setTimeout(() => {
            btn.textContent = originalText;
            btn.style.backgroundColor = '';
        }, 2000);
    }).catch(err => {
        console.error('Failed to copy link:', err);
        Toast.error('Failed to copy link. Please copy manually: ' + meetingUrl);
    });
}

// Leave meeting
async function leaveMeeting() {
    const confirmed = await Confirm.show({
        title: 'Leave Meeting',
        message: 'Are you sure you want to leave the meeting?',
        type: 'warning',
        confirmText: 'Leave',
        cancelText: 'Stay'
    });
    if (confirmed) {
        try {
            // Stop recording if active
            if (isRecording) {
                await stopRecording();
                // Wait a moment for recording to save
                await new Promise(resolve => setTimeout(resolve, 1000));
            }

            if (signalRConnection) {
                await signalRConnection.invoke('LeaveMeeting', meetingId);
                await signalRConnection.stop();
            }

            if (room) {
                await room.disconnect();
            }

            // Stop stale participant cleanup
            stopStaleParticipantCleanup();

            // Clear guest session if guest user
            if (isGuest) {
                sessionStorage.clear();
                window.location.href = '../login.html';
            } else {
                window.location.href = 'dashboard.html';
            }
        } catch (error) {
            console.error('Error leaving meeting:', error);

            if (isGuest) {
                sessionStorage.clear();
                window.location.href = '../login.html';
            } else {
                window.location.href = 'dashboard.html';
            }
        }
    }
}

// Show start meeting button for host
function showStartMeetingButton() {
    const controlsContainer = document.querySelector('.meeting-controls');

    const startButton = document.createElement('button');
    startButton.id = 'startMeetingBtn';
    startButton.className = 'control-btn';
    startButton.style.cssText = 'background: var(--color-success); color: var(--text-inverse); font-weight: bold; padding: 12px 24px; border-radius: 6px; margin-right: 10px;';
    startButton.innerHTML = '▶️ Start Meeting';
    startButton.onclick = startMeetingAsHost;

    // Insert at the beginning of controls
    controlsContainer.insertBefore(startButton, controlsContainer.firstChild);
}

async function startMeetingAsHost() {
    try {
        const result = await api.startMeeting(meetingId);

        if (result.success) {
            // Remove the start button
            const startButton = document.getElementById('startMeetingBtn');
            if (startButton) {
                startButton.remove();
            }

            // Notify lobby participants via SignalR
            if (signalRConnection) {
                await signalRConnection.invoke('NotifyMeetingStarted', meetingId);
            }

            // Show success message
            Toast.success('Meeting started! Participants in the lobby can now join.');
        }
    } catch (error) {
        console.error('Error starting meeting:', error);
        Toast.error('Failed to start meeting: ' + error.message);
    }
}

// Toggle hand raise
async function toggleHandRaise() {
    handRaised = !handRaised;
    const handBtn = document.getElementById('handBtn');

    try {
        if (handRaised) {
            await signalRConnection.invoke('RaiseHand', meetingId);
            handBtn.classList.add('active');
            handBtn.innerHTML = '✋ Lower Hand';
        } else {
            await signalRConnection.invoke('LowerHand', meetingId);
            handBtn.classList.remove('active');
            handBtn.innerHTML = '✋ Raise Hand';
        }
    } catch (error) {
        console.error('Error toggling hand raise:', error);
        handRaised = !handRaised; // Revert on error
    }
}

// Update hand raise indicator on participant
function updateHandRaiseIndicator(username, isRaised) {
    // Find participant by name
    const participants = document.querySelectorAll('.participant-name');
    participants.forEach(nameTag => {
        if (nameTag.textContent === username || (username === 'You' && nameTag.textContent === 'You')) {
            const participantDiv = nameTag.parentElement;
            let handIndicator = participantDiv.querySelector('.hand-raised-indicator');

            if (isRaised) {
                if (!handIndicator) {
                    handIndicator = document.createElement('div');
                    handIndicator.className = 'hand-raised-indicator';
                    handIndicator.innerHTML = '✋';
                    participantDiv.appendChild(handIndicator);
                }
            } else {
                if (handIndicator) {
                    handIndicator.remove();
                }
            }
        }
    });
}

// Toggle reaction picker
function toggleReactionPicker() {
    const picker = document.getElementById('reactionPicker');
    picker.style.display = picker.style.display === 'none' ? 'flex' : 'none';
}

// Send reaction
async function sendReaction(emoji) {
    try {
        await signalRConnection.invoke('SendReaction', meetingId, emoji);
        // Don't close picker - let user send multiple reactions
    } catch (error) {
        console.error('Error sending reaction:', error);
    }
}

// Close reaction picker
function closeReactionPicker() {
    const picker = document.getElementById('reactionPicker');
    picker.style.display = 'none';
}

// Show reaction animation
function showReactionAnimation(emoji, username) {
    const container = document.getElementById('reactionsContainer');
    const reaction = document.createElement('div');
    reaction.className = 'reaction-animation';

    // Create emoji element
    const emojiSpan = document.createElement('span');
    emojiSpan.className = 'reaction-emoji';
    emojiSpan.textContent = emoji;

    // Create username element
    const nameSpan = document.createElement('span');
    nameSpan.className = 'reaction-username';
    nameSpan.textContent = username || 'Anonymous';

    reaction.appendChild(emojiSpan);
    reaction.appendChild(nameSpan);

    // Random horizontal position
    reaction.style.left = Math.random() * 80 + 10 + '%';

    container.appendChild(reaction);

    // Remove after animation completes (3 seconds)
    setTimeout(() => {
        reaction.remove();
    }, 3000);
}

// Toggle Picture-in-Picture mode
async function togglePictureInPicture() {
    const pipBtn = document.getElementById('pipBtn');

    try {
        if (!document.pictureInPictureEnabled) {
            Toast.warning('Picture-in-Picture is not supported in your browser');
            return;
        }

        if (document.pictureInPictureElement) {
            // Exit PiP
            await document.exitPictureInPicture();
            if (pipBtn) pipBtn.classList.remove('active');
            pipEnabled = false;
        } else {
            // Enter PiP - use local participant video or first remote video
            let video = document.querySelector('#local-participant video');

            // If local video not available, try first remote participant
            if (!video || !video.srcObject) {
                video = document.querySelector('.video-participant video');
            }

            if (video && video.srcObject) {
                await video.requestPictureInPicture();
                if (pipBtn) pipBtn.classList.add('active');
                pipEnabled = true;
            } else {
                Toast.warning('No active video available for Picture-in-Picture mode');
            }
        }
    } catch (error) {
        console.error('Error toggling Picture-in-Picture:', error);
        Toast.error('Failed to toggle Picture-in-Picture: ' + error.message);
    }
}

// Listen for PiP exit (when user clicks browser X button)
document.addEventListener('leavepictureinpicture', () => {
    const pipBtn = document.getElementById('pipBtn');
    if (pipBtn) pipBtn.classList.remove('active');
    pipEnabled = false;
});

// Lazy load virtual background libraries (TensorFlow.js, BodyPix, COCO-SSD, Three.js)
// These are ~5MB total and slow down mobile devices if loaded upfront
async function loadVirtualBackgroundLibraries() {
    if (virtualBackgroundLibsLoaded) {
        return true;
    }

    if (virtualBackgroundLibsLoading) {
        // Already loading, wait for it
        while (virtualBackgroundLibsLoading) {
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        return virtualBackgroundLibsLoaded;
    }

    virtualBackgroundLibsLoading = true;

    // Show loading indicator in background panel
    const loadingOverlay = document.getElementById('bgLoadingOverlay');
    if (loadingOverlay) {
        loadingOverlay.style.display = 'flex';
    }

    const libraries = [
        {
            name: 'TensorFlow.js',
            url: 'https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@3.11.0/dist/tf.min.js',
            check: () => typeof tf !== 'undefined'
        },
        {
            name: 'BodyPix',
            url: 'https://cdn.jsdelivr.net/npm/@tensorflow-models/body-pix@2.2.0/dist/body-pix.min.js',
            check: () => typeof bodyPix !== 'undefined'
        },
        {
            name: 'COCO-SSD',
            url: 'https://cdn.jsdelivr.net/npm/@tensorflow-models/coco-ssd@2.2.2/dist/coco-ssd.min.js',
            check: () => typeof cocoSsd !== 'undefined'
        },
        {
            name: 'Three.js',
            url: 'https://cdn.jsdelivr.net/npm/three@0.150.0/build/three.min.js',
            check: () => typeof THREE !== 'undefined'
        }
    ];

    try {
        console.log('🔄 Loading virtual background libraries...');

        for (const lib of libraries) {
            if (lib.check()) {
                console.log(`✓ ${lib.name} already loaded`);
                continue;
            }

            console.log(`Loading ${lib.name}...`);
            await new Promise((resolve, reject) => {
                const script = document.createElement('script');
                script.src = lib.url;
                script.async = true;
                script.onload = () => {
                    console.log(`✓ ${lib.name} loaded`);
                    resolve();
                };
                script.onerror = () => {
                    console.error(`✗ Failed to load ${lib.name}`);
                    reject(new Error(`Failed to load ${lib.name}`));
                };
                document.head.appendChild(script);
            });
        }

        console.log('✅ All virtual background libraries loaded successfully!');
        virtualBackgroundLibsLoaded = true;
        return true;

    } catch (error) {
        console.error('Failed to load virtual background libraries:', error);
        virtualBackgroundLibsLoaded = false;
        return false;
    } finally {
        virtualBackgroundLibsLoading = false;
        if (loadingOverlay) {
            loadingOverlay.style.display = 'none';
        }
    }
}

// Toggle background settings panel
async function toggleBackgroundSettings() {
    const panel = document.getElementById('backgroundSettings');
    const isOpening = panel.style.display === 'none';

    panel.style.display = isOpening ? 'block' : 'none';

    // Lazy load libraries when panel is first opened
    if (isOpening && !virtualBackgroundLibsLoaded && !virtualBackgroundLibsLoading) {
        loadVirtualBackgroundLibraries();
    }
}

// Initialize BodyPix for person segmentation
async function initializeSegmentation() {
    if (bodyPixNet) return bodyPixNet; // Already initialized

    try {
        console.log('Loading BodyPix model...');

        // Check if BodyPix is available
        if (typeof bodyPix === 'undefined') {
            console.warn('BodyPix library not loaded, falling back to simple mode');
            return null;
        }

        // Load BodyPix model
        // Using MobileNetV1 architecture with multiplier 0.75 for balance of speed and accuracy
        bodyPixNet = await bodyPix.load({
            architecture: 'MobileNetV1',
            outputStride: 16,
            multiplier: 0.75,
            quantBytes: 2
        });

        console.log('✅ BodyPix model loaded successfully!');

        // Load COCO-SSD for object detection (person, chair, etc.)
        if (typeof cocoSsd !== 'undefined' && !cocoSsdModel) {
            console.log('Loading COCO-SSD model...');
            cocoSsdModel = await cocoSsd.load();
            console.log('✅ COCO-SSD model loaded successfully!');
        }

        return bodyPixNet;
    } catch (error) {
        console.warn('BodyPix initialization failed, using simple blur mode:', error);
        bodyPixNet = null;
        return null;
    }
}

// Initialize Three.js for virtual background
function initializeThreeJS() {
    if (threeRenderer) return; // Already initialized

    console.log('Initializing Three.js for virtual background...');

    // Create Three.js renderer using the existing canvas
    threeRenderer = new THREE.WebGLRenderer({
        canvas: backgroundCanvas,
        alpha: false,
        antialias: false
    });
    threeRenderer.setSize(640, 480);
    threeRenderer.setClearColor(0x000000, 1);

    // Create scene
    threeScene = new THREE.Scene();

    // Create orthographic camera
    threeCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    console.log('✅ Three.js initialized');
}

// Process video frames with Three.js compositing
async function processVideoFrame() {
    if (!segmentationRunning || !bodyPixNet) {
        return;
    }

    // Request next frame first for smooth animation
    if (segmentationRunning) {
        requestAnimationFrame(processVideoFrame);
    }

    try {
        // Get the hidden processing video element
        let processingVideo = document.getElementById('bg-processing-video');
        if (!processingVideo && originalVideoTrack) {
            processingVideo = document.createElement('video');
            processingVideo.id = 'bg-processing-video';
            processingVideo.autoplay = true;
            processingVideo.playsInline = true;
            processingVideo.muted = true;
            processingVideo.style.display = 'none';
            processingVideo.width = 640;
            processingVideo.height = 480;
            processingVideo.srcObject = new MediaStream([originalVideoTrack]);
            document.body.appendChild(processingVideo);

            // Explicitly play the video (autoplay may be blocked)
            try {
                await processingVideo.play();
                console.log('✅ Processing video is now playing');
            } catch (e) {
                console.warn('Could not autoplay processing video:', e);
            }

            await new Promise(resolve => setTimeout(resolve, 200));
        }

        if (!processingVideo || processingVideo.readyState !== processingVideo.HAVE_ENOUGH_DATA) {
            return;
        }

        // Ensure video is playing (not paused)
        if (processingVideo.paused) {
            try {
                await processingVideo.play();
            } catch (e) {
                console.warn('Video paused, trying to play:', e);
            }
        }

        // Handle blur and none modes with simple 2D canvas
        if (currentBackground === 'blur' || currentBackground === 'none') {
            const canvasCtx = backgroundContext;
            canvasCtx.clearRect(0, 0, backgroundCanvas.width, backgroundCanvas.height);
            if (currentBackground === 'blur') {
                canvasCtx.filter = 'blur(10px)';
            }
            canvasCtx.drawImage(processingVideo, 0, 0, backgroundCanvas.width, backgroundCanvas.height);
            canvasCtx.filter = 'none';
            return;
        }

        // Create mask canvas if needed
        if (!maskCanvas) {
            maskCanvas = document.createElement('canvas');
            maskCanvas.width = 640;
            maskCanvas.height = 480;
            maskCtx = maskCanvas.getContext('2d');
        }

        // Throttle segmentation
        frameCount++;
        const shouldSegment = frameCount % 2 === 0;

        if (shouldSegment) {
            // Segment person from background
            const segmentation = await bodyPixNet.segmentPerson(processingVideo, {
                flipHorizontal: false,
                internalResolution: 'medium',
                segmentationThreshold: 0.12  // Lower = include more area
            });

            // Create mask - person is opaque white, background is transparent
            const maskImageData = bodyPix.toMask(segmentation,
                { r: 255, g: 255, b: 255, a: 255 }, // person = opaque white
                { r: 0, g: 0, b: 0, a: 0 },         // background = transparent
                false
            );

            // Create temp canvas for blending if needed
            if (!previousMaskCanvas) {
                previousMaskCanvas = document.createElement('canvas');
                previousMaskCanvas.width = 640;
                previousMaskCanvas.height = 480;
                previousMaskCtx = previousMaskCanvas.getContext('2d');
            }

            // Put new mask data
            maskCtx.putImageData(maskImageData, 0, 0);

            // Expand mask more to cover edge areas
            maskCtx.filter = 'blur(15px) brightness(1.6)';
            maskCtx.drawImage(maskCanvas, 0, 0);
            maskCtx.filter = 'none';

            // Temporal smoothing with more previous frame for stability
            const tempMaskImageData = maskCtx.getImageData(0, 0, 640, 480);
            const prevMaskImageData = previousMaskCtx.getImageData(0, 0, 640, 480);

            // Use 70/30 blend: smoother edges, less flickering
            for (let i = 0; i < tempMaskImageData.data.length; i += 4) {
                const currentAlpha = tempMaskImageData.data[i + 3];
                const previousAlpha = prevMaskImageData.data[i + 3];
                tempMaskImageData.data[i + 3] = currentAlpha * 0.7 + previousAlpha * 0.3;
            }

            maskCtx.putImageData(tempMaskImageData, 0, 0);

            // Store current mask for next frame
            previousMaskCtx.clearRect(0, 0, 640, 480);
            previousMaskCtx.drawImage(maskCanvas, 0, 0);
        }

        // Create temp canvas for masked video
        if (!tempCanvas) {
            tempCanvas = document.createElement('canvas');
            tempCanvas.width = 640;
            tempCanvas.height = 480;
            tempCtx = tempCanvas.getContext('2d', { willReadFrequently: false });
        }

        // Draw video to temp canvas
        tempCtx.clearRect(0, 0, 640, 480);
        tempCtx.drawImage(processingVideo, 0, 0, 640, 480);

        // Apply mask using destination-in (keep only person pixels)
        if (maskCanvas) {
            tempCtx.globalCompositeOperation = 'destination-in';
            tempCtx.drawImage(maskCanvas, 0, 0, 640, 480);
            tempCtx.globalCompositeOperation = 'source-over';
        }

        // Composite on main canvas
        const canvasCtx = backgroundContext;
        canvasCtx.clearRect(0, 0, 640, 480);

        // Draw background
        if (backgroundImage && backgroundImage.complete) {
            canvasCtx.drawImage(backgroundImage, 0, 0, 640, 480);
        } else if (currentBackground === 'gradient') {
            const styles = getComputedStyle(document.documentElement);
            const gradient = canvasCtx.createLinearGradient(0, 0, 640, 480);
            gradient.addColorStop(0, styles.getPropertyValue('--brand-accent').trim() || '#6366f1');
            gradient.addColorStop(1, styles.getPropertyValue('--brand-secondary').trim() || '#8b5cf6');
            canvasCtx.fillStyle = gradient;
            canvasCtx.fillRect(0, 0, 640, 480);
        }

        // Draw masked person on top
        canvasCtx.drawImage(tempCanvas, 0, 0, 640, 480);

    } catch (error) {
        console.error('Error processing frame:', error);
        // On error, just draw the video without effects
        if (backgroundContext) {
            const processingVideo = document.getElementById('bg-processing-video');
            if (processingVideo) {
                backgroundContext.clearRect(0, 0, backgroundCanvas.width, backgroundCanvas.height);
                backgroundContext.drawImage(processingVideo, 0, 0, backgroundCanvas.width, backgroundCanvas.height);
            }
        }
    }
}

// Set background effect
async function setBackground(type) {
    currentBackground = type;
    const localVideo = document.querySelector('#local-participant video');

    if (!localVideo) {
        console.error('Local video not found');
        return;
    }

    const participantDiv = localVideo.parentElement;

    try {
        if (type === 'none') {
            // Stop segmentation and restore original video
            await stopVirtualBackground();
            console.log('✅ Background: None (original)');

        } else if (type === 'blur') {
            // For blur, try simple CSS filter first (faster, works everywhere)
            console.log('Applying simple blur (CSS filter)...');
            await stopVirtualBackground(); // Make sure segmentation is stopped

            // Apply CSS blur
            participantDiv.style.filter = 'blur(5px)';
            localVideo.style.filter = 'blur(5px)';

            console.log('✅ Background: Blur applied (CSS mode)');

        } else {
            // For virtual backgrounds, use BodyPix
            try {
                // Ensure libraries are loaded first (lazy loading)
                if (!virtualBackgroundLibsLoaded) {
                    console.log('Loading virtual background libraries...');
                    const loaded = await loadVirtualBackgroundLibraries();
                    if (!loaded) {
                        throw new Error('Failed to load virtual background libraries');
                    }
                }

                // Initialize BodyPix if needed
                if (!bodyPixNet) {
                    console.log('Loading BodyPix model for first use...');
                    await initializeSegmentation();
                }

                if (!bodyPixNet) {
                    throw new Error('BodyPix not available - using fallback mode');
                }

                // Create canvas if needed
                if (!backgroundCanvas) {
                    backgroundCanvas = document.createElement('canvas');
                    backgroundCanvas.width = 640;
                    backgroundCanvas.height = 480;
                    backgroundContext = backgroundCanvas.getContext('2d');
                    console.log('Canvas created: 640x480');
                }

                // Load background image
                if (type !== 'gradient') {
                    console.log(`Loading background image: ${type}...`);
                    await loadBackgroundImage(type);
                }

                // Start virtual background processing
                console.log('Starting virtual background processing with BodyPix...');
                await startVirtualBackground();

                console.log(`✅ Background: ${type} applied with BodyPix segmentation!`);

            } catch (bgError) {
                console.warn('Virtual background failed, using fallback:', bgError);
                Toast.warning(`Virtual backgrounds require BodyPix library. Using blur as fallback. Error: ${bgError.message}`, 8000);

                // Fallback to blur
                participantDiv.style.filter = 'blur(8px)';
                localVideo.style.filter = 'blur(8px)';
            }
        }

        // Visual feedback
        document.querySelectorAll('.bg-option').forEach(opt => opt.classList.remove('selected'));
        const selectedOption = Array.from(document.querySelectorAll('.bg-option')).find(
            opt => opt.textContent.toLowerCase().includes(type)
        );
        if (selectedOption) {
            selectedOption.classList.add('selected');
        }

        // Update button state
        const bgBtn = document.getElementById('bgBtn');
        if (bgBtn) {
            bgBtn.classList.toggle('active', type !== 'none');
        }

    } catch (error) {
        console.error('Error applying background:', error);
        Toast.error('Failed to apply background effect: ' + error.message);

        // Try to restore original video
        await stopVirtualBackground();
    }
}

// Load background image
async function loadBackgroundImage(backgroundType) {
    const backgrounds = {
        office: 'https://images.unsplash.com/photo-1497366216548-37526070297c?w=1920&h=1080&fit=crop',
        library: 'https://images.unsplash.com/photo-1521587760476-6c12a4b040da?w=1920&h=1080&fit=crop',
        nature: 'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=1920&h=1080&fit=crop',
        beach: 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=1920&h=1080&fit=crop',
        city: 'https://images.unsplash.com/photo-1449824913935-59a10b8d2000?w=1920&h=1080&fit=crop',
    };

    const bgImageUrl = backgrounds[backgroundType];
    if (!bgImageUrl) {
        throw new Error('Unknown background type: ' + backgroundType);
    }

    return new Promise((resolve, reject) => {
        backgroundImage = new Image();
        backgroundImage.crossOrigin = 'anonymous';

        backgroundImage.onload = () => {
            console.log('Background image loaded:', backgroundType);
            resolve();
        };

        backgroundImage.onerror = () => {
            reject(new Error('Failed to load background image'));
        };

        backgroundImage.src = bgImageUrl;
    });
}

// Start virtual background processing
async function startVirtualBackground() {
    if (segmentationRunning) {
        console.log('Virtual background already running');
        return;
    }

    try {
        const localVideo = document.querySelector('#local-participant video');
        if (!localVideo) {
            throw new Error('Local video element not found');
        }

        // Save original camera track and publication if we don't have it
        if (!originalVideoTrack || !originalCameraPublication) {
            console.log('Saving original video track from LiveKit...');

            // Get the original camera publication from LiveKit
            const cameraPublication = Array.from(room.localParticipant.videoTrackPublications.values())
                .find(pub => pub.source === LivekitClient.Track.Source.Camera);

            if (!cameraPublication || !cameraPublication.track) {
                throw new Error('No camera track found in LiveKit');
            }

            // Store the publication and clone the track
            originalCameraPublication = cameraPublication;
            originalVideoTrack = cameraPublication.track.mediaStreamTrack.clone();
            console.log('Original track saved:', originalVideoTrack.id);
        }

        // Wait for canvas to be ready
        if (!backgroundCanvas || !backgroundContext) {
            throw new Error('Canvas not initialized');
        }

        // Start processing flag
        segmentationRunning = true;
        console.log('Starting segmentation processing...');

        // Start frame processing first
        processVideoFrame();

        // Wait for first few frames to process
        await new Promise(resolve => setTimeout(resolve, 800));

        // Create stream from canvas
        virtualBackgroundStream = backgroundCanvas.captureStream(30); // 30 FPS
        const canvasVideoTrack = virtualBackgroundStream.getVideoTracks()[0];
        console.log('Canvas stream created, track ID:', canvasVideoTrack.id);

        // Create a LiveKit LocalVideoTrack from the canvas track
        const localTrack = new LivekitClient.LocalVideoTrack(canvasVideoTrack, 'camera', {
            name: 'camera-with-background'
        });

        // Unpublish the original camera track (if it's still published)
        console.log('Unpublishing original camera track...');
        try {
            // Check if track is still published before unpublishing
            const stillPublished = Array.from(room.localParticipant.videoTrackPublications.values())
                .find(pub => pub.track === originalCameraPublication.track);

            if (stillPublished) {
                await room.localParticipant.unpublishTrack(originalCameraPublication.track);
                console.log('Original track unpublished');
            } else {
                console.log('Original track already unpublished, skipping');
            }
        } catch (unpublishError) {
            console.warn('Could not unpublish original track:', unpublishError);
        }

        // Publish the canvas track as the new camera
        console.log('Publishing canvas track...');
        await room.localParticipant.publishTrack(localTrack);

        // Update local video display
        localVideo.srcObject = new MediaStream([canvasVideoTrack]);

        console.log('✅ Virtual background active and published to LiveKit!');
    } catch (error) {
        console.error('Error starting virtual background:', error);
        segmentationRunning = false;

        // Try to restore original video on error
        if (originalCameraPublication && originalCameraPublication.track) {
            try {
                await room.localParticipant.publishTrack(originalCameraPublication.track);
            } catch (restoreError) {
                console.error('Failed to restore original track:', restoreError);
            }
        }

        throw error;
    }
}

// Stop virtual background processing
async function stopVirtualBackground() {
    console.log('Stopping virtual background...');
    segmentationRunning = false;

    // Clean up hidden processing video
    const processingVideo = document.getElementById('bg-processing-video');
    if (processingVideo) {
        processingVideo.srcObject = null;
        processingVideo.remove();
    }

    // Restore original video
    const localVideo = document.querySelector('#local-participant video');
    const participantDiv = localVideo ? localVideo.parentElement : null;

    // Reset all filters
    if (localVideo) {
        localVideo.style.filter = '';
        localVideo.style.mixBlendMode = '';
        localVideo.style.opacity = '';
    }

    if (participantDiv) {
        participantDiv.style.filter = '';
        participantDiv.style.background = '';
        participantDiv.style.backgroundImage = '';
    }

    // If we have a virtual background track published, replace it with the original
    if (originalCameraPublication && room && room.localParticipant) {
        try {
            console.log('Unpublishing virtual background track...');

            // Find and unpublish the canvas track
            const canvasPublication = Array.from(room.localParticipant.videoTrackPublications.values())
                .find(pub => pub.trackName === 'camera-with-background');

            if (canvasPublication) {
                await room.localParticipant.unpublishTrack(canvasPublication.track);
            }

            // Republish the original camera track
            console.log('Republishing original camera track...');
            await room.localParticipant.publishTrack(originalCameraPublication.track);

            // Update local video display
            if (localVideo && originalCameraPublication.track) {
                localVideo.srcObject = new MediaStream([originalCameraPublication.track.mediaStreamTrack]);
            }

            console.log('✅ Original camera track restored to LiveKit');
        } catch (error) {
            console.error('Error restoring original track:', error);

            // Fallback: just update local display
            if (localVideo && originalVideoTrack) {
                localVideo.srcObject = new MediaStream([originalVideoTrack]);
            }
        }
    } else if (localVideo && originalVideoTrack) {
        // Simple restore if no LiveKit track management needed
        console.log('Restoring original video track (display only)');
        const stream = new MediaStream([originalVideoTrack]);
        localVideo.srcObject = stream;
    }

    console.log('✅ Virtual background stopped, original video restored');
}

// Participants panel management
let isHost = false;
let participantsRefreshInterval = null;

// Toggle participants panel
function toggleParticipantsPanel() {
    const panel = document.getElementById('participantsPanel');
    const isVisible = panel.style.display === 'block';

    if (isVisible) {
        panel.style.display = 'none';
        // Stop refreshing when panel is closed
        if (participantsRefreshInterval) {
            clearInterval(participantsRefreshInterval);
            participantsRefreshInterval = null;
        }
    } else {
        panel.style.display = 'block';
        // Load participants and start auto-refresh
        loadParticipants();
        participantsRefreshInterval = setInterval(loadParticipants, 2000); // Refresh every 2 seconds for better responsiveness
    }
}

// Filter participants by search query
function filterParticipants(searchQuery) {
    const participantItems = document.querySelectorAll('.participant-item');
    const query = searchQuery.toLowerCase().trim();

    let visibleCount = 0;

    participantItems.forEach(item => {
        const nameElement = item.querySelector('.participant-name');
        if (!nameElement) return;

        const participantName = nameElement.textContent.toLowerCase();

        if (participantName.includes(query)) {
            item.style.display = 'flex';
            visibleCount++;
        } else {
            item.style.display = 'none';
        }
    });

    // Update count display
    const countElement = document.getElementById('participantCount');
    if (countElement) {
        // Show filtered count if searching, otherwise show total
        if (query) {
            countElement.textContent = visibleCount;
        } else {
            countElement.textContent = participantItems.length;
        }
    }
}

// Toggle chat sidebar
function toggleChat() {
    const chatSidebar = document.querySelector('.chat-sidebar');
    const chatBtn = document.getElementById('chatBtn');

    chatSidebar.classList.toggle('visible');
    chatBtn.classList.toggle('active');
}

// Toggle settings menu
function toggleSettingsMenu() {
    const settingsMenu = document.getElementById('settingsMenu');
    const settingsBtn = document.getElementById('settingsBtn');

    if (settingsMenu.style.display === 'none' || settingsMenu.style.display === '') {
        settingsMenu.style.display = 'block';
        settingsBtn.classList.add('active');
    } else {
        settingsMenu.style.display = 'none';
        settingsBtn.classList.remove('active');
    }
}

// Close settings menu when clicking outside
document.addEventListener('click', function(event) {
    const settingsMenu = document.getElementById('settingsMenu');
    const settingsBtn = document.getElementById('settingsBtn');

    if (settingsMenu && settingsBtn &&
        settingsMenu.style.display === 'block' &&
        !settingsMenu.contains(event.target) &&
        !settingsBtn.contains(event.target)) {
        settingsMenu.style.display = 'none';
        settingsBtn.classList.remove('active');
    }
});

// Close settings menu after selecting an option
function closeSettingsMenu() {
    const settingsMenu = document.getElementById('settingsMenu');
    const settingsBtn = document.getElementById('settingsBtn');
    if (settingsMenu && settingsBtn) {
        settingsMenu.style.display = 'none';
        settingsBtn.classList.remove('active');
    }
}

// Load participants from API
async function loadParticipants() {
    try {
        let response;

        // Call API differently for guests vs authenticated users
        if (isGuest) {
            // Guests make direct fetch call (backend allows anonymous access)
            const apiResponse = await fetch(`${CONFIG.visionApiBaseUrl}/meetings/${meetingId}/live-participants`);
            response = await apiResponse.json();
        } else {
            // Authenticated users use API client
            response = await api.getLiveParticipants(meetingId);
        }

        if (response && response.participants) {
            isHost = response.isHost;
            const participants = response.participants;

            // Update participant count
            document.getElementById('participantCount').textContent = participants.length;

            // Show/hide host actions
            const hostActions = document.getElementById('hostActions');
            if (isHost) {
                hostActions.style.display = 'block';
            } else {
                hostActions.style.display = 'none';
            }

            // Render participants list
            renderParticipantsList(participants, response.hostUserId);
        }
    } catch (error) {
        console.error('Error loading participants:', error);
    }
}

// Render participants list
function renderParticipantsList(participants, hostUserId) {
    const listContainer = document.getElementById('participantsList');

    if (!participants || participants.length === 0) {
        listContainer.innerHTML = '<p class="text-muted" style="text-align: center; padding: 20px;">No participants</p>';
        return;
    }

    listContainer.innerHTML = '';

    participants.forEach(participant => {
        const isHostParticipant = participant.identity.includes(hostUserId);
        const isCurrentUser = room && participant.identity === room.localParticipant.identity;

        const item = document.createElement('div');
        item.className = 'participant-item' + (isHostParticipant ? ' host' : '');

        // Get initials for avatar
        const initials = participant.name ? participant.name.substring(0, 2).toUpperCase() : '??';

        // Find audio track to check mute status
        const audioTrack = participant.tracks.find(t => t.type === 'AUDIO');
        const isMuted = audioTrack ? audioTrack.muted : false;

        // Status indicators
        const statusHtml = `
            ${isMuted ? '<span class="status-indicator muted">🔇 Muted</span>' : '<span class="status-indicator">🎤 Speaking</span>'}
        `;

        // Host controls (only show for host and not for themselves)
        let controlsHtml = '';
        if (isHost && !isCurrentUser) {
            controlsHtml = `
                <div class="participant-controls">
                    ${!isMuted ? `<button class="participant-control-btn mute" onclick="muteParticipant('${participant.identity}')" title="Mute">🔇</button>` : ''}
                    <button class="participant-control-btn remove" onclick="kickParticipant('${participant.identity}')" title="Remove">🚫</button>
                </div>
            `;
        }

        item.innerHTML = `
            <div class="participant-info">
                <div class="participant-avatar">${initials}</div>
                <div class="participant-details">
                    <div class="participant-name">${participant.name}${isCurrentUser ? ' (You)' : ''}</div>
                    <div class="participant-status">${statusHtml}</div>
                </div>
            </div>
            ${controlsHtml}
        `;

        listContainer.appendChild(item);
    });
}

// Mute a specific participant (host only)
async function muteParticipant(participantIdentity) {
    if (!isHost || !signalRConnection) {
        console.log('Not authorized to mute participants');
        return;
    }

    try {
        // Find the actual LiveKit participant
        const livekitParticipant = room.remoteParticipants.get(participantIdentity);

        if (!livekitParticipant) {
            Toast.error('Cannot mute: Participant not found in the room');
            return;
        }

        // Find the audio track publication
        let audioTrackSid = null;
        livekitParticipant.audioTrackPublications.forEach((publication) => {
            if (publication.kind === 'audio' && publication.trackSid) {
                audioTrackSid = publication.trackSid;
            }
        });

        if (!audioTrackSid) {
            Toast.error('Cannot mute: No audio track found for this participant');
            return;
        }

        await signalRConnection.invoke('MuteParticipant', meetingId, participantIdentity, audioTrackSid);
        console.log(`Muted participant ${participantIdentity}, track: ${audioTrackSid}`);

        // Refresh participants list
        await loadParticipants();
    } catch (error) {
        console.error('Error muting participant:', error);
        Toast.error('Failed to mute participant: ' + error.message);
    }
}

// Mute all participants (host only)
async function muteAllParticipants() {
    if (!isHost || !signalRConnection) {
        console.log('Not authorized to mute all participants');
        return;
    }

    const muteConfirmed = await Confirm.show({
        title: 'Mute All Participants',
        message: 'Are you sure you want to mute all participants?',
        type: 'warning',
        confirmText: 'Mute All',
        cancelText: 'Cancel'
    });
    if (!muteConfirmed) {
        return;
    }

    try {
        await signalRConnection.invoke('MuteAllParticipants', meetingId);
        console.log('Muted all participants');

        // Refresh participants list
        await loadParticipants();
    } catch (error) {
        console.error('Error muting all participants:', error);
        Toast.error('Failed to mute all participants: ' + error.message);
    }
}

// Remove a participant from the meeting (host only)
async function kickParticipant(participantIdentity) {
    if (!isHost || !signalRConnection) {
        console.log('Not authorized to remove participants');
        return;
    }

    // Show confirmation
    const confirmed = await Confirm.show({
        title: 'Remove Participant',
        message: 'Are you sure you want to remove this participant from the meeting?',
        type: 'danger',
        confirmText: 'Remove',
        cancelText: 'Cancel'
    });

    if (!confirmed) {
        return;
    }

    try {
        console.log(`Removing participant ${participantIdentity} from meeting...`);
        await signalRConnection.invoke('RemoveParticipant', meetingId, participantIdentity);
        console.log(`Successfully removed participant ${participantIdentity}`);

        // Refresh participants list after a short delay to allow backend to process
        setTimeout(() => {
            loadParticipants();
        }, 500);
    } catch (error) {
        console.error('Error removing participant:', error);
        Toast.error('Failed to remove participant: ' + error.message);
    }
}

// Initialize on page load
initializeMeeting();

// Clean up on page unload
window.addEventListener('beforeunload', async (e) => {
    // Stop recording if active
    if (isRecording) {
        e.preventDefault();
        e.returnValue = '';
        await stopRecording();
    }

    if (signalRConnection) {
        await signalRConnection.invoke('LeaveMeeting', meetingId);
    }
});
