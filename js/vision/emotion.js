/**
 * EmotionDetector — real-time facial emotion detection for Copilot HUD.
 * Lazy-loads face-api.js from CDN, runs detection at 2 FPS on a remote
 * participant's video element, smooths results over 5 frames, and reports
 * emotion + attention (looking at camera) via callback.
 *
 * Usage:
 *   const detector = new EmotionDetector();
 *   await detector.initialize();
 *   detector.onEmotionUpdate = (emotion, confidence, isLooking, rawExpressions) => { ... };
 *   detector.startAnalysis(videoElement);
 *   // later:
 *   detector.stopAnalysis();
 */

class EmotionDetector {
    constructor() {
        this.loaded = false;
        this.analyzing = false;
        this._detecting = false;        // guard against overlapping async calls
        this._sentimentHistory = [];    // last 5 emotions for smoothing
        this._attentionHistory = [];    // last 3 rotations for smoothing
        this.onEmotionUpdate = null;    // callback(emotion, confidence, isLooking, rawExpressions)
        this._intervalId = null;
        this._videoElement = null;
    }

    /**
     * Lazy-load face-api.js script + neural network models.
     * Called once; subsequent calls are no-ops.
     */
    async initialize() {
        if (this.loaded) return true;

        // Lazy-load face-api.js from CDN
        if (!window.faceapi) {
            await this._loadScript(
                'https://cdn.jsdelivr.net/npm/face-api.js@0.22.2/dist/face-api.min.js'
            );
        }

        const MODEL_URL = 'https://justadudewhohacks.github.io/face-api.js/models';
        await Promise.all([
            faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
            faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
            faceapi.nets.faceExpressionNet.loadFromUri(MODEL_URL)
        ]);

        this.loaded = true;
        console.log('[EmotionDetector] Models loaded');
        return true;
    }

    /**
     * Start analysis on a video element at 2 FPS (500ms interval).
     * Stops any previous analysis first.
     */
    startAnalysis(videoElement) {
        if (!this.loaded || !videoElement) return;
        this.stopAnalysis(); // clean up any previous
        this._videoElement = videoElement;
        this.analyzing = true;
        this._intervalId = setInterval(() => this._detect(), 500);
        console.log('[EmotionDetector] Started analysis');
    }

    /**
     * Stop analysis and reset state. Safe to call multiple times.
     */
    stopAnalysis() {
        this.analyzing = false;
        this._detecting = false;
        if (this._intervalId) {
            clearInterval(this._intervalId);
            this._intervalId = null;
        }
        this._videoElement = null;
        this._sentimentHistory = [];
        this._attentionHistory = [];
    }

    /**
     * Internal: run one detection frame. Guarded against concurrent calls.
     */
    async _detect() {
        if (!this.analyzing || !this._videoElement || this._detecting) return;
        if (this._videoElement.readyState < this._videoElement.HAVE_ENOUGH_DATA) return;
        if (this._videoElement.videoWidth === 0) return; // not rendering yet

        this._detecting = true;
        try {
            const detection = await faceapi.detectSingleFace(
                this._videoElement,
                new faceapi.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.5 })
            ).withFaceLandmarks().withFaceExpressions();

            if (!this.analyzing) return; // stopped during async detection

            if (detection) {
                const smoothedEmotion = this._smoothEmotion(detection.expressions);
                const isLooking = this._computeAttention(detection.landmarks);
                const topConfidence = this._getTopConfidence(detection.expressions);

                this.onEmotionUpdate?.(smoothedEmotion, topConfidence, isLooking, detection.expressions);
            } else {
                this.onEmotionUpdate?.(null, 0, false, null);
            }
        } catch (e) {
            // Silently handle — video element may have been removed
            if (e.message && !e.message.includes('disposed')) {
                console.warn('[EmotionDetector] Detection error:', e.message);
            }
        } finally {
            this._detecting = false;
        }
    }

    /**
     * Smooth emotion over last 5 frames using majority vote.
     * Below 0.4 confidence → treat as neutral.
     */
    _smoothEmotion(expressions) {
        let topEmotion = 'neutral';
        let topScore = 0;
        for (const [emotion, score] of Object.entries(expressions)) {
            if (score > topScore) { topScore = score; topEmotion = emotion; }
        }
        // Below threshold → treat as neutral
        if (topScore < 0.4) topEmotion = 'neutral';

        // Push to history and keep last 5
        this._sentimentHistory.push(topEmotion);
        if (this._sentimentHistory.length > 5) this._sentimentHistory.shift();

        // Return most frequent in history
        const counts = {};
        for (const s of this._sentimentHistory) counts[s] = (counts[s] || 0) + 1;
        let best = 'neutral', bestCount = 0;
        for (const [emotion, count] of Object.entries(counts)) {
            if (count > bestCount) { bestCount = count; best = emotion; }
        }
        return best;
    }

    /**
     * Estimate head pose from landmarks. Returns true if looking at camera
     * (within ±20° on both axes), smoothed over 3 frames.
     */
    _computeAttention(landmarks) {
        const nose = landmarks.getNose();
        const jaw = landmarks.getJawOutline();

        if (nose.length < 4 || jaw.length < 2) return true; // can't compute, assume looking

        const noseTip = nose[3];
        const noseBridge = nose[1];
        const faceWidth = Math.abs(jaw[jaw.length - 1].x - jaw[0].x);
        if (faceWidth === 0) return true;

        const noseVecX = noseTip.x - noseBridge.x;
        const noseVecY = noseTip.y - noseBridge.y;

        const rotY = Math.atan2(noseVecX, Math.abs(noseVecY)) * (180 / Math.PI);
        const rotX = Math.atan2(noseVecY, faceWidth) * (180 / Math.PI);

        // Smooth over 3 frames
        this._attentionHistory.push({ x: rotX, y: rotY });
        if (this._attentionHistory.length > 3) this._attentionHistory.shift();

        const avgX = this._attentionHistory.reduce((s, r) => s + r.x, 0) / this._attentionHistory.length;
        const avgY = this._attentionHistory.reduce((s, r) => s + r.y, 0) / this._attentionHistory.length;

        // Looking at camera if rotation is within ±20 degrees on both axes
        return Math.abs(avgY) < 20 && Math.abs(avgX) < 20;
    }

    /**
     * Get the highest confidence score from all expressions.
     */
    _getTopConfidence(expressions) {
        let max = 0;
        for (const score of Object.values(expressions)) {
            if (score > max) max = score;
        }
        return max;
    }

    /**
     * Dynamically load a script tag and wait for it.
     */
    _loadScript(src) {
        return new Promise((resolve, reject) => {
            if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
            const s = document.createElement('script');
            s.src = src;
            s.onload = resolve;
            s.onerror = () => reject(new Error(`Failed to load: ${src}`));
            document.head.appendChild(s);
        });
    }
}
