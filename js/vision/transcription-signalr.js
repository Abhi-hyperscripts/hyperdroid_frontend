/**
 * Transcription SignalR Integration
 * Sends transcripts to server and receives merged results
 */

class TranscriptionHub {
    constructor(hubConnection) {
        this.hub = hubConnection;  // Existing SignalR connection from meeting.js
        this.meetingId = null;
        this.onMergedTranscript = null;
        this.onSummaryGenerated = null;
        this.syncInterval = null;

        this._setupHandlers();
    }

    /**
     * Setup SignalR event handlers
     */
    _setupHandlers() {
        // Receive merged transcripts (for display in UI)
        this.hub.on('TranscriptReceived', (transcript) => {
            console.log('[TranscriptionHub] Received:', transcript);
            if (this.onMergedTranscript) {
                this.onMergedTranscript(transcript);
            }
        });

        // Receive meeting summary
        this.hub.on('SummaryGenerated', (summary) => {
            console.log('[TranscriptionHub] Summary generated');
            if (this.onSummaryGenerated) {
                this.onSummaryGenerated(summary);
            }
        });

        // Time sync response
        this.hub.on('TimeSync', (serverTime) => {
            const clientTime = Date.now();
            const drift = clientTime - serverTime;
            console.log(`[TranscriptionHub] Time drift: ${drift}ms`);
            // Store drift for timestamp adjustment
            this.timeDrift = drift;
        });
    }

    /**
     * Join transcription for a meeting
     */
    async joinMeeting(meetingId) {
        this.meetingId = meetingId;

        // Get meeting start epoch from server
        const startEpoch = await this.hub.invoke('GetMeetingStartEpoch', meetingId);
        console.log('[TranscriptionHub] Meeting start epoch:', startEpoch);

        // Start periodic time sync (every 30 seconds)
        this.syncInterval = setInterval(() => {
            this.hub.invoke('RequestTimeSync');
        }, 30000);

        return startEpoch;
    }

    /**
     * Send transcript to server
     */
    async sendTranscript(transcript) {
        if (!this.meetingId) {
            console.error('[TranscriptionHub] Not joined to a meeting');
            return;
        }

        // Adjust timestamp for drift if known
        if (this.timeDrift) {
            transcript.startMs -= this.timeDrift;
            transcript.endMs -= this.timeDrift;
        }

        try {
            await this.hub.invoke('SendTranscript', this.meetingId, transcript);
        } catch (e) {
            console.error('[TranscriptionHub] Failed to send transcript:', e);
        }
    }

    /**
     * Request meeting summary generation
     */
    async requestSummary() {
        if (!this.meetingId) return;

        try {
            await this.hub.invoke('GenerateMeetingSummary', this.meetingId);
        } catch (e) {
            console.error('[TranscriptionHub] Failed to request summary:', e);
        }
    }

    /**
     * Get full transcript for meeting
     */
    async getFullTranscript() {
        if (!this.meetingId) return null;

        try {
            return await this.hub.invoke('GetMeetingTranscript', this.meetingId);
        } catch (e) {
            console.error('[TranscriptionHub] Failed to get transcript:', e);
            return null;
        }
    }

    /**
     * Leave meeting transcription
     */
    leaveMeeting() {
        if (this.syncInterval) {
            clearInterval(this.syncInterval);
        }
        this.meetingId = null;
    }
}

window.TranscriptionHub = TranscriptionHub;
