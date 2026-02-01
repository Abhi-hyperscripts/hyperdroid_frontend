/**
 * Vision Meeting Transcription Service
 *
 * Architecture:
 * - Each participant transcribes ONLY their own mic locally
 * - Chrome/Edge: Use native Web Speech API (Google STT)
 * - Safari/Firefox: Fall back to Whisper WASM via transformers.js
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
        this.useNativeSTT = false;
        this.useWhisper = false;
        this.onTranscript = null;
        this.onStateChange = null;
        this.onLoadProgress = null;
        this.restartTimeout = null;
        this.signalRConnection = null;

        // Whisper WASM
        this.whisperPipeline = null;
        this.whisperLoading = false;
        this.whisperReady = false;
        this.audioContext = null;
        this.mediaStream = null;
        this.mediaRecorder = null;
        this.audioChunks = [];
        this.chunkIntervalMs = 10000; // 10 second chunks for Whisper
        this.chunkTimer = null;
        this.processingChunk = false;

        // Batching configuration
        this.transcriptBuffer = [];
        this.batchNumber = 0;
        this.syncIntervalMs = 120000;  // 2 minutes
        this.syncTimer = null;

        // IndexedDB
        this.db = null;
        this.DB_NAME = 'VisionTranscripts';
        this.DB_VERSION = 1;
        this.STORE_NAME = 'transcripts';
    }

    /**
     * Detect if native STT is available (Chrome/Edge)
     */
    detectNativeSTT() {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

        if (!SpeechRecognition) {
            console.log('[Transcription] Native STT not available');
            return false;
        }

        // Check if it's actually working (Safari has the API but it doesn't work)
        const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
        const isFirefox = navigator.userAgent.toLowerCase().includes('firefox');

        if (isSafari || isFirefox) {
            console.log('[Transcription] Safari/Firefox detected - will use Whisper WASM');
            return false;
        }

        try {
            const testRecognition = new SpeechRecognition();
            testRecognition.abort();
            console.log('[Transcription] Native STT available (Chrome/Edge)');
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
        this.onLoadProgress = options.onLoadProgress;
        this.signalRConnection = options.signalRConnection;

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
            console.log('[Transcription] Initialized with Native Web Speech API');
            return {
                engine: 'Native Web Speech API',
                available: true
            };
        } else {
            // Will use Whisper WASM
            this.useWhisper = true;
            console.log('[Transcription] Will use Whisper WASM (whisper-base multilingual)');
            return {
                engine: 'Whisper WASM',
                available: true,
                requiresLoading: true
            };
        }
    }

    /**
     * Load Whisper model from Hugging Face CDN via transformers.js
     */
    async _loadWhisperModel() {
        if (this.whisperReady || this.whisperLoading) {
            return this.whisperReady;
        }

        this.whisperLoading = true;
        console.log('[Transcription] Loading Whisper model...');

        if (this.onStateChange) {
            this.onStateChange({ loading: true, progress: 0, message: 'Loading transcription model...' });
        }

        try {
            // Dynamically import transformers.js from CDN
            const { pipeline } = await import('https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2');

            // Create the automatic speech recognition pipeline
            this.whisperPipeline = await pipeline(
                'automatic-speech-recognition',
                'Xenova/whisper-base',
                {
                    progress_callback: (progress) => {
                        if (progress.status === 'progress' && progress.progress) {
                            const percent = Math.round(progress.progress);
                            console.log(`[Transcription] Loading model: ${percent}%`);
                            if (this.onStateChange) {
                                this.onStateChange({
                                    loading: true,
                                    progress: percent,
                                    message: `Downloading transcription model... ${percent}%`
                                });
                            }
                            if (this.onLoadProgress) {
                                this.onLoadProgress(percent);
                            }
                        }
                    }
                }
            );

            this.whisperReady = true;
            this.whisperLoading = false;
            console.log('[Transcription] Whisper model loaded successfully');

            if (this.onStateChange) {
                this.onStateChange({ loading: false, ready: true, message: 'Transcription ready' });
            }

            return true;
        } catch (error) {
            this.whisperLoading = false;
            console.error('[Transcription] Failed to load Whisper model:', error);

            if (this.onStateChange) {
                this.onStateChange({ loading: false, error: error.message });
            }

            return false;
        }
    }

    /**
     * Initialize audio capture for Whisper
     */
    async _initWhisperAudio() {
        try {
            // Get microphone access
            this.mediaStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    sampleRate: 16000
                }
            });

            // Create AudioContext for processing
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)({
                sampleRate: 16000
            });

            console.log('[Transcription] Audio capture initialized for Whisper');
            return true;
        } catch (error) {
            console.error('[Transcription] Failed to initialize audio:', error);
            return false;
        }
    }

    /**
     * Start recording audio chunks for Whisper
     */
    _startWhisperRecording() {
        if (!this.mediaStream) {
            console.error('[Transcription] No media stream available');
            return;
        }

        // Use MediaRecorder to capture audio chunks
        const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
            ? 'audio/webm;codecs=opus'
            : 'audio/webm';

        this.mediaRecorder = new MediaRecorder(this.mediaStream, { mimeType });
        this.audioChunks = [];

        this.mediaRecorder.ondataavailable = (event) => {
            if (event.data.size > 0) {
                this.audioChunks.push(event.data);
            }
        };

        this.mediaRecorder.onstop = async () => {
            if (this.audioChunks.length > 0 && this.isRunning) {
                await this._processWhisperChunk();
            }
        };

        // Start recording
        this.mediaRecorder.start();
        console.log('[Transcription] Whisper recording started');

        // Set up chunk timer - process every N seconds
        this.chunkTimer = setInterval(() => {
            if (this.mediaRecorder && this.mediaRecorder.state === 'recording' && !this.processingChunk) {
                this.mediaRecorder.stop();
                // Restart recording immediately
                setTimeout(() => {
                    if (this.isRunning && this.mediaRecorder) {
                        this.audioChunks = [];
                        this.mediaRecorder.start();
                    }
                }, 100);
            }
        }, this.chunkIntervalMs);
    }

    /**
     * Process audio chunk with Whisper
     */
    async _processWhisperChunk() {
        if (this.processingChunk || !this.whisperPipeline || this.audioChunks.length === 0) {
            return;
        }

        this.processingChunk = true;
        const chunkStartTime = Date.now();

        try {
            // Combine audio chunks into a single blob
            const audioBlob = new Blob(this.audioChunks, { type: 'audio/webm' });

            // Convert to array buffer
            const arrayBuffer = await audioBlob.arrayBuffer();

            // Decode audio data
            const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);

            // Get audio data as Float32Array (mono, 16kHz)
            const audioData = this._getAudioData(audioBuffer);

            if (audioData.length < 1600) { // Less than 0.1 seconds
                console.log('[Transcription] Audio chunk too short, skipping');
                this.processingChunk = false;
                return;
            }

            // Run Whisper transcription
            const result = await this.whisperPipeline(audioData, {
                language: null, // Auto-detect language
                task: 'transcribe',
                chunk_length_s: 30,
                stride_length_s: 5
            });

            if (result && result.text && result.text.trim()) {
                const text = result.text.trim();

                // Filter out common Whisper hallucinations
                if (!this._isHallucination(text)) {
                    this._handleTranscript(text, null, 'whisper');
                } else {
                    console.log('[Transcription] Filtered hallucination:', text);
                }
            }

        } catch (error) {
            console.error('[Transcription] Whisper processing error:', error);
        } finally {
            this.processingChunk = false;
        }
    }

    /**
     * Extract audio data from AudioBuffer as Float32Array
     */
    _getAudioData(audioBuffer) {
        // Get mono channel (mix down if stereo)
        const numberOfChannels = audioBuffer.numberOfChannels;
        const length = audioBuffer.length;
        const sampleRate = audioBuffer.sampleRate;

        let audioData;

        if (numberOfChannels === 1) {
            audioData = audioBuffer.getChannelData(0);
        } else {
            // Mix down to mono
            audioData = new Float32Array(length);
            for (let i = 0; i < numberOfChannels; i++) {
                const channelData = audioBuffer.getChannelData(i);
                for (let j = 0; j < length; j++) {
                    audioData[j] += channelData[j] / numberOfChannels;
                }
            }
        }

        // Resample to 16kHz if necessary
        if (sampleRate !== 16000) {
            const ratio = sampleRate / 16000;
            const newLength = Math.round(length / ratio);
            const resampled = new Float32Array(newLength);
            for (let i = 0; i < newLength; i++) {
                resampled[i] = audioData[Math.round(i * ratio)];
            }
            return resampled;
        }

        return audioData;
    }

    /**
     * Check if text is a common Whisper hallucination
     */
    _isHallucination(text) {
        const hallucinations = [
            'thank you',
            'thanks for watching',
            'subscribe',
            'like and subscribe',
            'see you next time',
            'goodbye',
            'bye bye',
            'music',
            'applause',
            'laughter',
            '[music]',
            '[applause]',
            '...',
            'you',
            'the',
            'uh',
            'um'
        ];

        const lowerText = text.toLowerCase().trim();

        // Check exact matches for short hallucinations
        if (lowerText.length < 5) {
            return hallucinations.includes(lowerText);
        }

        // Check if it's just repeated characters or words
        if (/^(.)\1+$/.test(lowerText.replace(/\s/g, ''))) {
            return true;
        }

        // Check common hallucination patterns
        for (const h of hallucinations) {
            if (lowerText === h || lowerText === h + '.') {
                return true;
            }
        }

        return false;
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
                    this._handleTranscript(transcript, confidence, 'native');
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
    _handleTranscript(text, confidence = null, source = 'native') {
        const now = Date.now();
        const endMs = now - this.meetingStartEpoch;
        const startMs = endMs - (source === 'whisper' ? this.chunkIntervalMs : 3000);

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
            source: source,
            language: 'auto',
            isFinal: true,
            timestamp: new Date().toISOString(),
            synced: 0  // Use 0/1 instead of false/true for IndexedDB compatibility
        };

        // Add to buffer
        this.transcriptBuffer.push(segment);

        // Save to IndexedDB
        this._saveToIndexedDB(segment);

        // Callback for live display
        if (this.onTranscript) {
            this.onTranscript(segment);
        }

        console.log(`[Transcription:${source}]`, segment.speakerName + ':', segment.text);
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
            const request = index.getAll(IDBKeyRange.only(0));  // 0 = not synced

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
                    record.synced = 1;  // 1 = synced
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

        // Remove leading/trailing punctuation artifacts
        text = text.replace(/^[,.\s]+|[,.\s]+$/g, '').trim();

        if (!text) return '';

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
    async start() {
        if (this.isRunning) return true;

        this.isRunning = true;
        this.isEnabled = true;

        console.log('[Transcription] Starting...');

        if (this.useNativeSTT) {
            this._startNativeSTT();
        } else if (this.useWhisper) {
            // Load Whisper model if not already loaded
            const modelLoaded = await this._loadWhisperModel();
            if (!modelLoaded) {
                this.isRunning = false;
                this.isEnabled = false;
                console.error('[Transcription] Failed to load Whisper model');
                return false;
            }

            // Initialize audio capture
            const audioReady = await this._initWhisperAudio();
            if (!audioReady) {
                this.isRunning = false;
                this.isEnabled = false;
                console.error('[Transcription] Failed to initialize audio');
                return false;
            }

            // Start recording
            this._startWhisperRecording();
        } else {
            console.warn('[Transcription] No STT engine available');
            this.isRunning = false;
            this.isEnabled = false;
            return false;
        }

        // Start periodic sync
        this.syncTimer = setInterval(() => {
            this._syncToServer();
        }, this.syncIntervalMs);

        if (this.onStateChange) {
            this.onStateChange({ enabled: true, engine: this.useNativeSTT ? 'native' : 'whisper' });
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

        if (this.chunkTimer) {
            clearInterval(this.chunkTimer);
        }

        if (this.useNativeSTT && this.recognition) {
            try {
                this.recognition.stop();
            } catch (e) {}
        }

        if (this.useWhisper) {
            // Stop media recorder
            if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
                try {
                    this.mediaRecorder.stop();
                } catch (e) {}
            }

            // Stop media stream tracks
            if (this.mediaStream) {
                this.mediaStream.getTracks().forEach(track => track.stop());
            }

            // Close audio context
            if (this.audioContext && this.audioContext.state !== 'closed') {
                try {
                    await this.audioContext.close();
                } catch (e) {}
            }
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
        if (this.useNativeSTT) {
            return {
                engine: 'Native Web Speech API',
                available: true,
                privacyNote: 'Audio processed by Google (Chrome) or Microsoft (Edge)'
            };
        } else if (this.useWhisper) {
            return {
                engine: 'Whisper WASM (whisper-base)',
                available: true,
                privacyNote: 'Audio processed locally in your browser - no data sent to external servers',
                modelSize: '~145MB',
                languages: 'Multilingual (99 languages)'
            };
        }
        return {
            engine: 'None',
            available: false,
            privacyNote: 'Transcription not available'
        };
    }

    /**
     * Check if transcription is available
     */
    isAvailable() {
        return this.useNativeSTT || this.useWhisper;
    }

    /**
     * Check if Whisper model is loaded
     */
    isWhisperReady() {
        return this.whisperReady;
    }

    /**
     * Get current status
     */
    getStatus() {
        return {
            isRunning: this.isRunning,
            isEnabled: this.isEnabled,
            engine: this.useNativeSTT ? 'native' : (this.useWhisper ? 'whisper' : 'none'),
            whisperReady: this.whisperReady,
            whisperLoading: this.whisperLoading,
            bufferedCount: this.transcriptBuffer.length,
            batchNumber: this.batchNumber
        };
    }
}

// Export for use in meeting.js
window.TranscriptionService = TranscriptionService;
