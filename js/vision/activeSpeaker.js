/**
 * Active Speaker Detection and Management with Adaptive Video Quality
 * Tracks speaking activity and manages video subscriptions for optimal bandwidth usage
 * Main speaker gets 720p HD, small tiles get 360p SD (reduces egress server recording load)
 */

class ActiveSpeakerManager {
    constructor(room) {
        this.room = room;
        this.activeSpeakers = []; // Array of {participantSid, identity, lastActiveTime, isSpeaking}
        this.maxVideoParticipants = 5; // 1 large + 4 small
        this.speakingThreshold = 0.15; // Audio level threshold for speaking detection
        this.inactivityTimeout = 30000; // 30 seconds - remove from active list after this
        this.mainSpeaker = null; // Currently focused speaker (large tile)

        // Adaptive video quality settings
        // Note: LiveKit supports LOW(180p), MEDIUM(360p), HIGH(720p)
        // Using MEDIUM (360p) for small tiles to reduce egress server load
        this.mainSpeakerQuality = LivekitClient.VideoQuality.HIGH;      // 720p for main speaker
        this.smallTileQuality = LivekitClient.VideoQuality.MEDIUM;      // 360p for small tiles (reduces bandwidth and recording load)

        // Callbacks for UI updates
        this.onLayoutChange = null;
        this.onSpeakerUpdate = null;

        // Setup event listeners
        this.setupEventListeners();

        // DISABLED: Don't remove inactive speakers - keep all participants in the meeting
        // Participants will only be removed when they disconnect
        // this.startCleanupInterval();

        console.log('ActiveSpeakerManager initialized with adaptive quality (Main: 720p, Small: 360p)');
    }

    /**
     * Setup LiveKit event listeners for speaker detection
     */
    setupEventListeners() {
        // Listen for active speaker changes (LiveKit built-in)
        this.room.on('activeSpeakersChanged', (speakers) => {
            console.log('Active speakers changed:', speakers.map(s => s.identity));
            this.handleActiveSpeakersChange(speakers);
        });

        // Listen for audio track published/unpublished
        this.room.on('trackSubscribed', (track, publication, participant) => {
            if (track.kind === 'audio') {
                console.log('Audio track subscribed:', participant.identity);
                this.monitorAudioLevel(track, participant);
            }
        });

        // CRITICAL: Listen for new participants joining
        // When a new participant connects, add them to the layout immediately
        this.room.on('participantConnected', (participant) => {
            console.log('ActiveSpeaker: New participant connected:', participant.identity);
            this.addNewParticipant(participant);
        });

        // When participants disconnect, remove from active list
        this.room.on('participantDisconnected', (participant) => {
            this.removeParticipant(participant.sid);
        });
    }

    /**
     * Handle active speakers change event from LiveKit
     * @param {Array} speakers - Array of active speaker participants
     */
    handleActiveSpeakersChange(speakers) {
        const now = Date.now();

        speakers.forEach(participant => {
            const existingSpeaker = this.activeSpeakers.find(s => s.participantSid === participant.sid);

            if (existingSpeaker) {
                // Update existing speaker
                existingSpeaker.lastActiveTime = now;
                existingSpeaker.isSpeaking = true;
                existingSpeaker.identity = participant.identity;
            } else {
                // Add new speaker
                this.activeSpeakers.push({
                    participantSid: participant.sid,
                    identity: participant.identity,
                    lastActiveTime: now,
                    isSpeaking: true
                });
            }
        });

        // Mark non-speaking participants
        this.activeSpeakers.forEach(speaker => {
            if (!speakers.find(s => s.sid === speaker.participantSid)) {
                speaker.isSpeaking = false;
            }
        });

        // Sort by last active time (most recent first)
        this.sortSpeakers();

        // Update main speaker (most recent active)
        this.updateMainSpeaker();

        // Update video subscriptions based on active speakers
        this.updateVideoSubscriptions();

        // Notify UI to update layout
        this.notifyLayoutChange();
    }

    /**
     * Monitor audio level for more granular speaker detection
     * @param {AudioTrack} audioTrack - The audio track to monitor
     * @param {Participant} participant - The participant
     */
    monitorAudioLevel(audioTrack, participant) {
        // LiveKit provides audio level monitoring
        audioTrack.on('audioLevelChanged', (level) => {
            if (level > this.speakingThreshold) {
                this.updateSpeakerActivity(participant.sid, participant.identity);
            }
        });
    }

    /**
     * Update speaker activity when they speak
     * @param {string} participantSid - Participant SID
     * @param {string} identity - Participant identity/name
     */
    updateSpeakerActivity(participantSid, identity) {
        const now = Date.now();
        const existingSpeaker = this.activeSpeakers.find(s => s.participantSid === participantSid);
        const wasInTop5 = this.getVideoParticipants().some(p => p.participantSid === participantSid);

        if (existingSpeaker) {
            existingSpeaker.lastActiveTime = now;
            existingSpeaker.isSpeaking = true;
        } else {
            this.activeSpeakers.push({
                participantSid,
                identity,
                lastActiveTime: now,
                isSpeaking: true
            });
        }

        this.sortSpeakers();
        const isInTop5 = this.getVideoParticipants().some(p => p.participantSid === participantSid);

        if (!wasInTop5 && isInTop5) {
            console.log(`⬆️ ${identity} moved INTO top 5 video participants`);
        } else if (wasInTop5 && isInTop5) {
            console.log(`🔄 ${identity} spoke (already in top 5)`);
        }

        this.updateMainSpeaker();
        this.updateVideoSubscriptions();
        this.notifyLayoutChange();
    }

    /**
     * Sort speakers by last active time (most recent first)
     */
    sortSpeakers() {
        // CRITICAL: Sort by lastActiveTime, then by identity for deterministic ordering
        // When times are equal (e.g., during initialization), use alphabetical identity as tie-breaker
        this.activeSpeakers.sort((a, b) => {
            const timeDiff = b.lastActiveTime - a.lastActiveTime;
            if (timeDiff !== 0) {
                return timeDiff; // Sort by time (most recent first)
            }
            // Times are equal - use alphabetical identity as deterministic tie-breaker
            return a.identity.localeCompare(b.identity);
        });
    }

    /**
     * Update the main speaker (shown in large tile) and adjust video qualities
     * CRITICAL: Main speaker must ALWAYS have video - never show blank tile
     */
    updateMainSpeaker() {
        const previousMainSpeaker = this.mainSpeaker;
        const currentlySpeaking = this.activeSpeakers.find(s => s.isSpeaking);

        if (currentlySpeaking) {
            // If someone is currently speaking, make them the main speaker
            this.mainSpeaker = currentlySpeaking;
        } else if (this.activeSpeakers.length > 0) {
            // Otherwise, use the most recently active speaker
            this.mainSpeaker = this.activeSpeakers[0];
        } else {
            // CRITICAL: If no active speakers, pick ANY remote participant with video
            // NEVER leave main speaker empty - this would show blank tile
            this.mainSpeaker = this.findFirstParticipantWithVideo();
        }

        // If main speaker changed, update video qualities
        if (previousMainSpeaker?.participantSid !== this.mainSpeaker?.participantSid) {
            console.log('Main speaker changed, updating video qualities');
            this.updateVideoQualitiesOnSpeakerChange(previousMainSpeaker, this.mainSpeaker);
        }

        if (this.onSpeakerUpdate) {
            this.onSpeakerUpdate(this.mainSpeaker);
        }
    }

    /**
     * Find the first remote participant with video track
     * Used as fallback to ensure main speaker tile is never blank
     * DETERMINISTIC: Sorted alphabetically by identity for consistency across clients
     * @returns {Object|null} Speaker object or null if no participants
     */
    findFirstParticipantWithVideo() {
        // CRITICAL: Sort participants alphabetically for deterministic selection
        const sortedParticipants = Array.from(this.room.remoteParticipants.values())
            .sort((a, b) => a.identity.localeCompare(b.identity));

        // Try to find remote participant with video
        for (const participant of sortedParticipants) {
            // Check if participant has video track
            const hasVideo = Array.from(participant.videoTrackPublications.values())
                .some(pub => pub.track && pub.source === LivekitClient.Track.Source.Camera);

            if (hasVideo) {
                return {
                    participantSid: participant.sid,
                    identity: participant.identity,
                    lastActiveTime: Date.now(),
                    isSpeaking: false
                };
            }
        }

        // If no remote participants with video, use first remote participant (alphabetically)
        if (sortedParticipants.length > 0) {
            const firstParticipant = sortedParticipants[0];
            return {
                participantSid: firstParticipant.sid,
                identity: firstParticipant.identity,
                lastActiveTime: Date.now(),
                isSpeaking: false
            };
        }

        // No remote participants at all - return null (will show local participant)
        return null;
    }

    /**
     * Update video subscriptions based on active speakers with adaptive quality
     * Subscribe to top 5 active speakers with appropriate quality levels
     * Main speaker: 720p HD, Small tiles: 360p SD
     */
    updateVideoSubscriptions() {
        const topSpeakers = this.activeSpeakers.slice(0, this.maxVideoParticipants);
        const topSpeakerSids = new Set(topSpeakers.map(s => s.participantSid));
        const mainSpeakerSid = this.mainSpeaker?.participantSid;

        // Iterate through all remote participants
        this.room.remoteParticipants.forEach((participant) => {
            const shouldSubscribe = topSpeakerSids.has(participant.sid);
            const isMainSpeaker = participant.sid === mainSpeakerSid;

            participant.videoTrackPublications.forEach((publication) => {
                // Only manage camera video tracks, not screen shares
                if (publication.source === LivekitClient.Track.Source.Camera) {
                    if (shouldSubscribe && !publication.isSubscribed) {
                        // Subscribe to video with appropriate quality
                        const quality = isMainSpeaker
                            ? this.mainSpeakerQuality
                            : this.smallTileQuality;
                        const qualityLabel = quality === LivekitClient.VideoQuality.HIGH ? '720p' : quality === LivekitClient.VideoQuality.MEDIUM ? '360p' : '180p';
                        const role = isMainSpeaker ? 'MAIN SPEAKER' : 'SMALL TILE';

                        publication.setSubscribed(true);
                        publication.setVideoQuality(quality);
                        console.log(`🎥 [${role}] Subscribed to ${participant.identity} at ${qualityLabel} (quality: ${quality})`);
                    }
                    else if (shouldSubscribe && publication.isSubscribed) {
                        // Update quality if subscription exists
                        const quality = isMainSpeaker
                            ? this.mainSpeakerQuality
                            : this.smallTileQuality;
                        const qualityLabel = quality === LivekitClient.VideoQuality.HIGH ? '720p' : quality === LivekitClient.VideoQuality.MEDIUM ? '360p' : '180p';
                        const role = isMainSpeaker ? 'MAIN SPEAKER' : 'SMALL TILE';

                        publication.setVideoQuality(quality);
                        console.log(`🔄 [${role}] Updated ${participant.identity} to ${qualityLabel} (quality: ${quality})`);
                    }
                    // DISABLED: Don't unsubscribe from inactive speakers - show all participant videos
                    // else if (!shouldSubscribe && publication.isSubscribed) {
                    //     // Unsubscribe from video for inactive speakers
                    //     publication.setSubscribed(false);
                    //     console.log(`Unsubscribed from ${participant.identity}`);
                    // }
                }
            });

            // Always subscribe to audio for all participants
            participant.audioTrackPublications.forEach((publication) => {
                if (!publication.isSubscribed) {
                    publication.setSubscribed(true);
                }
            });
        });
    }

    /**
     * Get list of participants for video display (top 5 active speakers)
     * If total participants ≤ 5, return ALL participants
     * DETERMINISTIC: Always sorted alphabetically by identity for consistency across clients
     * @returns {Array} Array of speaker objects with video
     */
    getVideoParticipants() {
        const totalParticipants = this.room.remoteParticipants.size;

        // If 5 or fewer participants, show video for EVERYONE
        if (totalParticipants <= this.maxVideoParticipants) {
            const allParticipants = [];
            this.room.remoteParticipants.forEach((participant) => {
                allParticipants.push({
                    participantSid: participant.sid,
                    identity: participant.identity
                });
            });

            // CRITICAL: Sort alphabetically by identity for deterministic ordering across all clients
            allParticipants.sort((a, b) => a.identity.localeCompare(b.identity));
            return allParticipants;
        }

        // More than 5 participants - return top 5 active speakers (already sorted by activity)
        return this.activeSpeakers.slice(0, this.maxVideoParticipants);
    }

    /**
     * Get list of audio-only participants (not in top 5)
     * If total participants ≤ 5, return EMPTY array (everyone gets video)
     * DETERMINISTIC: Sorted alphabetically by identity for consistency
     * @returns {Array} Array of participant objects
     */
    getAudioOnlyParticipants() {
        const totalParticipants = this.room.remoteParticipants.size;

        // If 5 or fewer participants, NO audio-only participants (everyone gets video)
        if (totalParticipants <= this.maxVideoParticipants) {
            return [];
        }

        // More than 5 participants - return those not in top 5
        const topSpeakerSids = new Set(
            this.activeSpeakers.slice(0, this.maxVideoParticipants).map(s => s.participantSid)
        );

        const audioOnly = [];
        this.room.remoteParticipants.forEach((participant) => {
            if (!topSpeakerSids.has(participant.sid)) {
                audioOnly.push({
                    participantSid: participant.sid,
                    identity: participant.identity
                });
            }
        });

        // CRITICAL: Sort alphabetically by identity for deterministic ordering across all clients
        audioOnly.sort((a, b) => a.identity.localeCompare(b.identity));

        return audioOnly;
    }

    /**
     * Remove participant from active speakers list
     * @param {string} participantSid - Participant SID to remove
     */
    removeParticipant(participantSid) {
        const index = this.activeSpeakers.findIndex(s => s.participantSid === participantSid);
        if (index !== -1) {
            this.activeSpeakers.splice(index, 1);
            console.log(`Removed participant ${participantSid} from active speakers`);

            this.updateMainSpeaker();
            this.updateVideoSubscriptions();
            this.notifyLayoutChange();
        }
    }

    /**
     * Add a newly connected participant to the active speakers list
     * Called when participantConnected event fires
     * @param {Participant} participant - The participant who just joined
     */
    addNewParticipant(participant) {
        const now = Date.now();

        // Check if participant already exists (shouldn't happen, but be safe)
        const existing = this.activeSpeakers.find(s => s.participantSid === participant.sid);
        if (existing) {
            console.log(`Participant ${participant.identity} already in active speakers`);
            return;
        }

        // Add new participant to active speakers
        this.activeSpeakers.push({
            participantSid: participant.sid,
            identity: participant.identity,
            lastActiveTime: now,
            isSpeaking: false
        });

        console.log(`Added new participant ${participant.identity} to active speakers`);

        // Sort speakers to maintain deterministic order
        this.sortSpeakers();

        // Update main speaker (may change if this is first participant)
        this.updateMainSpeaker();

        // Update video subscriptions
        this.updateVideoSubscriptions();

        // Trigger layout update for all clients
        this.notifyLayoutChange();
    }

    /**
     * Start periodic cleanup of inactive speakers
     */
    startCleanupInterval() {
        setInterval(() => {
            const now = Date.now();
            const initialCount = this.activeSpeakers.length;

            // Remove speakers inactive for more than timeout period
            this.activeSpeakers = this.activeSpeakers.filter(speaker => {
                const inactive = now - speaker.lastActiveTime > this.inactivityTimeout;
                if (inactive) {
                    console.log(`Removing inactive speaker: ${speaker.identity}`);
                }
                return !inactive;
            });

            if (this.activeSpeakers.length !== initialCount) {
                this.updateMainSpeaker();
                this.updateVideoSubscriptions();
                this.notifyLayoutChange();
            }
        }, 5000); // Check every 5 seconds
    }

    /**
     * Notify UI of layout changes
     */
    notifyLayoutChange() {
        if (this.onLayoutChange) {
            const videoParticipants = this.getVideoParticipants();
            const audioOnlyParticipants = this.getAudioOnlyParticipants();

            // Log the current top 5 ranking
            console.log('🏆 Top 5 Video Participants (LRU):', videoParticipants.map((p, i) =>
                `${i + 1}. ${p.identity}`
            ));

            if (audioOnlyParticipants.length > 0) {
                console.log('🔇 Audio-Only Participants:', audioOnlyParticipants.map(p => p.identity));
            }

            this.onLayoutChange({
                mainSpeaker: this.mainSpeaker,
                videoParticipants: videoParticipants,
                audioOnlyParticipants: audioOnlyParticipants
            });
        }
    }

    /**
     * Get current layout state
     * @returns {Object} Current layout configuration
     */
    getCurrentLayout() {
        return {
            mainSpeaker: this.mainSpeaker,
            videoParticipants: this.getVideoParticipants(),
            audioOnlyParticipants: this.getAudioOnlyParticipants(),
            totalParticipants: this.room.remoteParticipants.size + 1 // +1 for local
        };
    }

    /**
     * Update video qualities when main speaker changes
     * @param {Object} previousMain - Previous main speaker
     * @param {Object} newMain - New main speaker
     */
    updateVideoQualitiesOnSpeakerChange(previousMain, newMain) {
        // Downgrade previous main speaker to medium quality (360p)
        if (previousMain) {
            const prevParticipant = this.room.remoteParticipants.get(previousMain.participantSid);
            if (prevParticipant) {
                prevParticipant.videoTrackPublications.forEach((publication) => {
                    if (publication.source === LivekitClient.Track.Source.Camera && publication.isSubscribed) {
                        publication.setVideoQuality(this.smallTileQuality);
                        console.log(`Downgraded ${previousMain.identity} to ${this.smallTileQuality} (360p)`);
                    }
                });
            }
        }

        // Upgrade new main speaker to high quality (720p)
        if (newMain) {
            const newParticipant = this.room.remoteParticipants.get(newMain.participantSid);
            if (newParticipant) {
                newParticipant.videoTrackPublications.forEach((publication) => {
                    if (publication.source === LivekitClient.Track.Source.Camera && publication.isSubscribed) {
                        publication.setVideoQuality(this.mainSpeakerQuality);
                        console.log(`Upgraded ${newMain.identity} to ${this.mainSpeakerQuality} (720p)`);
                    }
                });
            }
        }
    }

    /**
     * Set quality levels for main speaker and small tiles
     * @param {VideoQuality} mainQuality - Quality for main speaker (HIGH=720p, MEDIUM=360p, LOW=180p)
     * @param {VideoQuality} smallQuality - Quality for small tiles
     */
    setQualityLevels(mainQuality, smallQuality) {
        this.mainSpeakerQuality = mainQuality;
        this.smallTileQuality = smallQuality;

        // Re-apply qualities to all subscribed participants
        this.updateVideoSubscriptions();

        console.log(`Quality levels updated: Main=${mainQuality}, Small=${smallQuality}`);
    }

    /**
     * Force a participant to be the main speaker
     * @param {string} participantSid - Participant SID
     */
    setMainSpeaker(participantSid) {
        const speaker = this.activeSpeakers.find(s => s.participantSid === participantSid);
        if (speaker) {
            this.mainSpeaker = speaker;
            this.notifyLayoutChange();
        }
    }

    /**
     * Add initial participants when joining
     * DETERMINISTIC: Sorts participants alphabetically by identity for consistency
     */
    initializeActiveSpeakers() {
        const now = Date.now();

        // CRITICAL: Sort participants alphabetically before adding to ensure deterministic order
        const sortedParticipants = Array.from(this.room.remoteParticipants.values())
            .sort((a, b) => a.identity.localeCompare(b.identity));

        // Add all current participants to active speakers initially (in sorted order)
        sortedParticipants.forEach((participant) => {
            this.activeSpeakers.push({
                participantSid: participant.sid,
                identity: participant.identity,
                lastActiveTime: now,
                isSpeaking: false
            });
        });

        this.sortSpeakers();
        this.updateMainSpeaker();
        this.updateVideoSubscriptions();
        this.notifyLayoutChange();

        console.log('Initialized active speakers:', this.activeSpeakers.length);
    }
}
