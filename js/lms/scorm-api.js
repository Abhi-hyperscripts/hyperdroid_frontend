/**
 * SCORM 1.2 API adapter.
 *
 * SCORM content does not talk HTTP. It walks up the window hierarchy looking for an object called
 * `API` and calls eight synchronous functions on it. If it cannot find one it gives up — usually
 * silently, sometimes with an alert nobody understands — which is exactly what happened here before:
 * the LMS had 'scorm' as a content type with a URL beside it, the package loaded in an iframe, found
 * no API, and reported nothing back for the rest of the attempt.
 *
 * Two constraints shape everything below.
 *
 * 1. THE API IS SYNCHRONOUS. LMSGetValue must return a string, now — the content assigns it to a
 *    variable on the next line. So the data model is fetched ONCE at LMSInitialize and held in
 *    memory; reads never touch the network. Writes accumulate and go out on LMSCommit/LMSFinish.
 *
 * 2. THE CONTENT IS NOT OURS. It is compiled output from Articulate, Captivate or similar, and it
 *    probes for elements it is unsure about and branches on the error code. Returning "" plus error 0
 *    for something unsupported is worse than an honest 401: content reading cmi.core.lesson_status
 *    and getting "" often decides the attempt is corrupt and restarts it.
 */
(function () {
    'use strict';

    const ERR = {
        NONE: '0',
        GENERAL: '101',
        INVALID_ARG: '201',
        NOT_INITIALIZED: '301',
        NOT_IMPLEMENTED: '401',
        READ_ONLY: '403',
        WRITE_ONLY: '404',
        TYPE_MISMATCH: '405'
    };

    const ERR_TEXT = {
        '0': 'No error',
        '101': 'General exception',
        '201': 'Invalid argument error',
        '301': 'Not initialized',
        '401': 'Not implemented error',
        '403': 'Element is read only',
        '404': 'Element is write only',
        '405': 'Incorrect data type'
    };

    // Written by the LMS, read by the content. A write attempt is 403 — mirrored from the server's
    // ScormDataModel so the content gets the same answer whether or not a commit has happened yet.
    const READ_ONLY = new Set([
        'cmi.core.student_id', 'cmi.core.student_name', 'cmi.core.credit', 'cmi.core.entry',
        'cmi.core.total_time', 'cmi.core.lesson_mode', 'cmi.launch_data', 'cmi.comments_from_lms',
        'cmi.student_data.mastery_score', 'cmi.student_data.max_time_allowed',
        'cmi.student_data.time_limit_action'
    ]);
    const WRITE_ONLY = new Set(['cmi.core.exit', 'cmi.core.session_time']);

    // `_children` and `_count` are how content discovers the shape of the model. Answering them
    // wrongly makes content skip whole features (it will not record interactions it believes we
    // cannot store), so they are enumerated rather than defaulted.
    const CHILDREN = {
        'cmi.core._children':
            'student_id,student_name,lesson_location,credit,lesson_status,entry,score,total_time,lesson_mode,exit,session_time',
        'cmi.core.score._children': 'raw,min,max',
        'cmi.student_data._children': 'mastery_score,max_time_allowed,time_limit_action',
        'cmi.objectives._children': 'id,score,status',
        'cmi.interactions._children': 'id,objectives,time,type,correct_responses,weighting,student_response,result,latency'
    };

    const ScormRuntime = {
        _lessonId: null,
        _cmi: {},
        _dirty: {},
        _initialized: false,
        _finished: false,
        _lastError: ERR.NONE,
        _sessionStart: 0,

        /**
         * Called by the lesson viewer BEFORE the content iframe is created. The data model has to be
         * in memory before the content's first synchronous LMSGetValue, and there is no way to make
         * the content wait.
         */
        async preload(lessonId) {
            this._lessonId = lessonId;
            const res = await api.request(`/lms/scorm/lessons/${lessonId}/launch`);
            this._cmi = res.cmi || res.Cmi || {};
            this._dirty = {};
            this._initialized = false;
            this._finished = false;
            this._lastError = ERR.NONE;
            return res.launchUrl || res.LaunchUrl || '';
        },

        // ─── the eight functions SCORM 1.2 content calls ───────────────────

        LMSInitialize(param) {
            if (param !== '' && param !== undefined) { this._lastError = ERR.INVALID_ARG; return 'false'; }
            if (this._initialized) { this._lastError = ERR.GENERAL; return 'false'; }
            this._initialized = true;
            this._sessionStart = Date.now();
            this._lastError = ERR.NONE;
            return 'true';
        },

        LMSGetValue(element) {
            if (!this._initialized) { this._lastError = ERR.NOT_INITIALIZED; return ''; }
            if (!element) { this._lastError = ERR.INVALID_ARG; return ''; }

            if (Object.prototype.hasOwnProperty.call(CHILDREN, element)) {
                this._lastError = ERR.NONE;
                return CHILDREN[element];
            }
            if (WRITE_ONLY.has(element)) { this._lastError = ERR.WRITE_ONLY; return ''; }

            // A `_count` for a collection nothing has written to is 0, not an error — content uses it
            // to decide the index of the next interaction it records.
            if (element.endsWith('._count')) {
                this._lastError = ERR.NONE;
                const prefix = element.slice(0, -'._count'.length) + '.';
                const seen = new Set();
                Object.keys(this._cmi).forEach(k => {
                    if (k.startsWith(prefix)) {
                        const idx = k.slice(prefix.length).split('.')[0];
                        if (/^\d+$/.test(idx)) seen.add(idx);
                    }
                });
                return String(seen.size);
            }

            const value = this._cmi[element];
            if (value === undefined) {
                // Unset but legitimate elements read as empty with NO error — that is the spec, and
                // content relies on it to distinguish "nothing stored yet" from "you don't support it".
                this._lastError = ERR.NONE;
                return '';
            }
            this._lastError = ERR.NONE;
            return String(value);
        },

        LMSSetValue(element, value) {
            if (!this._initialized) { this._lastError = ERR.NOT_INITIALIZED; return 'false'; }
            if (!element) { this._lastError = ERR.INVALID_ARG; return 'false'; }
            if (READ_ONLY.has(element) || element.endsWith('._children') || element.endsWith('._count')) {
                this._lastError = ERR.READ_ONLY;
                return 'false';
            }
            const str = value === undefined || value === null ? '' : String(value);

            // Validated here as well as on the server so the content gets a truthful answer on the
            // same tick. The server re-checks because this file is in the browser and trivially
            // bypassed — this copy is for correctness, that one is the guard.
            if (element === 'cmi.core.lesson_status' &&
                !['passed', 'completed', 'failed', 'incomplete', 'browsed', 'not attempted']
                    .includes(str.trim().toLowerCase())) {
                this._lastError = ERR.TYPE_MISMATCH;
                return 'false';
            }

            this._cmi[element] = str;
            this._dirty[element] = str;
            this._lastError = ERR.NONE;
            return 'true';
        },

        LMSCommit(param) {
            if (param !== '' && param !== undefined) { this._lastError = ERR.INVALID_ARG; return 'false'; }
            if (!this._initialized) { this._lastError = ERR.NOT_INITIALIZED; return 'false'; }
            this._flush(false);
            this._lastError = ERR.NONE;
            return 'true';
        },

        LMSFinish(param) {
            if (param !== '' && param !== undefined) { this._lastError = ERR.INVALID_ARG; return 'false'; }
            if (!this._initialized) { this._lastError = ERR.NOT_INITIALIZED; return 'false'; }

            // Content very often does NOT set session_time, and an LMS that leaves it at zero reports
            // every learner as having spent no time on the course. Filling it from our own clock when
            // the content stayed silent is the difference between a usable time report and an empty one.
            if (this._dirty['cmi.core.session_time'] === undefined &&
                this._cmi['cmi.core.session_time'] === undefined && this._sessionStart) {
                const secs = Math.max(0, Math.round((Date.now() - this._sessionStart) / 1000));
                const hh = String(Math.floor(secs / 3600)).padStart(4, '0');
                const mm = String(Math.floor((secs % 3600) / 60)).padStart(2, '0');
                const ss = String(secs % 60).padStart(2, '0');
                this._dirty['cmi.core.session_time'] = `${hh}:${mm}:${ss}.00`;
            }

            this._flush(true);
            this._initialized = false;
            this._finished = true;
            this._lastError = ERR.NONE;
            return 'true';
        },

        LMSGetLastError() { return this._lastError; },
        LMSGetErrorString(code) { return ERR_TEXT[String(code)] || 'Unknown error'; },
        LMSGetDiagnostic(code) { return this.LMSGetErrorString(code); },

        /**
         * Ships the accumulated writes.
         *
         * Deliberately fire-and-forget: the SCORM call that triggered it must return synchronously,
         * so there is nothing to await it. `keepalive` on the finish path is what gets the last
         * commit out when the learner closes the tab — a normal fetch is cancelled on unload, which
         * is precisely when LMSFinish fires and precisely the commit that carries the completion.
         */
        _flush(isFinish) {
            const payload = this._dirty;
            this._dirty = {};
            if (Object.keys(payload).length === 0 && !isFinish) return;

            const body = JSON.stringify({ values: payload, finished: !!isFinish });
            const url = `${CONFIG.lmsApiBaseUrl}/scorm/lessons/${this._lessonId}/commit`;
            const headers = {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${api.token}`
            };

            try {
                fetch(url, { method: 'POST', headers, body, keepalive: !!isFinish })
                    .then(r => r.ok ? r.json() : null)
                    .then(res => {
                        if (res && res.lesson_completed && typeof window.onScormLessonComplete === 'function') {
                            window.onScormLessonComplete(this._lessonId, res.score);
                        }
                    })
                    .catch(err => console.warn('[scorm] commit failed', err));
            } catch (err) {
                console.warn('[scorm] commit threw', err);
            }
        }
    };

    // SCORM content searches `window.parent`, then `window.opener`, then up the chain, for a property
    // literally named `API`. Both names are exposed: `API` is what the content binds to, ScormRuntime
    // is what the lesson viewer drives.
    window.API = ScormRuntime;
    window.ScormRuntime = ScormRuntime;

    // A learner closing the tab mid-course is the common case, not the exception. Without this the
    // attempt's final state never reaches the server and the course shows as incomplete for ever.
    window.addEventListener('pagehide', () => {
        if (ScormRuntime._initialized && !ScormRuntime._finished) ScormRuntime.LMSFinish('');
    });
})();
