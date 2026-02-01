/**
 * Vision Meeting Transcription Service
 *
 * Architecture:
 * - Each participant transcribes ONLY their own mic locally
 * - Chrome/Edge: Use native Web Speech API (Google STT)
 * - Safari/Firefox: Fall back to Whisper tiny WASM
 * - Batches transcripts locally in IndexedDB
 * - Syncs to server every 2 minutes via SignalR
 * - Perfect speaker attribution (no diarization needed)
 */

class TranscriptionService {
    constructor() {
        this.isRunning = false;
        this.isEnabled = false;
        this.meetingStartEpoch = null;
        this.speakerId = null;
        this.speakerName = null;
        this.speakerEmail = null;
        this.meetingId = null;
        this.recognition = null;
        this.whisperWorker = null;
        this.useNativeSTT = false;
        this.onTranscript = null;
        this.onStateChange = null;
        this.restartTimeout = null;
        this.audioContext = null;
        this.mediaStream = null;
        this.signalRConnection = null;

        // Batching configuration
        this.transcriptBuffer = [];
        this.batchNumber = 0;
        this.syncIntervalMs = 120000;  // 2 minutes
        this.syncTimer = null;
        this.timeDrift = 0;

        // IndexedDB
        this.db = null;
        this.DB_NAME = 'VisionTranscripts';
        this.DB_VERSION = 1;
        this.STORE_NAME = 'transcripts';

        // Whisper WASM chunking
        this.audioBuffer = [];
        this.chunkIntervalMs = 15000;
        this.chunkTimer = null;
    }

    /**
     * Detect if native STT is available
     */
    detectNativeSTT() {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

        if (!SpeechRecognition) {
            console.log('[Transcription] Native STT not available');
            return false;
        }

        try {
            const testRecognition = new SpeechRecognition();
            testRecognition.abort();
            console.log('[Transcription] Native STT available');
            return true;
        } catch (e) {
            console.log('[Transcription] Native STT detection failed:', e);
            return false;
        }
    }

    /**
     * Initialize IndexedDB for local storage
     */
    async _initIndexedDB() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.DB_NAME, this.DB_VERSION);

            request.onerror = () => {
                console.error('[Transcription] IndexedDB error:', request.error);
                reject(request.error);
            };

            request.onsuccess = () => {
                this.db = request.result;
                console.log('[Transcription] IndexedDB initialized');
                resolve();
            };

            request.onupgradeneeded = (event) => {
                const db = event.target.result;

                if (!db.objectStoreNames.contains(this.STORE_NAME)) {
                    const store = db.createObjectStore(this.STORE_NAME, {
                        keyPath: 'id',
                        autoIncrement: true
                    });
                    store.createIndex('meetingId', 'meetingId', { unique: false });
                    store.createIndex('synced', 'synced', { unique: false });
                    console.log('[Transcription] IndexedDB store created');
                }
            };
        });
    }

    /**
     * Initialize transcription service
     */
    async initialize(options) {
        this.speakerId = options.speakerId;
        this.speakerName = options.speakerName;
        this.speakerEmail = options.speakerEmail;
        this.meetingId = options.meetingId;
        this.onTranscript = options.onTranscript;
        this.onStateChange = options.onStateChange;
        this.signalRConnection = options.signalRConnection;
        this.mediaStream = options.mediaStream;

        // Initialize IndexedDB
        await this._initIndexedDB();

        // Get meeting start epoch from server
        if (this.signalRConnection) {
            try {
                this.meetingStartEpoch = await this.signalRConnection.invoke('GetMeetingStartEpoch', this.meetingId);
                console.log('[Transcription] Meeting start epoch:', this.meetingStartEpoch);
            } catch (e) {
                console.warn('[Transcription] Could not get meeting epoch, using local time:', e);
                this.meetingStartEpoch = Date.now();
            }
        } else {
            this.meetingStartEpoch = Date.now();
        }

        // Detect STT engine
        this.useNativeSTT = this.detectNativeSTT();

        if (this.useNativeSTT) {
            this._initNativeSTT();
        }
        // Note: Whisper WASM initialization would go here for Safari/Firefox
        // For now, we'll show a message that transcription is not available

        console.log(`[Transcription] Initialized with ${this.useNativeSTT ? 'Native STT' : 'Whisper WASM (not implemented)'}`);

        return {
            engine: this.useNativeSTT ? 'Native Web Speech API' : 'Whisper WASM',
            available: this.useNativeSTT  // Only native STT is available for now
        };
    }

    /**
     * Initialize Native Web Speech API
     */
    _initNativeSTT() {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        this.recognition = new SpeechRecognition();

        this.recognition.continuous = true;
        this.recognition.interimResults = true;
        this.recognition.lang = 'en-US';
        this.recognition.maxAlternatives = 1;

        this.recognition.onresult = (event) => {
            for (let i = event.resultIndex; i < event.results.length; i++) {
                const result = event.results[i];
                const transcript = result[0].transcript.trim();
                const isFinal = result.isFinal;
                const confidence = result[0].confidence;

                if (transcript && isFinal) {
                    this._handleTranscript(transcript, confidence);
                }
            }
        };

        this.recognition.onerror = (event) => {
            console.error('[Transcription] Native STT error:', event.error);

            if (event.error === 'no-speech' || event.error === 'aborted') {
                this._scheduleRestart();
            } else if (event.error === 'not-allowed') {
                console.error('[Transcription] Microphone access denied');
                this.stop();
                if (this.onStateChange) {
                    this.onStateChange({ enabled: false, error: 'Microphone access denied' });
                }
            }
        };

        this.recognition.onend = () => {
            if (this.isRunning) {
                this._scheduleRestart();
            }
        };
    }

    /**
     * Handle a transcript from STT
     */
    _handleTranscript(text, confidence = null) {
        const now = Date.now();
        const endMs = now - this.meetingStartEpoch;
        const startMs = endMs - 3000;  // Estimate 3 seconds for the utterance

        const segment = {
            id: `${this.speakerId}_${now}`,
            meetingId: this.meetingId,
            speakerId: this.speakerId,
            speakerName: this.speakerName,
            speakerEmail: this.speakerEmail,
            text: this._normalizeText(text),
            startMs: Math.max(0, startMs),
            endMs: endMs,
            confidence: confidence,
            source: 'native',
            language: 'en',
            isFinal: true,
            timestamp: new Date().toISOString(),
            synced: false
        };

        // Add to buffer
        this.transcriptBuffer.push(segment);

        // Save to IndexedDB
        this._saveToIndexedDB(segment);

        // Callback for live display
        if (this.onTranscript) {
            this.onTranscript(segment);
        }

        console.log('[Transcription]', segment.speakerName + ':', segment.text);
    }

    /**
     * Save transcript to IndexedDB
     */
    async _saveToIndexedDB(segment) {
        if (!this.db) return;

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.STORE_NAME], 'readwrite');
            const store = transaction.objectStore(this.STORE_NAME);
            const request = store.add(segment);

            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * Get unsynced transcripts from IndexedDB
     */
    async _getUnsyncedTranscripts() {
        if (!this.db) return [];

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.STORE_NAME], 'readonly');
            const store = transaction.objectStore(this.STORE_NAME);
            const index = store.index('synced');
            const request = index.getAll(IDBKeyRange.only(false));

            request.onsuccess = () => {
                const results = request.result.filter(t => t.meetingId === this.meetingId);
                resolve(results);
            };
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * Mark transcripts as synced in IndexedDB
     */
    async _markAsSynced(ids) {
        if (!this.db || ids.length === 0) return;

        const transaction = this.db.transaction([this.STORE_NAME], 'readwrite');
        const store = transaction.objectStore(this.STORE_NAME);

        for (const id of ids) {
            const request = store.get(id);
            request.onsuccess = () => {
                const record = request.result;
                if (record) {
                    record.synced = true;
                    store.put(record);
                }
            };
        }
    }

    /**
     * Sync transcripts to server
     */
    async _syncToServer() {
        if (!this.signalRConnection) {
            console.log('[Transcription] No SignalR connection, skipping sync');
            return;
        }

        const unsynced = await this._getUnsyncedTranscripts();
        if (unsynced.length === 0) {
            console.log('[Transcription] No unsynced transcripts');
            return;
        }

        this.batchNumber++;

        const batchRequest = {
            meetingId: this.meetingId,
            speakerId: this.speakerId,
            speakerName: this.speakerName,
            speakerEmail: this.speakerEmail,
            segments: unsynced.map(t => ({
                text: t.text,
                startMs: t.startMs,
                endMs: t.endMs,
                confidence: t.confidence,
                source: t.source,
                language: t.language,
                isFinal: t.isFinal
            })),
            batchNumber: this.batchNumber,
            isComplete: false
        };

        try {
            await this.signalRConnection.invoke('SendTranscriptBatch', this.meetingId, batchRequest);
            console.log(`[Transcription] Synced batch #${this.batchNumber} (${unsynced.length} segments)`);

            // Mark as synced
            await this._markAsSynced(unsynced.map(t => t.id));
        } catch (e) {
            console.error('[Transcription] Sync failed:', e);
        }
    }

    /**
     * Normalize text output
     */
    _normalizeText(text) {
        if (!text) return '';

        text = text.trim();
        text = text.charAt(0).toUpperCase() + text.slice(1);

        if (!/[.!?]$/.test(text)) {
            text += '.';
        }

        return text;
    }

    /**
     * Schedule restart of recognition
     */
    _scheduleRestart(delayMs = 1000) {
        if (this.restartTimeout) {
            clearTimeout(this.restartTimeout);
        }

        this.restartTimeout = setTimeout(() => {
            if (this.isRunning && this.useNativeSTT) {
                try {
                    this.recognition.stop();
                } catch (e) {}

                setTimeout(() => {
                    if (this.isRunning) {
                        this._startNativeSTT();
                    }
                }, 100);
            }
        }, delayMs);
    }

    /**
     * Start transcription
     */
    start() {
        if (this.isRunning) return;
        if (!this.useNativeSTT) {
            console.warn('[Transcription] No STT engine available');
            return false;
        }

        this.isRunning = true;
        this.isEnabled = true;

        console.log('[Transcription] Starting...');

        this._startNativeSTT();

        // Start periodic sync
        this.syncTimer = setInterval(() => {
            this._syncToServer();
        }, this.syncIntervalMs);

        if (this.onStateChange) {
            this.onStateChange({ enabled: true });
        }

        return true;
    }

    /**
     * Start Native STT
     */
    _startNativeSTT() {
        try {
            this.recognition.start();
            this._scheduleRestart(60000);  // Restart every 60s to prevent silent failures
        } catch (e) {
            console.error('[Transcription] Failed to start native STT:', e);
        }
    }

    /**
     * Stop transcription
     */
    async stop() {
        this.isRunning = false;
        this.isEnabled = false;

        if (this.restartTimeout) {
            clearTimeout(this.restartTimeout);
        }

        if (this.syncTimer) {
            clearInterval(this.syncTimer);
        }

        if (this.useNativeSTT && this.recognition) {
            try {
                this.recognition.stop();
            } catch (e) {}
        }

        // Final sync
        await this._syncToServer();

        if (this.onStateChange) {
            this.onStateChange({ enabled: false });
        }

        console.log('[Transcription] Stopped');
    }

    /**
     * Get STT engine info
     */
    getEngineInfo() {
        return {
            engine: this.useNativeSTT ? 'Native Web Speech API' : 'Not available',
            available: this.useNativeSTT,
            privacyNote: this.useNativeSTT
                ? 'Audio processed by Google (Chrome) or Microsoft (Edge)'
                : 'Transcription not available in this browser'
        };
    }

    /**
     * Check if transcription is available
     */
    isAvailable() {
        return this.useNativeSTT;
    }

    /**
     * Get current status
     */
    getStatus() {
        return {
            isRunning: this.isRunning,
            isEnabled: this.isEnabled,
            engine: this.useNativeSTT ? 'native' : 'none',
            bufferedCount: this.transcriptBuffer.length,
            batchNumber: this.batchNumber
        };
    }
}

// Export for use in meeting.js
window.TranscriptionService = TranscriptionService;
