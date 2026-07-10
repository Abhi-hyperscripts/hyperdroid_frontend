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
// Browser-side STT removed — server-side Vosk bot handles transcription

// Helper function to return to dashboard - closes tab if opened from dashboard, otherwise redirects
function returnToDashboard() {
    if (window.opener) {
        // Opened from dashboard - close this tab
        window.close();
    } else {
        // Direct access - redirect to dashboard
        window.location.href = 'dashboard.html';
    }
}

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
// Safari has issues with track.attach() returning empty - use srcObject directly
function attachVideoTrackSafari(track, videoElement, participantIdentity) {
    const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);

    console.log(`[Safari] Attaching video track for ${participantIdentity}`, {
        hasMediaStreamTrack: !!track.mediaStreamTrack,
        trackKind: track.kind,
        trackEnabled: track.mediaStreamTrack?.enabled,
        trackReadyState: track.mediaStreamTrack?.readyState,
        videoInDOM: document.body.contains(videoElement),
        isSafari: isSafari
    });

    // Add Safari-specific attributes
    videoElement.setAttribute('webkit-playsinline', 'true');
    videoElement.setAttribute('x5-playsinline', 'true');
    videoElement.setAttribute('playsinline', 'true');

    // Ensure video is muted for autoplay
    videoElement.muted = true;

    // Function to play the video with retry logic
    const playVideo = () => {
        if (!videoElement.srcObject) {
            console.warn(`[Safari] No srcObject when trying to play for ${participantIdentity}`);
            return;
        }

        const playPromise = videoElement.play();
        if (playPromise !== undefined) {
            playPromise.then(() => {
                console.log(`[Safari] Video playing successfully for ${participantIdentity}, readyState: ${videoElement.readyState}`);
            }).catch((err) => {
                console.warn(`[Safari] Video autoplay blocked for ${participantIdentity}:`, err.name, err.message);
                // Set up user interaction handlers
                const resumeVideo = () => {
                    videoElement.play().catch(e => console.warn('[Safari] Video play retry failed:', e));
                    document.removeEventListener('click', resumeVideo);
                    document.removeEventListener('touchstart', resumeVideo);
                };
                document.addEventListener('click', resumeVideo, { once: true });
                document.addEventListener('touchstart', resumeVideo, { once: true });
            });
        }
    };

    // Clear any existing srcObject first
    if (videoElement.srcObject) {
        videoElement.srcObject = null;
    }

    // Try multiple attachment methods
    let attached = false;

    // Method 1 (non-Safari): track.attach() — REQUIRED for adaptive streaming.
    // attach() registers the element with the SDK's size/visibility observer, which
    // is how the SFU learns what resolution each tile needs. The old code used
    // direct srcObject for ALL browsers, which left adaptiveStream completely
    // blind: no per-tile layer requests were ever sent, every subscriber pulled
    // the top 1080p layer for every tile, and congestion then crushed quality.
    if (!isSafari) {
        try {
            // If this element was previously attached to a different track
            // (tile reuse), unregister it first so the old track doesn't keep
            // observing a stolen element.
            if (videoElement._lkVideoTrack && videoElement._lkVideoTrack !== track) {
                try { videoElement._lkVideoTrack.detach(videoElement); } catch (err) { /* ignore */ }
            }
            track.attach(videoElement);
            videoElement._lkVideoTrack = track; // for detachTileVideos cleanup
            attached = true;
            console.log(`[Attach] Method 1 (track.attach): attached for ${participantIdentity}`);
        } catch (e) {
            console.warn(`[Attach] track.attach() failed for ${participantIdentity}, falling back to srcObject:`, e);
        }
    }

    // Method 2 (Safari primary / fallback): Direct srcObject assignment.
    // Safari runs with adaptiveStream OFF, so bypassing attach() costs nothing there.
    if (!attached && track.mediaStreamTrack && track.mediaStreamTrack.readyState === 'live') {
        try {
            const mediaStream = new MediaStream([track.mediaStreamTrack]);
            videoElement.srcObject = mediaStream;
            attached = !!videoElement.srcObject;
            console.log(`[Safari] Method 2 (srcObject): attached=${attached} for ${participantIdentity}`);

            // Track the CURRENT element on the track object and register the
            // refresh listeners ONCE per track. Registering fresh closures on
            // every layout rebuild leaked listeners holding destroyed elements
            // (max-listeners warnings + zombie srcObject writes on Safari).
            track._rzSafariEl = videoElement;
            if (track.on && !track._rzSafariListeners) {
                track._rzSafariListeners = true;

                // Listen for track ending (happens during quality switches)
                track.mediaStreamTrack.addEventListener('ended', () => {
                    console.warn(`[Safari] MediaStreamTrack ended for ${participantIdentity}`);
                });

                // CRITICAL: Listen for LiveKit track restarted event (quality change, reconnect)
                track.on('restarted', () => {
                    console.log(`[Safari] Track restarted for ${participantIdentity}, refreshing srcObject`);
                    const el = track._rzSafariEl;
                    if (el && track.mediaStreamTrack && track.mediaStreamTrack.readyState === 'live') {
                        el.srcObject = new MediaStream([track.mediaStreamTrack]);
                        el.play().catch(e => console.warn('[Safari] Play after restart failed:', e));
                    }
                });

                // Also listen for unmuted which happens after quality switches
                track.on('unmuted', () => {
                    console.log(`[Safari] Track unmuted for ${participantIdentity}, ensuring playback`);
                    const el = track._rzSafariEl;
                    if (el && el.paused && el.srcObject) {
                        el.play().catch(e => console.warn('[Safari] Play on unmute failed:', e));
                    }
                });
            }
        } catch (e) {
            console.warn(`[Safari] Method 2 failed for ${participantIdentity}:`, e);
        }
    }

    // Method 3: Use track.attach() as last-resort for Safari
    if (!attached) {
        try {
            const attachedElements = track.attach(videoElement);
            attached = attachedElements && attachedElements.length > 0;
            if (attached) videoElement._lkVideoTrack = track; // for detachTileVideos cleanup
            console.log(`[Safari] Method 3 (track.attach): attached=${attached}, elements=${attachedElements?.length || 0} for ${participantIdentity}`);
        } catch (e) {
            console.warn(`[Safari] Method 3 failed for ${participantIdentity}:`, e);
        }
    }

    // Method 4: Try getting MediaStream from track directly
    if (!attached && track.mediaStream) {
        try {
            videoElement.srcObject = track.mediaStream;
            attached = !!videoElement.srcObject;
            console.log(`[Safari] Method 4 (track.mediaStream): attached=${attached} for ${participantIdentity}`);
        } catch (e) {
            console.warn(`[Safari] Method 4 failed for ${participantIdentity}:`, e);
        }
    }

    if (!attached) {
        console.error(`[Safari] All attachment methods failed for ${participantIdentity}`);
        return;
    }

    // Wait for video to have data, then play
    const onCanPlay = () => {
        console.log(`[Safari] Video canplay event fired for ${participantIdentity}`);
        videoElement.removeEventListener('canplay', onCanPlay);
        playVideo();
    };

    const onLoadedData = () => {
        console.log(`[Safari] Video loadeddata event fired for ${participantIdentity}, videoWidth: ${videoElement.videoWidth}`);
        videoElement.removeEventListener('loadeddata', onLoadedData);
        if (videoElement.paused) {
            playVideo();
        }
    };

    // Listen for video ready events
    videoElement.addEventListener('canplay', onCanPlay);
    videoElement.addEventListener('loadeddata', onLoadedData);

    // If video is already ready, play immediately
    if (videoElement.readyState >= 3) {
        console.log(`[Safari] Video already ready (readyState=${videoElement.readyState}), playing for ${participantIdentity}`);
        playVideo();
    } else {
        // Fallback: try playing after a short delay
        setTimeout(() => {
            if (videoElement.paused && videoElement.srcObject) {
                console.log(`[Safari] Delayed play attempt for ${participantIdentity}, readyState: ${videoElement.readyState}`);
                playVideo();
            }
        }, 500);

        // Second fallback after 2 seconds
        setTimeout(() => {
            if (videoElement.paused && videoElement.srcObject) {
                console.log(`[Safari] Second delayed play attempt for ${participantIdentity}, readyState: ${videoElement.readyState}, videoWidth: ${videoElement.videoWidth}`);
                playVideo();
            }
        }, 2000);
    }

    // Debug: log video element state periodically for the first few seconds
    let debugCount = 0;
    const debugInterval = setInterval(() => {
        debugCount++;
        if (debugCount > 5 || !videoElement.paused) {
            clearInterval(debugInterval);
            return;
        }
        console.log(`[Safari] Debug ${participantIdentity} at ${debugCount}s:`, {
            paused: videoElement.paused,
            readyState: videoElement.readyState,
            videoWidth: videoElement.videoWidth,
            videoHeight: videoElement.videoHeight,
            currentTime: videoElement.currentTime,
            hasSrcObject: !!videoElement.srcObject,
            srcObjectTracks: videoElement.srcObject?.getTracks()?.length || 0
        });
    }, 1000);
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
            returnToDashboard();
            return;
        }

        // Get current user info
        const user = isGuest ? null : api.getUser();
        const isHostUser = user && meetingStatus.host_user_id === user.userId;
        window._isHostUser = !!isHostUser;

        // License enforcement: hide recording button if feature not enabled
        if (typeof isFeatureEnabled === 'function' && !isFeatureEnabled('Vision', 'recording')) {
            const recordBtn = document.getElementById('recordBtn');
            if (recordBtn) {
                recordBtn.setAttribute('style', 'display:none !important');
                console.log('[License] Recording feature not available on current plan');
            }
        }

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

        // Show copilot button for host if ai_support is enabled
        if (isHostUser && meetingStatus.ai_support) {
            const copilotBtn = document.getElementById('copilotBtn');
            if (copilotBtn) {
                copilotBtn.style.display = 'inline-flex';
            }
        }

        // Connect to LiveKit
        await connectToLiveKit(tokenData.ws_url, tokenData.token);

        // Connect to SignalR chat (for both authenticated users and guests)
        await connectToSignalR(participantName);

        // Initialize copilot after SignalR is connected (host-only, ai_support meetings)
        if (isHostUser && meetingStatus.ai_support && signalRConnection) {
            initCopilot(signalRConnection, meetingStatus.meeting_mode, meetingId);
            // Phase 3: recruit-only floating HUD. No-op for sales mode.
            if (typeof initRecruitHud === 'function') {
                initRecruitHud(signalRConnection, meetingStatus.meeting_mode, meetingId);
            }
        }

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
            returnToDashboard();
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

        // Safari detection - Safari has issues with adaptive streaming and simulcast
        const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
        console.log(`[Room] Browser detected: ${isSafari ? 'Safari' : 'Other'}`);

        // Detect mobile / cellular for conservative caps on weak links
        const effectiveType = navigator.connection?.effectiveType || '';
        const isSlowNetwork = effectiveType === '2g' || effectiveType === 'slow-2g' || effectiveType === '3g';
        if (isSlowNetwork) {
            console.warn(`[Room] Slow network detected (${effectiveType}) - capping publish bitrate at 1.5 Mbps`);
        }

        // Resolve max publish bitrate: Safari conservative, slow network conservative, otherwise 6 Mbps.
        const maxPublishBitrate = isSafari ? 2_500_000 : (isSlowNetwork ? 1_500_000 : 6_000_000);

        // Configure RTC options with TURN/STUN servers, simulcast, and audio resilience
        // Safari: Disable adaptive features that cause track subscription issues
        //
        // Quality regime: ONE system manages per-tile resolution.
        //  - Chrome/Edge/Firefox: adaptiveStream. The SDK measures each <video>
        //    element registered via track.attach() and asks the SFU for exactly
        //    the layer that fits it (main speaker -> 1080p, small tile -> 360p).
        //    REQUIRES track.attach() — see attachVideoTrackSafari Method 1.
        //    pixelDensity 'screen' multiplies by devicePixelRatio; without it a
        //    retina MacBook tile requests CSS-pixel sizes = half resolution = blur.
        //  - Safari: adaptiveStream off; manual setVideoQuality via
        //    ActiveSpeakerManager. NOTE: since SDK 2.15 manual setVideoQuality
        //    calls are HONORED even with adaptiveStream on — the
        //    _adaptiveStreamOn guards in activeSpeaker.js are what stop the two
        //    systems from fighting over layers on Chrome. Keep them.
        //    pauseVideoInBackground=false: default (true) server-pauses every
        //    remote video when the tab is hidden, which freezes PiP the moment
        //    the user switches tabs — the main reason PiP exists.
        window._adaptiveStreamOn = !isSafari;
        const roomOptions = {
            adaptiveStream: isSafari ? false : { pixelDensity: 'screen', pauseVideoInBackground: false },
            dynacast: !isSafari,        // Disable for Safari - causes track issues
            videoCaptureDefaults: {
                // Mobile Chrome: VP9 encode is SOFTWARE (libvpx) on most phone
                // SoCs — 1080p x3 SVC layers pegs the CPU and, because the SDK
                // uses 'maintain-resolution' for >=1080p capture, the encoder
                // can only shed fps → 5-10fps judder. 720p capture halves the
                // encode cost AND flips the SDK's per-track degradation
                // default to 'balanced'. Desktops keep 1080p.
                resolution: (isSafari || /Android|iPhone|iPad|Mobi/i.test(navigator.userAgent))
                    ? LivekitClient.VideoPresets.h720.resolution  // Safari + mobile: 720p
                    : LivekitClient.VideoPresets.h1080.resolution,
            },
            // Browser audio preprocessing - helps every participant on every network.
            audioCaptureDefaults: {
                autoGainControl: true,
                noiseSuppression: true,
                echoCancellation: true,
            },
            publishDefaults: {
                simulcast: !isSafari,  // Disable simulcast for Safari - causes layer switching issues
                videoEncoding: {
                    maxBitrate: maxPublishBitrate,
                    maxFramerate: 30,
                },
                // Simulcast ladder. IMPORTANT: the SDK uses only the FIRST TWO
                // presets here (low, mid) + the original capture resolution as the
                // top rung — a third preset is silently dropped. The previous
                // [h180, h360, h720] therefore published 180p/360p/1080p: the 720p
                // tier never existed, so any congestion step-down jumped straight
                // from 1080p to 360p on the main speaker (the "blurry video" bug).
                // Actual rungs now: 360p (~500 kbps) / 720p (~1.7 Mbps) / 1080p.
                videoSimulcastLayers: isSafari ? [] : [
                    LivekitClient.VideoPresets.h360,   // low rung - small tiles + slow viewers
                    LivekitClient.VideoPresets.h720,   // mid rung - the missing tier
                ],
                // Audio resilience for poor networks
                audioPreset: LivekitClient.AudioPresets.speech,  // 24 kbps voice-tuned Opus
                red: true,  // Opus RED packet-loss redundancy - survives 1-2 lost packets
                dtx: true,  // Discontinuous Transmission - saves uplink during silence
                // degradationPreference: DO NOT set here. publishDefaults
                // bleeds into EVERY publish including screen share, where the
                // SDK deliberately forces 'maintain-resolution' (text goes
                // unreadable if resolution drops) — and for >=1080p VP9-SVC
                // camera the SDK's 'maintain-resolution' default works around
                // a Chrome bug that spuriously downscales SVC video claiming
                // bandwidth limits on healthy links. The SDK's per-track
                // defaults are correct; overriding them here broke both.
                //
                // Screen share default cap (8 Mbps). Slow-network override is
                // decided AT SHARE TIME in toggleScreenShare — network state
                // at join time is stale by the time anyone shares.
                screenShareEncoding: {
                    maxBitrate: 8_000_000,
                    maxFramerate: 24,
                },
                // Screen share low rung (VP8/H264 paths only). NOTE: with VP9
                // SVC (Chrome/Edge) the SDK forces screenshare to L1T3 — a
                // single spatial layer — and ignores simulcast layers entirely,
                // so under congestion the SFU can only drop framerate, not
                // resolution. Kept for the non-SVC fallback paths.
                screenShareSimulcastLayers: isSafari ? [] : [
                    LivekitClient.VideoPresets.h720,
                ],
                // VP9: ~30-40% better quality per bit than VP8 (now enabled
                // server-side; previously the server only allowed VP8/H264, so this
                // setting silently fell back to VP8 for everyone). backupCodec keeps
                // a VP8 backup publish for subscribers that can't decode VP9.
                videoCodec: isSafari ? 'vp8' : 'vp9',
                backupCodec: true,
                // Without this, the SDK default (regression) makes ONE
                // VP9-incapable subscriber (old Safari/iOS) drop the WHOLE
                // room to VP8: the publisher stops sending VP9 for everyone.
                // SIMULCAST publishes VP9 + VP8 concurrently instead — capable
                // viewers keep VP9, the legacy viewer gets VP8.
                backupCodecPolicy: LivekitClient.BackupCodecPolicy.SIMULCAST,
            }
        };

        if (isSafari) {
            console.log('[Room] Safari mode: adaptiveStream=OFF, dynacast=OFF, simulcast=OFF, codec=VP8');
        }

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
            // Retarget emotion detector to another remote participant
            if (typeof retargetEmotionDetector === 'function') {
                setTimeout(retargetEmotionDetector, 500);
            }
        });

        room.on('trackSubscribed', (track, publication, participant) => {
            console.log('Track subscribed:', track.kind, 'source:', publication.source);
            attachTrack(track, publication, participant);
            // Retarget emotion detector when a remote video track becomes available
            if (track.kind === 'video' && typeof retargetEmotionDetector === 'function') {
                setTimeout(retargetEmotionDetector, 1000);
            }
        });

        room.on('trackUnsubscribed', (track, publication, participant) => {
            console.log('Track unsubscribed:', track.kind);
            detachTrack(track, publication, participant);

            // Safari: Log video track unsubscription
            // The video codec from Chrome (VP9/H.264 simulcast) is incompatible with Safari
            // This is a known LiveKit issue - server needs VP8 transcoding for Safari clients
            if (isSafari && track.kind === 'video') {
                console.warn(`[Safari] Video track unsubscribed for ${participant.identity} - likely codec incompatibility (VP9→VP8 transcoding needed on server)`);
            }
        });

        // Handle local participant track published (for camera toggle)
        room.on('localTrackPublished', (publication) => {
            console.log('Local track published:', publication.kind, 'source:', publication.source);
            if (!publication.track || publication.kind !== 'video') return;

            // Screen share: show the same big-screen UI remote viewers see — DO NOT
            // overwrite the local camera tile, which is what was happening before.
            if (publication.source === 'screen_share') {
                attachTrack(publication.track, publication, room.localParticipant);
                return;
            }

            if (publication.source === 'camera') {
                const video = document.querySelector('#local-participant video');
                if (video) {
                    attachVideoTrackSafari(publication.track, video, 'local');
                }
                const localDiv = document.getElementById('local-participant');
                if (localDiv) {
                    updateCameraOffPlaceholder(localDiv, true);
                }
            }
        });

        // Handle local participant track unpublished
        room.on('localTrackUnpublished', (publication) => {
            console.log('Local track unpublished:', publication.kind, 'source:', publication.source);
            if (publication.kind !== 'video') return;

            // Screen share ended — tear down via the same path remote-detach uses.
            // Covers both our in-app stop button AND the browser-native "Stop sharing" bar.
            if (publication.source === 'screen_share') {
                if (publication.track) {
                    detachTrack(publication.track, publication, room.localParticipant);
                }
                const screenBtn = document.getElementById('screenBtn');
                if (screenBtn) screenBtn.classList.remove('active');
                return;
            }

            if (publication.source === 'camera') {
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

        // Connection quality reactor: when LOCAL link degrades, downgrade every
        // remote subscription one tier and warn the user. Restore on recovery.
        // This is the missing link that prevents one slow user from requesting
        // layers their downlink can't carry, which was causing freeze-and-thaw cycles.
        let _poorNetworkToastShown = false;
        room.on(LivekitClient.RoomEvent.ConnectionQualityChanged, (quality, participant) => {
            // Only react to LOCAL participant - remote quality is the publisher's, not our downlink.
            if (participant !== room.localParticipant) return;

            const isPoor = quality === LivekitClient.ConnectionQuality.Poor;
            const isLost = quality === LivekitClient.ConnectionQuality.Lost;
            const degraded = isPoor || isLost;

            if (activeSpeakerManager) {
                activeSpeakerManager.setPoorNetworkMode(degraded);
            }

            if (degraded && !_poorNetworkToastShown) {
                _poorNetworkToastShown = true;
                if (typeof showToast === 'function') {
                    showToast('Slow network detected — reducing video quality to keep audio clear', 'warning');
                }
                console.warn(`[Network] Local connection quality: ${quality} - downgrading subscriptions`);
            } else if (!degraded && _poorNetworkToastShown) {
                _poorNetworkToastShown = false;
                if (typeof showToast === 'function') {
                    showToast('Network recovered — restoring video quality', 'success');
                }
                console.log(`[Network] Local connection quality recovered: ${quality}`);
            }
        });

        // ------------------------------------------------------------------
        // Media connection lifecycle — the resilience layer for flaky links.
        // LiveKit auto-reconnects internally (ICE restart / session resume);
        // these handlers give the user feedback while it happens and resync
        // UI state afterwards. Without them a network blip = silently frozen
        // meeting with no indication and no recovery.
        // ------------------------------------------------------------------
        // A quick signal RESUME also emits Reconnected — but media/tracks were
        // never interrupted there, so a full tile rebuild would cause churn on
        // every blip of a flapping network. Only RESTARTS (RoomEvent.Reconnecting)
        // need the full resync.
        let needsFullResync = false;
        room.on(LivekitClient.RoomEvent.SignalReconnecting, () => {
            console.warn('[Media] Signal connection unstable — reconnecting…');
            showConnectionBanner('Connection unstable — reconnecting…', 'warning');
        });
        room.on(LivekitClient.RoomEvent.Reconnecting, () => {
            console.warn('[Media] Media connection lost — reconnecting…');
            needsFullResync = true;
            showConnectionBanner('Connection lost — reconnecting…', 'warning');
        });
        room.on(LivekitClient.RoomEvent.Reconnected, () => {
            showConnectionBanner('Reconnected', 'success', 2500);
            if (!needsFullResync) {
                console.log('[Media] Signal resumed — no resync needed');
                return;
            }
            needsFullResync = false;
            console.log('[Media] Reconnected after restart — resyncing layout and subscriptions');
            // A hard reconnect re-subscribes every track; force a full layout
            // rebuild so tiles re-attach to the live tracks, and re-drive the
            // Safari subscription manager.
            currentLayoutState = { mainSpeakerIdentity: null, smallTileIdentities: [] };
            if (activeSpeakerManager) {
                activeSpeakerManager.updateVideoSubscriptions();
                activeSpeakerManager.notifyLayoutChange();
            }
        });
        room.on(LivekitClient.RoomEvent.Disconnected, (reason) => {
            const R = LivekitClient.DisconnectReason || {};
            // Intentional or separately-handled paths — no overlay
            if (reason === R.CLIENT_INITIATED) return;      // user clicked Leave
            if (reason === R.PARTICIPANT_REMOVED) {
                // The SignalR 'ParticipantRemovedByHost' handler shows the kick
                // toast + redirect — but SignalR may be down on exactly the
                // flaky networks where kicks race disconnects. If we're still
                // on the page after 2s, show a fallback so the user isn't
                // left staring at a frozen meeting.
                hideConnectionBanner();
                setTimeout(() => {
                    showDisconnectedOverlay('You were removed from the meeting by the host.', false);
                }, 2000);
                return;
            }
            if (reason === R.DUPLICATE_IDENTITY) {
                showDisconnectedOverlay('You joined this meeting from another device or tab.', false);
                return;
            }
            if (reason === R.ROOM_DELETED) {
                showDisconnectedOverlay('The meeting has ended.', false);
                return;
            }
            // Genuine connection loss after all automatic reconnect attempts
            console.error('[Media] Disconnected from room, reason:', reason);
            showDisconnectedOverlay('Connection to the meeting was lost.', true);
        });

        // The SFU pauses individual video streams when the downlink can't
        // carry them (congestion control). Show a chip on the affected tile
        // instead of an unexplained frozen frame — audio keeps flowing.
        //
        // NOTE: livekit-client 2.20.1 NEVER emits TrackStreamStateChanged —
        // upstream Room.handleStreamStateUpdate mutates track.streamState
        // BEFORE comparing it, so the changed-guard is always false (broken
        // since ~2.16, still broken on their main). The handler below is kept
        // for whenever the SDK fixes it; the POLL in startStreamStateMonitor()
        // is the path that actually works — track.streamState itself IS
        // updated correctly, only the notification is dead.
        room.on(LivekitClient.RoomEvent.TrackStreamStateChanged, (publication, streamState, participant) => {
            if (publication.kind !== 'video' || publication.source !== 'camera') return;
            const paused = streamState === LivekitClient.Track.StreamState.Paused;
            if (paused) {
                pausedVideoIdentities.add(participant.identity);
            } else {
                pausedVideoIdentities.delete(participant.identity);
            }
            updateLowBandwidthChip(participant.identity, paused);
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
        startStreamStateMonitor();

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

        // Setup keyboard shortcut for unpinning (Escape key)
        setupPinKeyboardShortcuts();

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

        setupSignalREventHandlers();
        wireReconnectHooks(meetingId);
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
        wireReconnectHooks(meetingId);
        await signalRConnection.start();
        await signalRConnection.invoke('JoinMeeting', meetingId);
        console.log('Connected to SignalR hub as authenticated user');
        return;
    }

    throw new Error('No authentication method available');
}

// Round 3 audit fix (D1): wire reconnect handlers so the meeting auto-rejoins
// the SignalR group after a transient network drop. Without these, .withAutomaticReconnect()
// re-establishes the connection but the user is silently absent from the meeting group
// (no chat, captions, hand-raises, recording-status updates) until they refresh.
function wireReconnectHooks(meetingIdToRejoin) {
    if (!signalRConnection) return;

    signalRConnection.onreconnecting((err) => {
        console.warn('[SignalR] Reconnecting…', err ? err.message : '');
        if (typeof Toast !== 'undefined' && Toast && Toast.warning) {
            Toast.warning('Connection lost — reconnecting…', 2500);
        }
    });

    signalRConnection.onreconnected(async (connectionId) => {
        console.log('[SignalR] Reconnected — re-joining meeting group', meetingIdToRejoin, connectionId);
        try {
            await signalRConnection.invoke('JoinMeeting', meetingIdToRejoin);
            if (typeof Toast !== 'undefined' && Toast && Toast.success) {
                Toast.success('Reconnected', 2000);
            }
        } catch (e) {
            console.error('[SignalR] Failed to re-join meeting after reconnect', e);
            if (typeof Toast !== 'undefined' && Toast && Toast.error) {
                Toast.error('Could not rejoin chat — please refresh the page', 5000);
            }
        }
    });

    signalRConnection.onclose((err) => {
        // After all reconnect attempts are exhausted.
        console.error('[SignalR] Connection closed permanently', err);
        if (typeof Toast !== 'undefined' && Toast && Toast.error) {
            Toast.error('Disconnected from chat/captions. Please refresh to reconnect.', 8000);
        }
    });
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
                returnToDashboard();
            }
        } else {
            // Another participant was removed - clean up their UI elements immediately
            console.log(`Removing UI elements for kicked participant: ${data.participantIdentity}`);
            removeParticipant(data.participantIdentity);

            // Show system message
            addChatMessage('System', `${data.participantIdentity} was removed from the meeting by ${data.removedBy}`, 'system');
        }
    });

    // Live captions from server-side Vosk STT (Path A)
    signalRConnection.on('LiveCaptionUpdate', (data) => {
        updateLiveCaption(data.speakerId, data.speakerName, data.text, data.language, data.isFinal, data.timestamp);

        // TTS interrupt logic (mode-aware):
        // - Non-copilot TTS (_ttsActive=false): cancel on any speech
        // - Host browser (earpiece): only cancel on DIFFERENT speaker (avoid earpiece echo)
        // - Non-host browser (autonomous prospect): cancel when anyone speaks,
        //   but add 1s grace period after TTS starts to ignore initial mic echo pickup.
        if (window.speechSynthesis?.speaking) {
            if (!window._ttsActive) {
                window.speechSynthesis.cancel();
            } else if (!window._isHostUser) {
                // Prospect browser in autonomous mode:
                // Host speaks → cancel immediately (host is taking over)
                // Prospect speaks → cancel after 1s grace (ignore early TTS echo from speakers)
                const localId = room?.localParticipant?.identity;
                const ttsAge = Date.now() - (window._ttsStartTime || 0);
                const isLocalSpeaker = localId && data.speakerId === localId;
                if (!isLocalSpeaker || ttsAge > 1000) {
                    window.speechSynthesis.cancel();
                    if (window._ttsResumeInterval) { clearInterval(window._ttsResumeInterval); window._ttsResumeInterval = null; }
                    window._ttsActive = false;
                }
            } else {
                // Host browser in earpiece mode:
                // Only cancel when someone ELSE speaks (not echo from own earpiece)
                const localId = room?.localParticipant?.identity;
                if (localId && data.speakerId !== localId) {
                    window.speechSynthesis.cancel();
                    if (window._ttsResumeInterval) { clearInterval(window._ttsResumeInterval); window._ttsResumeInterval = null; }
                    window._ttsActive = false;
                }
            }
        }
    });

    // Full Autonomous: non-host browsers speak the suggested response via TTS
    signalRConnection.on('CopilotSpeakResponse', (data) => {
        if (window._isHostUser) return; // Host ignores — they see it in the HUD
        if (window.speechSynthesis && data.text) {
            // Generation counter prevents stale onerror from cancelled utterance resetting _ttsActive
            window._ttsGeneration = (window._ttsGeneration || 0) + 1;
            const gen = window._ttsGeneration;

            window.speechSynthesis.cancel();
            if (window._ttsResumeInterval) clearInterval(window._ttsResumeInterval);
            window._ttsActive = true;
            window._ttsStartTime = Date.now();

            // Hide thinking indicator since response arrived
            showThinkingIndicator(false);

            const utterance = new SpeechSynthesisUtterance(data.text);
            utterance.rate = 1.0;
            utterance.volume = 1.0;

            // Chrome bug workaround: speechSynthesis silently stops/pauses after ~15s.
            // resume() every 3s keeps it alive. Don't self-destruct — let onend handle cleanup.
            window._ttsResumeInterval = setInterval(() => {
                if (window.speechSynthesis) window.speechSynthesis.resume();
            }, 3000);

            utterance.onend = () => {
                if (window._ttsGeneration !== gen) return; // stale callback
                clearInterval(window._ttsResumeInterval);
                window._ttsResumeInterval = null;
                setTimeout(() => { window._ttsActive = false; }, 300);
            };
            utterance.onerror = (e) => {
                if (window._ttsGeneration !== gen) return; // stale callback
                if (e.error === 'canceled') return; // expected on cancel() for new utterance
                clearInterval(window._ttsResumeInterval);
                window._ttsResumeInterval = null;
                window._ttsActive = false;
            };
            window.speechSynthesis.speak(utterance);
        }
    });

    // Autonomous "thinking..." indicator for prospect browsers
    signalRConnection.on('CopilotThinking', (data) => {
        if (window._isHostUser) return;
        showThinkingIndicator(data.active);

        // Server-side interrupt: when AI starts processing NEW transcript (active=true),
        // it means someone spoke — cancel in-progress TTS so it doesn't talk over them.
        if (data.active && window.speechSynthesis?.speaking) {
            window.speechSynthesis.cancel();
            if (window._ttsResumeInterval) { clearInterval(window._ttsResumeInterval); window._ttsResumeInterval = null; }
            window._ttsActive = false;
        }
    });

    // Copilot mode changed (sync all clients)
    signalRConnection.on('CopilotModeChanged', (data) => {
        console.log(`[Meeting] Copilot mode: ${data.mode}`);

        // Switching away from autonomous: cancel in-progress TTS on prospect browser
        if (data.mode !== 'autonomous' && !window._isHostUser) {
            if (window.speechSynthesis?.speaking) {
                window.speechSynthesis.cancel();
            }
            if (window._ttsResumeInterval) {
                clearInterval(window._ttsResumeInterval);
                window._ttsResumeInterval = null;
            }
            window._ttsActive = false;
            showThinkingIndicator(false);
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

/**
 * Show/hide the thinking indicator (autonomous mode, non-host only).
 * Auto-hides after 10s safety timeout.
 */
let _thinkingTimeout = null;
let _thinkingShownAt = 0;
const THINKING_MIN_DISPLAY_MS = 800;

function showThinkingIndicator(active) {
    const el = document.getElementById('copilotThinking');
    if (!el) return;

    if (active) {
        el.style.display = 'block';
        _thinkingShownAt = Date.now();
        // Safety timeout: auto-hide after 10s if no response arrives
        clearTimeout(_thinkingTimeout);
        _thinkingTimeout = setTimeout(() => {
            el.style.display = 'none';
        }, 10000);
    } else {
        // Ensure minimum display time so dots are visible even with fast responses
        const elapsed = Date.now() - _thinkingShownAt;
        const remaining = Math.max(0, THINKING_MIN_DISPLAY_MS - elapsed);
        clearTimeout(_thinkingTimeout);
        _thinkingTimeout = setTimeout(() => {
            el.style.display = 'none';
        }, remaining);
    }
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
    video.muted = true; // MUST be muted for Safari autoplay - audio is on separate element
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

    // Attach any existing audio tracks (persistent rail — see ensureParticipantAudio)
    participant.audioTrackPublications.forEach((publication) => {
        if (publication.track && publication.isSubscribed) {
            ensureParticipantAudio(publication.track, participant);
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

    // Remove video tile (detach tracks first so the SDK unregisters the elements)
    const participantDiv = document.getElementById(`participant-${identity}`);
    if (participantDiv) {
        console.log(`Removing video tile for: ${identity}`);
        detachTileVideos(participantDiv);
        participantDiv.remove();
    }

    // Remove audio-only tile if present
    const audioOnlyDiv = document.getElementById(`audio-only-${identity}`);
    if (audioOnlyDiv) {
        console.log(`Removing audio-only tile for: ${identity}`);
        audioOnlyDiv.remove();
    }

    // Remove persistent rail audio — the participant is gone
    removeParticipantAudio(identity);

    // Clean up zoom level tracking
    if (participantZoomLevels[identity]) {
        delete participantZoomLevels[identity];
    }

    // Remove from raised hands tracking
    raisedHands.delete(identity);
    pausedVideoIdentities.delete(identity);

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
            detachTileVideos(tile);
            tile.remove();
            removeParticipantAudio(identity);
        }
    });

    // Also sweep the audio rail for participants who left without their tile
    // ever existing (rail entries are tile-independent)
    const rail = document.getElementById('audioRail');
    if (rail) {
        rail.querySelectorAll('audio').forEach((audio) => {
            const identity = audio.dataset.participantId;
            if (identity && !activeParticipants.has(identity)) {
                console.log(`Cleaning up stale rail audio for: ${identity}`);
                removeParticipantAudio(identity);
            }
        });
    }
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
    smallTileIdentities: [],
    isPinned: false
};

// Update participant layout based on active speaker detection
// OPTIMIZED: Only rebuild when layout actually changes to prevent flickering
function updateParticipantLayout(layout) {
    const videoContainer = document.getElementById('videoContainer');
    const mainSpeaker = layout.mainSpeaker;
    const videoParticipants = layout.videoParticipants || [];
    const isPinned = !!layout.pinnedParticipantSid;

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

    // Check if layout actually changed (including pin state)
    const mainSpeakerChanged = currentLayoutState.mainSpeakerIdentity !== newMainSpeakerIdentity;
    const smallTilesChanged = currentLayoutState.smallTileIdentities.length !== newSmallTileIdentities.length ||
        !currentLayoutState.smallTileIdentities.every((id, i) => id === newSmallTileIdentities[i]);
    const pinStateChanged = currentLayoutState.isPinned !== isPinned;
    const layoutChanged = mainSpeakerChanged || smallTilesChanged || pinStateChanged;

    if (!layoutChanged) {
        // Layout hasn't changed - skip rebuild to prevent flickering
        return;
    }

    // Update current layout state
    currentLayoutState = {
        mainSpeakerIdentity: newMainSpeakerIdentity,
        smallTileIdentities: [...newSmallTileIdentities],
        isPinned: isPinned
    };

    // Capture the doomed tiles' videos NOW, but detach them only AFTER the
    // replacement tiles are attached and observed (see end of function).
    // Detaching first empties the track's element list, which makes
    // adaptiveStream emit an immediate visible=false → the SFU pauses every
    // remote stream on every rebuild (disable/enable churn + keyframe storms
    // precisely at speaker-switch time).
    const doomedVideos = Array.from(videoContainer.querySelectorAll('video'));
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
        addParticipantToContainer(room.localParticipant, mainSpeakerContainer, 'main-speaker-tile', true, false);
    } else {
        const mainParticipant = room.remoteParticipants.get(newMainSpeakerIdentity);
        if (mainParticipant) {
            // Pass isPinned to show the pinned badge on main speaker tile
            addParticipantToContainer(mainParticipant, mainSpeakerContainer, 'main-speaker-tile', false, isPinned);
        }
    }

    // Add small tiles
    newSmallTileIdentities.forEach((identity) => {
        if (identity === 'local') {
            addParticipantToContainer(room.localParticipant, smallTilesContainer, 'small-tile', true, false);
        } else {
            const participant = room.remoteParticipants.get(identity);
            if (participant) {
                addParticipantToContainer(participant, smallTilesContainer, 'small-tile', false, false);
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

    // Deferred detach of the old tiles' videos: by now (150ms) the new
    // elements' IntersectionObserver has fired and reported them visible, so
    // unregistering the old ones never drops the track's visibility to false
    // — no pause/resume signal reaches the SFU. Still prevents the unbounded
    // element/observer leak (each rebuild only ever orphans its own list).
    // The active PiP element is skipped — detaching it kills the PiP feed.
    setTimeout(() => {
        doomedVideos.forEach((el) => {
            if (el === document.pictureInPictureElement) return;
            const t = el._lkVideoTrack;
            if (t) {
                try { t.detach(el); } catch (e) { /* track may already be gone */ }
                el._lkVideoTrack = null;
            }
            if (el.srcObject) el.srcObject = null;
        });
    }, 150);

    // Re-target the copilot emotion detector: it holds a reference to a
    // specific tile <video>, which this rebuild just destroyed. Without this
    // it silently freezes on the dead element and keeps reporting the last
    // emotion forever (interview meetings).
    if (typeof retargetEmotionDetector === 'function') {
        setTimeout(retargetEmotionDetector, 300);
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

// Helper function to create pin button for small tiles
function createPinButton(participantSid, participantIdentity) {
    const pinBtn = document.createElement('button');
    pinBtn.className = 'pin-btn';
    pinBtn.title = `Pin ${participantIdentity} to main view`;
    pinBtn.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="12" y1="17" x2="12" y2="22"></line>
            <path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z"></path>
        </svg>
    `;

    pinBtn.addEventListener('click', (e) => {
        e.stopPropagation(); // Prevent tile click events
        togglePinParticipant(participantSid, participantIdentity);
    });

    return pinBtn;
}

// Helper function to create pinned badge for main speaker tile
function createPinnedBadge() {
    const badge = document.createElement('div');
    badge.className = 'pinned-badge';
    badge.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="12" y1="17" x2="12" y2="22"></line>
            <path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z"></path>
        </svg>
        <span>Pinned</span>
    `;
    badge.title = 'Click or press Escape to unpin';

    badge.addEventListener('click', (e) => {
        e.stopPropagation();
        unpinParticipant();
    });

    return badge;
}

// Toggle pin state for a participant
function togglePinParticipant(participantSid, participantIdentity) {
    if (!activeSpeakerManager) return;

    if (activeSpeakerManager.getPinnedParticipant() === participantSid) {
        // Already pinned - unpin
        activeSpeakerManager.unpinParticipant();
        console.log(`📌 Unpinned ${participantIdentity}`);
    } else {
        // Pin this participant
        activeSpeakerManager.pinParticipant(participantSid);
        console.log(`📌 Pinned ${participantIdentity}`);
    }
}

// Unpin the current pinned participant
function unpinParticipant() {
    if (!activeSpeakerManager) return;
    activeSpeakerManager.unpinParticipant();
}

// Setup keyboard shortcuts for pin functionality
function setupPinKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
        // Escape key to unpin
        if (e.key === 'Escape' && activeSpeakerManager?.isPinned()) {
            console.log('📌 Escape pressed - unpinning');
            unpinParticipant();
        }
    });
}

// Helper function to add participant to a container
function addParticipantToContainer(participant, container, className, isLocal, isPinned = false) {
    const participantDiv = document.createElement('div');
    participantDiv.className = `video-participant ${className}`;
    participantDiv.id = isLocal ? 'local-participant' : `participant-${participant.identity}`;

    // Store participant SID for pin functionality
    if (!isLocal) {
        participantDiv.dataset.participantSid = participant.sid;
    }

    const video = document.createElement('video');
    video.autoplay = true;
    video.muted = true; // MUST be muted for Safari autoplay - audio is on separate element
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

    // Add pin button for small tiles (remote participants only)
    if (className === 'small-tile' && !isLocal) {
        const pinBtn = createPinButton(participant.sid, participant.identity);
        participantDiv.appendChild(pinBtn);
    }

    // Add pinned badge for main speaker tile when pinned
    if (className === 'main-speaker-tile' && isPinned && !isLocal) {
        const pinnedBadge = createPinnedBadge();
        participantDiv.appendChild(pinnedBadge);
    }

    // CRITICAL FOR SAFARI: Add to DOM FIRST, then attach tracks
    // Safari requires video element to be in document before srcObject works properly
    container.appendChild(participantDiv);

    // Check initial video state
    let hasVideo = false;

    // Attach tracks AFTER element is in DOM
    if (isLocal) {
        const localTracks = room.localParticipant.videoTrackPublications;
        localTracks.forEach((publication) => {
            if (publication.track && publication.source === 'camera') {
                // Use Safari-compatible method for local too
                attachVideoTrackSafari(publication.track, video, 'local');
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

        // Audio lives on the persistent rail (idempotent — normally already
        // attached by trackSubscribed), never inside tiles: tiles are
        // destroyed on every layout rebuild and orphaned <audio> elements
        // keep playing outside the DOM, stacking duplicate playback.
        participant.audioTrackPublications.forEach((publication) => {
            if (publication.track && publication.isSubscribed) {
                ensureParticipantAudio(publication.track, participant);
            }
        });
    }

    // Show placeholder if no video
    updateCameraOffPlaceholder(participantDiv, hasVideo);

    // Re-apply the low-bandwidth chip if this participant's stream is
    // currently SFU-paused (tiles are rebuilt on every layout change)
    if (!isLocal && pausedVideoIdentities.has(participant.identity)) {
        updateLowBandwidthChip(participant.identity, true);
    }
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

// ---------------------------------------------------------------------------
// Connection resilience UI — banner, disconnect overlay, low-bandwidth chips
// ---------------------------------------------------------------------------
let connectionBannerTimer = null;
function showConnectionBanner(message, type = 'warning', autoHideMs = 0) {
    let banner = document.getElementById('connectionBanner');
    if (!banner) {
        banner = document.createElement('div');
        banner.id = 'connectionBanner';
        banner.style.cssText = 'position:fixed;top:14px;left:50%;transform:translateX(-50%);z-index:10000;' +
            'padding:8px 18px;border-radius:8px;font-size:14px;font-weight:600;' +
            'box-shadow:0 4px 16px rgba(0,0,0,0.35);pointer-events:none;';
        document.body.appendChild(banner);
    }
    banner.style.background = type === 'success' ? 'var(--color-success)' : 'var(--color-warning)';
    banner.style.color = 'var(--text-inverse, #fff)';
    banner.textContent = message;
    banner.style.display = 'block';
    if (connectionBannerTimer) { clearTimeout(connectionBannerTimer); connectionBannerTimer = null; }
    if (autoHideMs > 0) connectionBannerTimer = setTimeout(hideConnectionBanner, autoHideMs);
}
function hideConnectionBanner() {
    const banner = document.getElementById('connectionBanner');
    if (banner) banner.style.display = 'none';
}

function showDisconnectedOverlay(message, offerRejoin) {
    if (document.getElementById('disconnectedOverlay')) return;
    hideConnectionBanner();
    const overlay = document.createElement('div');
    overlay.id = 'disconnectedOverlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:10001;background:rgba(0,0,0,0.78);' +
        'display:flex;align-items:center;justify-content:center;';
    const card = document.createElement('div');
    card.style.cssText = 'background:var(--bg-card, #1e1e2e);color:var(--text-primary, #fff);' +
        'padding:32px 40px;border-radius:12px;text-align:center;max-width:380px;' +
        'box-shadow:0 8px 32px rgba(0,0,0,0.5);';
    const title = document.createElement('h3');
    title.textContent = offerRejoin ? 'Connection lost' : 'Disconnected';
    title.style.cssText = 'margin:0 0 10px;font-size:18px;';
    const msg = document.createElement('p');
    msg.textContent = message;
    msg.style.cssText = 'margin:0 0 22px;font-size:14px;color:var(--text-secondary, #aaa);';
    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex;gap:10px;justify-content:center;';
    if (offerRejoin) {
        const rejoinBtn = document.createElement('button');
        rejoinBtn.textContent = 'Rejoin meeting';
        rejoinBtn.style.cssText = 'padding:10px 20px;border:none;border-radius:8px;cursor:pointer;' +
            'font-weight:600;background:var(--brand-primary, #6366f1);color:var(--text-inverse, #fff);';
        rejoinBtn.onclick = () => window.location.reload();
        btnRow.appendChild(rejoinBtn);
    }
    const exitBtn = document.createElement('button');
    // Guests have no dashboard — same exit convention as the kick handler
    const overlayIsGuest = sessionStorage.getItem('isGuest') === 'true';
    exitBtn.textContent = overlayIsGuest ? 'Exit meeting' : 'Back to dashboard';
    exitBtn.style.cssText = 'padding:10px 20px;border:1px solid var(--border-color, #444);border-radius:8px;' +
        'cursor:pointer;font-weight:600;background:transparent;color:var(--text-primary, #fff);';
    exitBtn.onclick = () => {
        if (overlayIsGuest) {
            sessionStorage.clear();
            window.location.href = '../login.html';
        } else {
            window.location.href = 'dashboard.html';
        }
    };
    btnRow.appendChild(exitBtn);
    card.appendChild(title);
    card.appendChild(msg);
    card.appendChild(btnRow);
    overlay.appendChild(card);
    document.body.appendChild(overlay);
}

// Identities whose camera stream the SFU has paused for bandwidth — chips
// must survive layout rebuilds, so state lives here and tiles re-apply it.
const pausedVideoIdentities = new Set();

// livekit-client 2.20.1 never emits TrackStreamStateChanged (see handler
// comment), but track.streamState IS kept current — so poll it. 1.5s is
// plenty: SFU pauses last seconds-to-minutes, and the scan is a few dozen
// property reads.
let streamStateMonitorInterval = null;
function startStreamStateMonitor() {
    if (streamStateMonitorInterval) return;
    streamStateMonitorInterval = setInterval(() => {
        if (!room || room.state !== 'connected') return;
        room.remoteParticipants.forEach((p) => {
            p.videoTrackPublications.forEach((pub) => {
                if (pub.source !== 'camera' || !pub.track) return;
                const paused = pub.track.streamState === LivekitClient.Track.StreamState.Paused;
                const wasPaused = pausedVideoIdentities.has(p.identity);
                if (paused === wasPaused) return;
                if (paused) {
                    console.warn(`[Network] SFU paused ${p.identity}'s video (congestion)`);
                    pausedVideoIdentities.add(p.identity);
                } else {
                    console.log(`[Network] SFU resumed ${p.identity}'s video`);
                    pausedVideoIdentities.delete(p.identity);
                }
                updateLowBandwidthChip(p.identity, paused);
            });
        });
    }, 1500);
}
function stopStreamStateMonitor() {
    if (streamStateMonitorInterval) {
        clearInterval(streamStateMonitorInterval);
        streamStateMonitorInterval = null;
    }
}
function updateLowBandwidthChip(identity, paused) {
    const tile = document.getElementById(`participant-${identity}`);
    if (!tile) return;
    let chip = tile.querySelector('.low-bw-chip');
    if (paused) {
        if (!chip) {
            chip = document.createElement('div');
            chip.className = 'low-bw-chip';
            chip.textContent = 'Low bandwidth';
            chip.style.cssText = 'position:absolute;top:8px;left:8px;z-index:5;padding:2px 8px;' +
                'border-radius:6px;font-size:11px;font-weight:600;opacity:0.92;' +
                'background:var(--color-warning);color:var(--text-inverse, #fff);';
            tile.appendChild(chip);
        }
    } else if (chip) {
        chip.remove();
    }
}

// ---------------------------------------------------------------------------
// Persistent audio rail
//
// Remote audio must NOT live inside video tiles: tiles only exist for the
// 1 main + 4 small participants the layout renders, so a 6th participant's
// audio had nothing to attach to (they were inaudible until active-speaker
// promotion). Worse, layout rebuilds recreated tiles without detaching, and
// orphaned <audio> elements keep playing outside the DOM — every
// promote/demote cycle stacked another playback of the same person.
//
// Instead: one hidden <audio> per participant identity in a persistent
// off-layout container, attached once on trackSubscribed, removed only on
// participant disconnect. Tiles are video-only.
// ---------------------------------------------------------------------------
function ensureParticipantAudio(track, participant) {
    let rail = document.getElementById('audioRail');
    if (!rail) {
        rail = document.createElement('div');
        rail.id = 'audioRail';
        rail.style.display = 'none';
        document.body.appendChild(rail);
    }

    // Key by identity + source: a participant can publish TWO audio tracks
    // (microphone + screen_share_audio). The SDK's attach() evicts same-kind
    // tracks from an element's MediaStream, so sharing one element would make
    // tab-audio silently replace the mic.
    const elId = `audio-for-${participant.identity}${railAudioSuffix(track)}`;
    let audio = document.getElementById(elId);
    if (!audio) {
        audio = document.createElement('audio');
        audio.id = elId;
        audio.autoplay = true;
        audio.playsInline = true;
        audio.dataset.participantId = participant.identity;
        rail.appendChild(audio);
    }
    track.attach(audio);

    // Handle mobile Safari autoplay - attempt play with user gesture fallback
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
    return audio;
}

function railAudioSuffix(track) {
    return track && track.source === 'screen_share_audio' ? '-screen' : '';
}

function removeParticipantAudio(identity) {
    const rail = document.getElementById('audioRail');
    if (!rail) return;
    rail.querySelectorAll('audio').forEach((audio) => {
        if (audio.dataset.participantId === identity) {
            try { audio.srcObject = null; } catch (e) { /* ignore */ }
            audio.remove();
        }
    });
}

// Detach LiveKit tracks from every <video> inside a node before it is
// destroyed. Without this the SDK keeps destroyed elements registered in the
// track's attachedElements (adaptiveStream observers, memory) forever —
// layout rebuilds happen on every speaker switch, so this leaked unbounded.
// attachVideoTrackSafari records the owning track on the element.
function detachTileVideos(rootNode) {
    if (!rootNode) return;
    rootNode.querySelectorAll('video').forEach((el) => {
        // Never detach the element currently in Picture-in-Picture — that
        // freezes the PiP window. It gets cleaned up when PiP closes.
        if (el === document.pictureInPictureElement) return;
        const t = el._lkVideoTrack;
        if (t) {
            try { t.detach(el); } catch (e) { /* track may already be gone */ }
            el._lkVideoTrack = null;
        }
        if (el.srcObject) el.srcObject = null;
    });
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

        // Set highest quality for screen share - we want crisp text and details.
        // Only effective when adaptiveStream is off (Safari); with adaptiveStream
        // on, the SDK sizes the layer from the (fullscreen) element — which
        // resolves to the top layer anyway.
        if (!window._adaptiveStreamOn) {
            publication.setVideoQuality(LivekitClient.VideoQuality.HIGH);
            console.log('Screen share quality set to HIGH for best viewing experience');
        }

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

    // Audio is tile-independent: attach to the persistent rail so every
    // participant is audible even when the layout has no tile for them
    // (only 1 main + 4 small tiles exist; a 6th participant used to be
    // silent until active-speaker promotion).
    if (track.kind === 'audio') {
        ensureParticipantAudio(track, participant);
        return;
    }

    const participantDiv = document.getElementById(`participant-${participant.identity}`);
    if (participantDiv) {
        const video = participantDiv.querySelector('video');
        if (video) {
            // Use Safari-compatible method
            attachVideoTrackSafari(track, video, participant.identity);

            // CRITICAL: Update camera-off placeholder visibility after video track is attached
            updateCameraOffPlaceholder(participantDiv, !track.isMuted);
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
                    // Only video reaches this path — audio goes to the
                    // persistent rail above and never needs a tile.
                    const video = retryDiv.querySelector('video');
                    if (video) {
                        // Use Safari-compatible method
                        attachVideoTrackSafari(track, video, participant.identity);
                        console.log(`Video track attached for ${participant.identity} (retry ${retryCount} successful)`);

                        // Update camera-off placeholder visibility
                        updateCameraOffPlaceholder(retryDiv, !track.isMuted);
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
        if (screenShareVideo._lkVideoTrack === track) screenShareVideo._lkVideoTrack = null;
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
            // Re-subscribe cameras that were dropped by the off-screen unsubscribe
            // logic while the share was the focus — otherwise the sharer's own
            // camera tile stays blank until they next speak.
            activeSpeakerManager.updateVideoSubscriptions();
        }
        screenBtn.disabled = false;
        screenBtn.style.opacity = '1';
        screenBtn.style.cursor = 'pointer';

        // Reset zoom and pan
        resetScreenShare();
        return;
    }

    // Audio: detach from the persistent rail element (track replacement on
    // device switch republishes — the rail element is reused by the new track)
    if (track.kind === 'audio') {
        const audio = document.getElementById(`audio-for-${participant.identity}${railAudioSuffix(track)}`);
        if (audio) {
            try { track.detach(audio); } catch (e) { /* ignore */ }
        }
    } else {
        const participantDiv = document.getElementById(`participant-${participant.identity}`);
        if (participantDiv) {
            const video = participantDiv.querySelector('video');
            if (video) {
                track.detach(video);
                if (video._lkVideoTrack === track) video._lkVideoTrack = null;
            }
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
        // Enable screen share with MAXIMUM QUALITY settings for crisp text.
        // Re-check the network at share time (it may have changed mid-call):
        // on a slow link request 1080p instead of 4K — a 4K capture squeezed
        // through a 2.5 Mbps cap is far blurrier than a clean 1080p encode.
        const shareEffType = navigator.connection?.effectiveType || '';
        const slowShareLink = shareEffType === '2g' || shareEffType === 'slow-2g' || shareEffType === '3g';
        await room.localParticipant.setScreenShareEnabled(true, {
            audio: false, // No audio - save bandwidth for video quality
            video: {
                displaySurface: 'monitor', // Prefer full screen capture
            },
            contentHint: 'text', // Optimize encoding for text clarity
            resolution: slowShareLink
                ? { width: 1920, height: 1080 }
                : { width: 3840, height: 2160 },
        }, {
            // Encoding cap decided here, at share time, alongside the capture
            // resolution — both must reflect the CURRENT network, not the one
            // at join. (Publish options override publishDefaults.)
            screenShareEncoding: slowShareLink
                ? { maxBitrate: 2_500_000, maxFramerate: 15 }
                : { maxBitrate: 8_000_000, maxFramerate: 24 },
        });
        screenBtn.classList.add('active');
        console.log(`Screen share started (${slowShareLink ? '1080p / 2.5 Mbps slow-network' : '4K / 8 Mbps'})`);

        // Apply contentHint and log encoding stats
        setTimeout(async () => {
            for (const [_, publication] of room.localParticipant.videoTrackPublications) {
                if (publication.source === 'screen_share' && publication.track) {
                    const mediaStreamTrack = publication.track.mediaStreamTrack;

                    // Set contentHint for text optimization — EXCEPT when the SDK
                    // has set 'motion'. On VP9/AV1 SVC screenshare (Chrome/Edge)
                    // the SDK deliberately forces contentHint='motion' as a
                    // workaround: Chrome's screen-content ('text'/'detail')
                    // encoder path caps SVC at ~5fps and has encoding bugs.
                    // Overwriting it back to 'text' turns every share into a
                    // slideshow for all viewers. 'text' is only correct on the
                    // non-SVC (VP8) paths, where the SDK leaves the hint alone.
                    if (mediaStreamTrack && 'contentHint' in mediaStreamTrack) {
                        if (mediaStreamTrack.contentHint === 'motion') {
                            console.log('Keeping SDK contentHint=motion (VP9 SVC screenshare workaround)');
                        } else {
                            mediaStreamTrack.contentHint = 'text';
                            console.log('Applied contentHint=text to screen share track');
                        }
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
    // License enforcement: block recording if feature not enabled
    if (typeof isFeatureEnabled === 'function' && !isFeatureEnabled('Vision', 'recording')) {
        Toast.warning('Recording is not available on your current plan');
        return;
    }
    if (!isRecording) {
        await startRecording();
    } else {
        await stopRecording();
    }
}

// Store the display stream for cleanup
let displayStream = null;

// Start recording - captures the entire meeting view (all participants)
async function startRecording() {
    try {
        // Use getDisplayMedia to capture the browser tab/window
        // This records exactly what the user sees - all participants in the layout
        const displayMediaOptions = {
            video: {
                displaySurface: 'browser', // Prefer browser tab
                frameRate: 30,
                width: { ideal: 1920 },
                height: { ideal: 1080 }
            },
            audio: true, // Capture system/tab audio
            preferCurrentTab: true, // Chrome 109+: prefer current tab
            selfBrowserSurface: 'include', // Allow selecting current tab
            systemAudio: 'include', // Include system audio if available
            surfaceSwitching: 'exclude' // Don't allow switching during recording
        };

        // Request screen/tab capture
        displayStream = await navigator.mediaDevices.getDisplayMedia(displayMediaOptions);

        // Check if we got video
        const videoTracks = displayStream.getVideoTracks();
        if (videoTracks.length === 0) {
            Toast.error('No video source selected for recording.');
            return;
        }

        // Get meeting audio from all participants
        const audioTracks = [];

        // Add local participant audio
        room.localParticipant.audioTrackPublications.forEach((pub) => {
            if (pub.track && pub.track.mediaStreamTrack) {
                audioTracks.push(pub.track.mediaStreamTrack);
            }
        });

        // Add remote participant audio
        room.remoteParticipants.forEach((participant) => {
            participant.audioTrackPublications.forEach((pub) => {
                if (pub.track && pub.isSubscribed && pub.track.mediaStreamTrack) {
                    audioTracks.push(pub.track.mediaStreamTrack);
                }
            });
        });

        // Combine display video with meeting audio.
        const combinedStream = new MediaStream();
        videoTracks.forEach(track => combinedStream.addTrack(track));

        // Mix every available audio source into a SINGLE track via Web Audio API.
        //
        // Why a mixed single track instead of just adding all source tracks:
        //   1. MediaRecorder encodes only the FIRST audio track in a MediaStream
        //      on most browsers — adding 2+ tracks silently drops everything
        //      after track[0].
        //   2. Chrome tab-audio capture on macOS frequently returns a silent
        //      audio track when the user toggles "Also allow tab audio" on,
        //      which makes the previous "if no display audio, fall back to
        //      meeting audio" condition false even though the resulting
        //      recording has no audible sound.
        //   3. Chrome tab audio doesn't include the local mic anyway (it
        //      captures what the tab PLAYS, not what your mic hears), so even
        //      a working tab-audio track still misses your own voice.
        //
        // Sources mixed:
        //   - Tab audio from getDisplayMedia (catches anything else playing
        //     in the tab — beep sounds, screen shares from others, etc.)
        //   - Local participant mic publication
        //   - Every subscribed remote participant audio publication
        let recordingAudioContext = null;
        let mixedAudioTrack = null;
        try {
            recordingAudioContext = new (window.AudioContext || window.webkitAudioContext)();
            const mixDestination = recordingAudioContext.createMediaStreamDestination();

            const addToMix = (track, label) => {
                if (!track || track.readyState !== 'live') return;
                try {
                    const src = recordingAudioContext.createMediaStreamSource(new MediaStream([track]));
                    src.connect(mixDestination);
                    console.log(`[Recording] Mixed audio source: ${label}`);
                } catch (err) {
                    console.warn(`[Recording] Failed to mix ${label}:`, err);
                }
            };

            displayStream.getAudioTracks().forEach((t, i) => addToMix(t, `tab-audio[${i}]`));
            audioTracks.forEach((t, i) => addToMix(t, `livekit-audio[${i}]`));

            mixedAudioTrack = mixDestination.stream.getAudioTracks()[0] || null;

            // Stash the AudioContext on the recorder scope so stopRecording can close it.
            window._recordingAudioContext = recordingAudioContext;
        } catch (err) {
            console.error('[Recording] Audio mix setup failed, falling back to first available audio track:', err);
        }

        if (mixedAudioTrack) {
            combinedStream.addTrack(mixedAudioTrack);
        } else {
            // Defensive fallback: if Web Audio API is unavailable for any reason,
            // pick whichever single audio track we have (display first, then any LiveKit).
            const fallbackAudio = displayStream.getAudioTracks()[0] || audioTracks[0] || null;
            if (fallbackAudio) {
                combinedStream.addTrack(fallbackAudio);
                console.warn('[Recording] Using fallback single audio track (no mix).');
            } else {
                console.warn('[Recording] No audio sources available — recording will be silent.');
            }
        }

        // Create MediaRecorder
        const options = {
            mimeType: 'video/webm;codecs=vp8,opus',
            videoBitsPerSecond: 4000000 // 4 Mbps for better quality screen recording
        };

        // Fallback to default if codec not supported
        if (!MediaRecorder.isTypeSupported(options.mimeType)) {
            options.mimeType = 'video/webm';
        }

        mediaRecorder = new MediaRecorder(combinedStream, options);
        recordedChunks = [];

        mediaRecorder.ondataavailable = (event) => {
            if (event.data.size > 0) {
                recordedChunks.push(event.data);
            }
        };

        mediaRecorder.onstop = () => {
            downloadRecording();
            // Clean up display stream
            if (displayStream) {
                displayStream.getTracks().forEach(track => track.stop());
                displayStream = null;
            }
        };

        // Handle user stopping the screen share via browser UI
        videoTracks[0].onended = () => {
            if (isRecording) {
                console.log('Screen share stopped by user');
                stopRecording();
            }
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

        Toast.success('Recording started - capturing entire meeting view');
        console.log('Recording started with screen capture');
    } catch (error) {
        console.error('Error starting recording:', error);
        // Clean up any partial streams
        if (displayStream) {
            displayStream.getTracks().forEach(track => track.stop());
            displayStream = null;
        }
        // User cancelled the screen share picker
        if (error.name === 'NotAllowedError' || error.name === 'AbortError') {
            Toast.info('Recording cancelled - no screen selected');
        } else {
            Toast.error('Failed to start recording: ' + error.message);
        }
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

        // Clean up display stream (screen capture)
        if (displayStream) {
            displayStream.getTracks().forEach(track => track.stop());
            displayStream = null;
        }

        // Close the recording AudioContext (created by startRecording for mixing).
        // Without this, the AudioContext lingers and continues consuming audio frames
        // from the LiveKit MediaStreamTracks even after recording stops.
        if (window._recordingAudioContext) {
            try {
                if (window._recordingAudioContext.state !== 'closed') {
                    window._recordingAudioContext.close();
                }
            } catch (err) {
                console.warn('[Recording] Failed to close audio mix context:', err);
            }
            window._recordingAudioContext = null;
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
    // Recruit-HUD pre-leave checklist for interview meetings — checks that
    // mandatory wrap-up items (salary expectations, notice period, candidate
    // questions, next steps) were covered. Returns false if user chose to
    // stay in the meeting; true means proceed (either everything checked or
    // explicit "skip and leave"). No-op outside interview mode.
    if (typeof window.recruitPreLeaveCheck === 'function') {
        try {
            const proceed = await window.recruitPreLeaveCheck();
            if (!proceed) return;
        } catch (_e) { /* never let the checklist block legitimate leaves */ }
    }

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

            // Tell the backend we're leaving FIRST. When the last participant
            // (host or candidate) leaves, Vision tears down the transcription
            // bot, AIEngine ends the session, and the interview report is
            // generated + persisted to HRMS in the background — fire and
            // forget. The recruiter views the report later at HRMS →
            // Recruitment → Job Posting → Candidate → Session Report. NO
            // in-meeting review modal: keeping the host on a "review report"
            // screen while the candidate has already left was confusing UX.
            if (signalRConnection) {
                try { await signalRConnection.invoke('LeaveMeeting', meetingId); } catch (_e) { /* best-effort */ }
            }

            if (signalRConnection) {
                try { await signalRConnection.stop(); } catch (_e) { /* already closing */ }
            }

            if (room) {
                await room.disconnect();
            }

            // Stop stale participant cleanup
            stopStaleParticipantCleanup();

            // Stop participants-panel auto-refresh if it was open
            if (participantsRefreshInterval) {
                clearInterval(participantsRefreshInterval);
                participantsRefreshInterval = null;
            }

            // Stop server-recording overlay timer if it was running
            if (serverRecordingTimerInterval) {
                clearInterval(serverRecordingTimerInterval);
                serverRecordingTimerInterval = null;
            }

            // Clean up live captions
            cleanupLiveCaptions();

            // Clear guest session if guest user
            if (isGuest) {
                sessionStorage.clear();
                window.location.href = '../login.html';
            } else {
                returnToDashboard();
            }
        } catch (error) {
            console.error('Error leaving meeting:', error);

            if (isGuest) {
                sessionStorage.clear();
                window.location.href = '../login.html';
            } else {
                returnToDashboard();
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

// ==========================================
// Device Settings Functions
// ==========================================

// Searchable dropdown instances for device settings
let meetingCameraDropdown = null;
let meetingMicDropdown = null;
let meetingSpeakerDropdown = null;

// Toggle device settings panel
function toggleDeviceSettings() {
    const panel = document.getElementById('deviceSettingsPanel');
    if (!panel) return;

    const isVisible = panel.style.display === 'block';

    if (isVisible) {
        panel.style.display = 'none';
    } else {
        panel.style.display = 'block';
        // Load available devices when opening
        loadMeetingDevices();
    }
}

// Load available devices for the settings panel
async function loadMeetingDevices() {
    try {
        const devices = await navigator.mediaDevices.enumerateDevices();

        // Get current device IDs from LiveKit
        let currentCameraId = '';
        let currentMicId = '';
        let currentSpeakerId = '';

        if (room && room.localParticipant) {
            room.localParticipant.videoTrackPublications.forEach(pub => {
                if (pub.track && pub.source === 'camera') {
                    const settings = pub.track.mediaStreamTrack?.getSettings();
                    if (settings?.deviceId) currentCameraId = settings.deviceId;
                }
            });
            room.localParticipant.audioTrackPublications.forEach(pub => {
                if (pub.track && pub.source === 'microphone') {
                    const settings = pub.track.mediaStreamTrack?.getSettings();
                    if (settings?.deviceId) currentMicId = settings.deviceId;
                }
            });
        }

        // Build options arrays
        const cameraOptions = [];
        const microphoneOptions = [];
        const speakerOptions = [];

        devices.forEach(device => {
            const option = {
                value: device.deviceId,
                label: device.label || `${device.kind} (${device.deviceId.slice(0, 8)}...)`
            };

            if (device.kind === 'videoinput') {
                cameraOptions.push(option);
            } else if (device.kind === 'audioinput') {
                microphoneOptions.push(option);
            } else if (device.kind === 'audiooutput') {
                speakerOptions.push(option);
            }
        });

        // Add fallback options if none detected
        if (cameraOptions.length === 0) {
            cameraOptions.push({ value: '', label: 'No camera detected' });
        }
        if (microphoneOptions.length === 0) {
            microphoneOptions.push({ value: '', label: 'No microphone detected' });
        }
        if (speakerOptions.length === 0) {
            speakerOptions.push({ value: 'default', label: 'Default Speaker' });
        }

        // Check if SearchableDropdown is available
        if (typeof SearchableDropdown === 'undefined') {
            // Fallback to native selects
            populateMeetingNativeSelects(cameraOptions, microphoneOptions, speakerOptions, currentCameraId, currentMicId);
            return;
        }

        // Destroy existing dropdowns if they exist
        if (meetingCameraDropdown) {
            meetingCameraDropdown.destroy();
            meetingCameraDropdown = null;
        }
        if (meetingMicDropdown) {
            meetingMicDropdown.destroy();
            meetingMicDropdown = null;
        }
        if (meetingSpeakerDropdown) {
            meetingSpeakerDropdown.destroy();
            meetingSpeakerDropdown = null;
        }

        // Camera dropdown
        const cameraSelect = document.getElementById('meetingCameraSelect');
        const cameraContainer = cameraSelect.parentElement;
        cameraSelect.style.display = 'none';

        // Remove old dropdown container if exists
        const oldCameraContainer = document.getElementById('meetingCameraDropdownContainer');
        if (oldCameraContainer) oldCameraContainer.remove();

        // Create new dropdown container
        const cameraDropdownContainer = document.createElement('div');
        cameraDropdownContainer.id = 'meetingCameraDropdownContainer';
        cameraDropdownContainer.className = 'searchable-dropdown-wrapper';
        cameraContainer.appendChild(cameraDropdownContainer);

        meetingCameraDropdown = new SearchableDropdown(cameraDropdownContainer, {
            id: 'meetingCameraDropdown',
            options: cameraOptions,
            value: currentCameraId || cameraOptions[0]?.value || '',
            placeholder: 'Select Camera',
            searchPlaceholder: 'Search cameras...',
            compact: true,
            onChange: (value) => {
                if (value) {
                    switchCameraById(value);
                    // Auto-close panel after selection
                    setTimeout(() => {
                        const panel = document.getElementById('deviceSettingsPanel');
                        if (panel) panel.style.display = 'none';
                    }, 300);
                }
            }
        });

        // Microphone dropdown
        const micSelect = document.getElementById('meetingMicSelect');
        const micContainer = micSelect.parentElement;
        micSelect.style.display = 'none';

        const oldMicContainer = document.getElementById('meetingMicDropdownContainer');
        if (oldMicContainer) oldMicContainer.remove();

        const micDropdownContainer = document.createElement('div');
        micDropdownContainer.id = 'meetingMicDropdownContainer';
        micDropdownContainer.className = 'searchable-dropdown-wrapper';
        micContainer.appendChild(micDropdownContainer);

        meetingMicDropdown = new SearchableDropdown(micDropdownContainer, {
            id: 'meetingMicDropdown',
            options: microphoneOptions,
            value: currentMicId || microphoneOptions[0]?.value || '',
            placeholder: 'Select Microphone',
            searchPlaceholder: 'Search microphones...',
            compact: true,
            onChange: (value) => {
                if (value) {
                    switchMicrophoneById(value);
                    // Auto-close panel after selection
                    setTimeout(() => {
                        const panel = document.getElementById('deviceSettingsPanel');
                        if (panel) panel.style.display = 'none';
                    }, 300);
                }
            }
        });

        // Speaker dropdown
        const speakerSelect = document.getElementById('meetingSpeakerSelect');
        const speakerContainer = speakerSelect.parentElement;
        speakerSelect.style.display = 'none';

        const oldSpeakerContainer = document.getElementById('meetingSpeakerDropdownContainer');
        if (oldSpeakerContainer) oldSpeakerContainer.remove();

        const speakerDropdownContainer = document.createElement('div');
        speakerDropdownContainer.id = 'meetingSpeakerDropdownContainer';
        speakerDropdownContainer.className = 'searchable-dropdown-wrapper';
        speakerContainer.appendChild(speakerDropdownContainer);

        meetingSpeakerDropdown = new SearchableDropdown(speakerDropdownContainer, {
            id: 'meetingSpeakerDropdown',
            options: speakerOptions,
            value: currentSpeakerId || speakerOptions[0]?.value || '',
            placeholder: 'Select Speaker',
            searchPlaceholder: 'Search speakers...',
            compact: true,
            onChange: (value) => {
                if (value) {
                    switchSpeakerById(value);
                    // Auto-close panel after selection
                    setTimeout(() => {
                        const panel = document.getElementById('deviceSettingsPanel');
                        if (panel) panel.style.display = 'none';
                    }, 300);
                }
            }
        });

        console.log('Meeting devices loaded with SearchableDropdown:', {
            cameras: cameraOptions.length,
            microphones: microphoneOptions.length,
            speakers: speakerOptions.length
        });
    } catch (error) {
        console.error('Error loading meeting devices:', error);
        Toast.error('Failed to load devices');
    }
}

// Fallback: Populate native selects if SearchableDropdown not available
function populateMeetingNativeSelects(cameraOptions, microphoneOptions, speakerOptions, currentCameraId, currentMicId) {
    const cameraSelect = document.getElementById('meetingCameraSelect');
    const micSelect = document.getElementById('meetingMicSelect');
    const speakerSelect = document.getElementById('meetingSpeakerSelect');

    if (cameraSelect) {
        cameraSelect.innerHTML = '';
        cameraOptions.forEach(opt => {
            const option = document.createElement('option');
            option.value = opt.value;
            option.text = opt.label;
            if (opt.value === currentCameraId) option.selected = true;
            cameraSelect.appendChild(option);
        });
    }

    if (micSelect) {
        micSelect.innerHTML = '';
        microphoneOptions.forEach(opt => {
            const option = document.createElement('option');
            option.value = opt.value;
            option.text = opt.label;
            if (opt.value === currentMicId) option.selected = true;
            micSelect.appendChild(option);
        });
    }

    if (speakerSelect) {
        speakerSelect.innerHTML = '';
        speakerOptions.forEach(opt => {
            const option = document.createElement('option');
            option.value = opt.value;
            option.text = opt.label;
            speakerSelect.appendChild(option);
        });
    }

    console.log('Meeting devices loaded with native selects');
}

// Switch camera during meeting (called from native select)
async function switchCamera() {
    const select = document.getElementById('meetingCameraSelect');
    if (!select) return;
    await switchCameraById(select.value);
}

// Switch camera by device ID (called from SearchableDropdown)
async function switchCameraById(newDeviceId) {
    if (!newDeviceId || !room || !room.localParticipant) return;

    try {
        Toast.info('Switching camera...');

        // Use LiveKit's switchActiveDevice method
        await room.switchActiveDevice('videoinput', newDeviceId);

        Toast.success('Camera switched successfully');
        console.log('Switched camera to:', newDeviceId);
    } catch (error) {
        console.error('Error switching camera:', error);
        Toast.error('Failed to switch camera: ' + error.message);
    }
}

// Switch microphone during meeting (called from native select)
async function switchMicrophone() {
    const select = document.getElementById('meetingMicSelect');
    if (!select) return;
    await switchMicrophoneById(select.value);
}

// Switch microphone by device ID (called from SearchableDropdown)
async function switchMicrophoneById(newDeviceId) {
    if (!newDeviceId || !room || !room.localParticipant) return;

    try {
        Toast.info('Switching microphone...');

        // Use LiveKit's switchActiveDevice method
        await room.switchActiveDevice('audioinput', newDeviceId);

        Toast.success('Microphone switched successfully');
        console.log('Switched microphone to:', newDeviceId);
    } catch (error) {
        console.error('Error switching microphone:', error);
        Toast.error('Failed to switch microphone: ' + error.message);
    }
}

// Switch speaker during meeting (called from native select)
async function switchSpeaker() {
    const select = document.getElementById('meetingSpeakerSelect');
    if (!select) return;
    await switchSpeakerById(select.value);
}

// Switch speaker by device ID (called from SearchableDropdown)
async function switchSpeakerById(newDeviceId) {
    if (!newDeviceId) return;

    try {
        // Switch speaker using LiveKit if available
        if (room && room.switchActiveDevice) {
            await room.switchActiveDevice('audiooutput', newDeviceId);
            Toast.success('Speaker switched successfully');
            console.log('Switched speaker to:', newDeviceId);
        } else {
            // Fallback: Set sinkId on all audio elements
            const audioElements = document.querySelectorAll('audio, video');
            let switched = false;

            for (const el of audioElements) {
                if (typeof el.setSinkId === 'function') {
                    await el.setSinkId(newDeviceId);
                    switched = true;
                }
            }

            if (switched) {
                Toast.success('Speaker switched successfully');
                console.log('Switched speaker to:', newDeviceId);
            } else {
                Toast.warning('Speaker switching not supported in this browser');
            }
        }
    } catch (error) {
        console.error('Error switching speaker:', error);
        Toast.error('Failed to switch speaker: ' + error.message);
    }
}

// Test speaker with a short tone
function testSpeaker() {
    try {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        const audioCtx = new AudioContextClass();

        // Create a simple beep tone
        const oscillator = audioCtx.createOscillator();
        const gainNode = audioCtx.createGain();

        oscillator.connect(gainNode);
        gainNode.connect(audioCtx.destination);

        oscillator.frequency.value = 440; // A4 note
        oscillator.type = 'sine';

        gainNode.gain.setValueAtTime(0.3, audioCtx.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.5);

        oscillator.start(audioCtx.currentTime);
        oscillator.stop(audioCtx.currentTime + 0.5);

        Toast.info('Playing test sound...');

        // Clean up after sound finishes
        setTimeout(() => {
            audioCtx.close();
        }, 600);
    } catch (error) {
        console.error('Error playing test sound:', error);
        Toast.error('Failed to play test sound');
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

        const rawName = participant.name || participant.identity || '';
        const initials = rawName ? rawName.substring(0, 2).toUpperCase() : '??';

        const audioTrack = participant.tracks.find(t => t.type === 'AUDIO');
        const isMuted = audioTrack ? audioTrack.muted : false;

        // Round 3 audit fix (A1): build the row via createElement/textContent
        // instead of template-string innerHTML. A malicious participant whose
        // display name was `<img src=x onerror="…">` (set via the guest-join
        // first_name/last_name fields or via a forged token's `name` claim)
        // would otherwise execute script in the host's browser when the
        // participants panel rendered them. participant.identity is also
        // used in onclick handlers below; data-attributes + event
        // delegation eliminate that injection vector too.

        const info = document.createElement('div');
        info.className = 'participant-info';

        const avatar = document.createElement('div');
        avatar.className = 'participant-avatar';
        avatar.textContent = initials;
        info.appendChild(avatar);

        const details = document.createElement('div');
        details.className = 'participant-details';

        const nameEl = document.createElement('div');
        nameEl.className = 'participant-name';
        nameEl.textContent = rawName + (isCurrentUser ? ' (You)' : '');
        details.appendChild(nameEl);

        const statusEl = document.createElement('div');
        statusEl.className = 'participant-status';
        const statusInner = document.createElement('span');
        statusInner.className = 'status-indicator' + (isMuted ? ' muted' : '');
        statusInner.textContent = isMuted ? '🔇 Muted' : '🎤 Speaking';
        statusEl.appendChild(statusInner);
        details.appendChild(statusEl);

        info.appendChild(details);
        item.appendChild(info);

        if (isHost && !isCurrentUser) {
            const controls = document.createElement('div');
            controls.className = 'participant-controls';

            if (!isMuted) {
                const muteBtn = document.createElement('button');
                muteBtn.className = 'participant-control-btn mute';
                muteBtn.title = 'Mute';
                muteBtn.textContent = '🔇';
                muteBtn.dataset.identity = participant.identity;
                muteBtn.addEventListener('click', () => muteParticipant(muteBtn.dataset.identity));
                controls.appendChild(muteBtn);
            }

            const removeBtn = document.createElement('button');
            removeBtn.className = 'participant-control-btn remove';
            removeBtn.title = 'Remove';
            removeBtn.textContent = '🚫';
            removeBtn.dataset.identity = participant.identity;
            removeBtn.addEventListener('click', () => kickParticipant(removeBtn.dataset.identity));
            controls.appendChild(removeBtn);

            item.appendChild(controls);
        }

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

// ===================== Live Captions (Path A) =====================

let captionsEnabled = false;
const captionSlots = new Map(); // speakerId -> { element, fadeTimer }

function getCaptionsContainer() {
    let container = document.getElementById('liveCaptionsContainer');
    if (!container) {
        container = document.createElement('div');
        container.id = 'liveCaptionsContainer';
        container.className = 'live-captions-container';
        // Insert before meeting-controls so it sits just above the control bar
        const controls = document.querySelector('.meeting-controls');
        if (controls && controls.parentNode) {
            controls.parentNode.insertBefore(container, controls);
        } else {
            document.body.appendChild(container);
        }
    }
    return container;
}

function updateLiveCaption(speakerId, speakerName, text, language, isFinal, timestamp) {
    if (!captionsEnabled) return;

    // Skip own captions — only show other participants' speech
    const localId = room?.localParticipant?.identity;
    if (localId && speakerId === localId) return;

    const container = getCaptionsContainer();
    let slot = captionSlots.get(speakerId);

    if (!slot) {
        // Create new caption slot for this speaker
        const el = document.createElement('div');
        el.className = 'live-caption-slot';
        el.innerHTML = `<span class="caption-speaker">${escapeHtml(speakerName)}</span><span class="caption-text"></span>`;
        container.appendChild(el);
        slot = { element: el, fadeTimer: null };
        captionSlots.set(speakerId, slot);
    }

    // Clear any pending fade timer
    if (slot.fadeTimer) {
        clearTimeout(slot.fadeTimer);
        slot.fadeTimer = null;
    }

    // Update caption text
    const textEl = slot.element.querySelector('.caption-text');
    if (textEl) {
        textEl.textContent = text;
    }

    // Make sure slot is visible
    slot.element.classList.remove('caption-fade-out');
    slot.element.style.display = '';

    // If final, fade out after 4 seconds
    if (isFinal) {
        slot.fadeTimer = setTimeout(() => {
            slot.element.classList.add('caption-fade-out');
            // Remove from DOM after fade animation
            setTimeout(() => {
                if (slot.element.parentNode) {
                    slot.element.parentNode.removeChild(slot.element);
                }
                captionSlots.delete(speakerId);
            }, 500);
        }, 4000);
    }
}

function toggleCaptions() {
    captionsEnabled = !captionsEnabled;
    const btn = document.getElementById('captionsBtn');

    if (captionsEnabled) {
        btn.classList.add('active');
        getCaptionsContainer().style.display = '';
    } else {
        btn.classList.remove('active');
        const container = document.getElementById('liveCaptionsContainer');
        if (container) container.style.display = 'none';
    }
}

function cleanupLiveCaptions() {
    captionSlots.forEach(slot => {
        if (slot.fadeTimer) clearTimeout(slot.fadeTimer);
    });
    captionSlots.clear();
    const container = document.getElementById('liveCaptionsContainer');
    if (container && container.parentNode) {
        container.parentNode.removeChild(container);
    }
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ===================== End Live Captions =====================

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
