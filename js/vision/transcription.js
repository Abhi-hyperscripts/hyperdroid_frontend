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

        // VAD (Voice Activity Detection) settings
        this.vadEnabled = true;
        this.vadThreshold = 0.01;        // RMS threshold for speech detection
        this.vadMinSpeechMs = 300;       // Minimum speech duration in ms
        this.vadSilenceMs = 500;         // Silence duration to consider end of speech
        this.vadAnalyser = null;
        this.vadSpeechDetected = false;
        this.vadSpeechStartTime = null;
        this.vadLastSpeechTime = null;

        // Repetition filter settings
        this.maxWordRepetitions = 5;     // Max allowed consecutive word repeats
        this.maxCharRepetitions = 10;    // Max allowed character repeats

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
     * Initialize audio capture for Whisper with VAD
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

            // Initialize VAD analyser
            if (this.vadEnabled) {
                this._initVAD();
            }

            console.log('[Transcription] Audio capture initialized for Whisper with VAD');
            return true;
        } catch (error) {
            console.error('[Transcription] Failed to initialize audio:', error);
            return false;
        }
    }

    /**
     * Initialize Voice Activity Detection (VAD)
     */
    _initVAD() {
        if (!this.audioContext || !this.mediaStream) return;

        const source = this.audioContext.createMediaStreamSource(this.mediaStream);
        this.vadAnalyser = this.audioContext.createAnalyser();
        this.vadAnalyser.fftSize = 2048;
        this.vadAnalyser.smoothingTimeConstant = 0.8;
        source.connect(this.vadAnalyser);

        console.log('[Transcription] VAD initialized');
    }

    /**
     * Check if there's speech activity in the current audio
     */
    _detectSpeech() {
        if (!this.vadAnalyser) return true; // If no VAD, assume speech

        const dataArray = new Float32Array(this.vadAnalyser.fftSize);
        this.vadAnalyser.getFloatTimeDomainData(dataArray);

        // Calculate RMS (Root Mean Square) energy
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
            sum += dataArray[i] * dataArray[i];
        }
        const rms = Math.sqrt(sum / dataArray.length);

        const isSpeech = rms > this.vadThreshold;
        const now = Date.now();

        if (isSpeech) {
            if (!this.vadSpeechDetected) {
                this.vadSpeechDetected = true;
                this.vadSpeechStartTime = now;
            }
            this.vadLastSpeechTime = now;
        } else {
            // Check if silence has lasted long enough to end speech segment
            if (this.vadSpeechDetected && this.vadLastSpeechTime) {
                const silenceDuration = now - this.vadLastSpeechTime;
                if (silenceDuration > this.vadSilenceMs) {
                    this.vadSpeechDetected = false;
                }
            }
        }

        return isSpeech;
    }

    /**
     * Check if audio chunk contains enough speech
     */
    _hasEnoughSpeech(audioData) {
        if (!this.vadEnabled) return true;

        // Calculate RMS for the entire chunk
        let sum = 0;
        let speechSamples = 0;
        const sampleRate = 16000;
        const windowSize = Math.floor(sampleRate * 0.02); // 20ms windows

        for (let i = 0; i < audioData.length; i += windowSize) {
            let windowSum = 0;
            const windowEnd = Math.min(i + windowSize, audioData.length);
            for (let j = i; j < windowEnd; j++) {
                windowSum += audioData[j] * audioData[j];
            }
            const windowRms = Math.sqrt(windowSum / (windowEnd - i));
            if (windowRms > this.vadThreshold) {
                speechSamples += windowEnd - i;
            }
        }

        // Calculate speech duration in ms
        const speechDurationMs = (speechSamples / sampleRate) * 1000;
        const hasEnough = speechDurationMs >= this.vadMinSpeechMs;

        if (!hasEnough) {
            console.log(`[Transcription] VAD: Insufficient speech (${speechDurationMs.toFixed(0)}ms < ${this.vadMinSpeechMs}ms)`);
        }

        return hasEnough;
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
        this.vadSpeechDetected = false;
        this.vadLastSpeechTime = null;

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
        console.log('[Transcription] Whisper recording started with VAD');

        // Start VAD monitoring
        if (this.vadEnabled) {
            this._startVADMonitoring();
        }

        // Set up chunk timer - process every N seconds
        this.chunkTimer = setInterval(() => {
            if (this.mediaRecorder && this.mediaRecorder.state === 'recording' && !this.processingChunk) {
                this.mediaRecorder.stop();
                // Restart recording immediately
                setTimeout(() => {
                    if (this.isRunning && this.mediaRecorder) {
                        this.audioChunks = [];
                        this.vadSpeechDetected = false;
                        this.mediaRecorder.start();
                    }
                }, 100);
            }
        }, this.chunkIntervalMs);
    }

    /**
     * Start VAD monitoring loop
     */
    _startVADMonitoring() {
        if (!this.vadAnalyser) return;

        const checkVAD = () => {
            if (!this.isRunning) return;
            this._detectSpeech();
            requestAnimationFrame(checkVAD);
        };

        requestAnimationFrame(checkVAD);
        console.log('[Transcription] VAD monitoring started');
    }

    /**
     * Process audio chunk with Whisper (with VAD pre-filtering)
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

            // VAD: Check if chunk contains enough speech
            if (!this._hasEnoughSpeech(audioData)) {
                console.log('[Transcription] VAD: Dropping silent chunk');
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
                let text = result.text.trim();

                // Apply repetition filter first
                text = this._filterRepetitions(text);

                if (text && !this._isHallucination(text)) {
                    this._handleTranscript(text, null, 'whisper');
                } else {
                    console.log('[Transcription] Filtered output:', result.text.trim().substring(0, 50) + '...');
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
     * Filter repetitive content from Whisper output
     * Returns cleaned text or null if entirely repetitive
     */
    _filterRepetitions(text) {
        if (!text) return null;

        // Split into words
        const words = text.split(/\s+/);
        if (words.length === 0) return null;

        // Detect and remove consecutive word repetitions
        const filteredWords = [];
        let lastWord = null;
        let repeatCount = 0;

        for (const word of words) {
            const normalizedWord = word.toLowerCase().replace(/[.,!?;:]/g, '');

            if (normalizedWord === lastWord) {
                repeatCount++;
                if (repeatCount < this.maxWordRepetitions) {
                    filteredWords.push(word);
                }
                // Skip if too many repeats
            } else {
                repeatCount = 1;
                lastWord = normalizedWord;
                filteredWords.push(word);
            }
        }

        // If we removed too much, the entire chunk was repetitive
        if (filteredWords.length < words.length * 0.3) {
            console.log(`[Transcription] Repetition filter: Discarded (${filteredWords.length}/${words.length} words kept)`);
            return null;
        }

        let result = filteredWords.join(' ').trim();

        // Check for character-level repetition patterns (e.g., "oh, oh, oh, oh")
        const charPattern = result.replace(/\s+/g, '');
        if (this._hasCharacterRepetition(charPattern)) {
            console.log('[Transcription] Repetition filter: Character-level repetition detected');
            return null;
        }

        // Check for phrase-level repetition (e.g., "in the middle of the middle of the middle")
        result = this._removePhraseRepetition(result);

        return result && result.length > 3 ? result : null;
    }

    /**
     * Check for excessive character-level repetition
     */
    _hasCharacterRepetition(text) {
        if (!text || text.length < 10) return false;

        // Check for repeated patterns like "ohohohoh" or "hellohelohello"
        for (let patternLen = 1; patternLen <= 10; patternLen++) {
            const pattern = text.substring(0, patternLen);
            let repeats = 0;
            let pos = 0;

            while (pos + patternLen <= text.length) {
                if (text.substring(pos, pos + patternLen).toLowerCase() === pattern.toLowerCase()) {
                    repeats++;
                    pos += patternLen;
                } else {
                    break;
                }
            }

            // If a short pattern repeats many times, it's repetitive
            if (repeats > this.maxCharRepetitions) {
                return true;
            }
        }

        return false;
    }

    /**
     * Remove phrase-level repetitions
     */
    _removePhraseRepetition(text) {
        const words = text.split(/\s+/);
        if (words.length < 6) return text;

        // Try to find repeated phrases of different lengths
        for (let phraseLen = 2; phraseLen <= Math.floor(words.length / 3); phraseLen++) {
            let i = 0;
            let foundRepetition = false;

            while (i + phraseLen * 2 <= words.length) {
                const phrase1 = words.slice(i, i + phraseLen).join(' ').toLowerCase();
                const phrase2 = words.slice(i + phraseLen, i + phraseLen * 2).join(' ').toLowerCase();

                if (phrase1 === phrase2) {
                    // Count how many times this phrase repeats
                    let repeatCount = 1;
                    let j = i + phraseLen;
                    while (j + phraseLen <= words.length) {
                        const nextPhrase = words.slice(j, j + phraseLen).join(' ').toLowerCase();
                        if (nextPhrase === phrase1) {
                            repeatCount++;
                            j += phraseLen;
                        } else {
                            break;
                        }
                    }

                    if (repeatCount >= 3) {
                        // Remove repeated phrases, keep only first occurrence
                        console.log(`[Transcription] Phrase repetition detected: "${phrase1}" x${repeatCount}`);
                        const before = words.slice(0, i + phraseLen);
                        const after = words.slice(j);
                        return [...before, ...after].join(' ');
                    }
                }
                i++;
            }
        }

        return text;
    }

    /**
     * Check if text is a common Whisper hallucination
     */
    _isHallucination(text) {
        if (!text) return true;

        const lowerText = text.toLowerCase().trim();

        // Very short outputs are suspicious
        if (lowerText.length < 3) return true;

        // Known hallucination phrases
        const hallucinations = [
            'thank you',
            'thanks for watching',
            'subscribe',
            'like and subscribe',
            'see you next time',
            'goodbye',
            'bye bye',
            'bye',
            'music',
            'applause',
            'laughter',
            '[music]',
            '[applause]',
            '[silence]',
            '[click]',
            '[s]',
            '...',
            'you',
            'the',
            'uh',
            'um',
            'nd',
            'silence'
        ];

        // Check exact matches
        const cleanText = lowerText.replace(/[.\[\]]/g, '').trim();
        if (hallucinations.includes(cleanText)) {
            return true;
        }

        // Check if it starts/ends with hallucination markers
        if (/^\[.*\]\.?$/.test(lowerText)) {
            return true; // Entire text is just [something]
        }

        // Check for excessive repetition of single words/sounds
        const words = lowerText.split(/[\s,]+/).filter(w => w.length > 0);
        if (words.length > 0) {
            const uniqueWords = new Set(words.map(w => w.replace(/[.,!?]/g, '')));
            const repetitionRatio = uniqueWords.size / words.length;

            // If more than 80% of words are the same word repeated
            if (repetitionRatio < 0.2 && words.length > 5) {
                return true;
            }
        }

        // Check for "Hello Hello Hello..." pattern
        if (/^(hello\s*)+\.?$/i.test(lowerText)) {
            return true;
        }

        // Check for "oh, oh, oh..." pattern
        if (/^(oh[,\s]*)+\.?$/i.test(lowerText)) {
            return true;
        }

        // Check for "[S] [S] [S]..." pattern
        if (/^(\[s\]\s*)+\.?$/i.test(lowerText)) {
            return true;
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
