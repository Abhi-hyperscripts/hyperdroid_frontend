/**
 * Bulk WhatsApp Progress Tracker — the non-blocking sibling of
 * bulk-whatsapp-modal.js.
 *
 * When the rep clicks Send on the bulk-WA modal, the modal POSTs
 * /api/whatsapp/bulk-send, receives a batch_id, then closes
 * immediately. This tracker takes over: a small floating chip
 * appears bottom-right showing live progress, the rep can keep
 * working in the CRM, the chip survives page navigation via
 * localStorage, and clicking it expands a detail panel with the
 * per-recipient breakdown.
 *
 * Why this matters: a 500-recipient batch at 1 send/sec is ~8 minutes
 * of drainer cycles. The previous blocking-modal UX locked the rep
 * in that wait. With this tracker, they fire-and-forget and check
 * back when they want.
 *
 * Design:
 *   • Singleton — only one tracker instance per page, but it tracks
 *     N concurrent batches as a list of chips (stacked vertically).
 *   • localStorage as the source of truth for "what's in flight" —
 *     keys: `bulkWaActive` (JSON array of batch_ids).
 *   • Poll cadence: 3s (less aggressive than the modal's 2s; the
 *     rep isn't actively staring at it).
 *   • Auto-dismiss on terminal status after a 30s grace window so
 *     the rep can glance at the final result; explicit Dismiss button
 *     for immediate hide.
 *   • Click to expand → opens an inline detail panel using the same
 *     markup the modal used. No re-implementation of the breakdown
 *     logic; this file calls into shared classify/render helpers.
 *
 * The tracker loads on every CRM page that includes this file. On
 * load it reads localStorage and resumes tracking any in-flight
 * batch — so a refresh mid-batch doesn't lose progress.
 */
(function () {
    'use strict';

    // Idempotent guard — navigation.js dynamically injects this file on
    // every CRM page, and leads.html may also include it statically.
    // Re-running the IIFE would re-register every window.* function and
    // duplicate the chip mount. Bail if a prior load already set up.
    if (window.bulkWaTrack) return;

    const STORAGE_KEY = 'bulkWaActiveBatches';
    const POLL_INTERVAL_MS = 3000;
    const AUTO_DISMISS_MS = 30000;

    /**
     * Friendly explanations — kept in sync with bulk-whatsapp-modal.js.
     * Future improvement: move to a shared module both files import.
     */
    const META_ERROR_EXPLANATIONS = {
        '131049': { label: 'Meta marketing throttle', help: "Meta limits how many marketing messages a single user receives across all businesses. They throttled this delivery because the recipient was less likely to engage. Try again in 24h, or use a Utility template if the message is transactional." },
        '131026': { label: 'Undeliverable', help: "Phone is invalid, blocked, or the recipient opted out of WhatsApp business messages." },
        '131047': { label: 'Outside 24h window', help: "More than 24 hours since the recipient last messaged you, and Meta wouldn't accept the template. Resubmit the template for approval if it's been rejected." },
        '132001': { label: 'Template paused', help: "Meta paused this template because of low quality scores. Submit a fresh variant in your BSP dashboard." },
        '132012': { label: 'Template parameter mismatch', help: "The template variables don't match what Meta approved. Check the {{N}} count against the approved version." },
    };

    function classifyError(errorMessage) {
        if (!errorMessage) return null;
        const match = String(errorMessage).match(/\b(\d{6})\b/);
        if (match && META_ERROR_EXPLANATIONS[match[1]]) {
            return { code: match[1], ...META_ERROR_EXPLANATIONS[match[1]], raw: errorMessage };
        }
        return null;
    }

    function esc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    // ─── State + persistence ─────────────────────────────────────

    /** In-memory state: { [batchId]: { batchId, expanded, lastPoll, pollHandle, autoDismissHandle, dismissed } } */
    const chips = new Map();

    function loadActiveBatchIds() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) return [];
            const parsed = JSON.parse(raw);
            return Array.isArray(parsed) ? parsed : [];
        } catch { return []; }
    }

    function saveActiveBatchIds() {
        // Only persist non-terminal, non-dismissed batches. Terminal
        // ones live in memory until auto-dismiss for that user's
        // session; we don't want them re-resurrecting on refresh.
        const ids = [];
        for (const [id, chip] of chips) {
            if (chip.dismissed) continue;
            const status = chip.lastPoll?.status;
            if (status === 'completed' || status === 'cancelled' || status === 'failed') continue;
            ids.push(id);
        }
        try {
            if (ids.length === 0) localStorage.removeItem(STORAGE_KEY);
            else localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
        } catch { /* localStorage quota / disabled — fail silently */ }
    }

    // ─── DOM mount ───────────────────────────────────────────────

    function ensureMountPoint() {
        let mount = document.getElementById('bulkWaTrackerMount');
        if (mount) return mount;
        mount = document.createElement('div');
        mount.id = 'bulkWaTrackerMount';
        mount.className = 'bulk-wa-tracker-mount';
        document.body.appendChild(mount);
        return mount;
    }

    // ─── Chip lifecycle ──────────────────────────────────────────

    function track(batchId) {
        if (!batchId) return;
        if (chips.has(batchId)) {
            // Already tracking — just ensure the chip is visible.
            const chip = chips.get(batchId);
            if (chip.dismissed) {
                chip.dismissed = false;
                renderChip(chip);
            }
            return;
        }
        const chip = {
            batchId,
            expanded: false,
            lastPoll: null,
            pollHandle: null,
            autoDismissHandle: null,
            dismissed: false,
            recipientsCache: null,
        };
        chips.set(batchId, chip);
        saveActiveBatchIds();
        renderChip(chip);
        startPolling(chip);
    }

    function renderChip(chip) {
        const mount = ensureMountPoint();
        let el = document.getElementById(`bulkWaChip_${chip.batchId}`);
        if (chip.dismissed) {
            if (el) el.remove();
            return;
        }
        if (!el) {
            el = document.createElement('div');
            el.id = `bulkWaChip_${chip.batchId}`;
            el.className = 'bulk-wa-chip';
            mount.appendChild(el);
        }
        const data = chip.lastPoll;
        const counts = data?.counts || {};
        const status = data?.status || 'queued';
        const total = data?.total_count || 0;
        const done = (counts.sent || 0) + (counts.delivered || 0) + (counts.read || 0)
                   + (counts.failed || 0) + (counts.skipped || 0) + (counts.cancelled || 0);
        const pct = total > 0 ? Math.round((done / total) * 100) : 0;
        const isTerminal = ['completed','cancelled','failed'].includes(status);
        const isFailedSome = (counts.failed || 0) + (counts.skipped || 0) + (counts.cancelled || 0) > 0;
        const chipClass = isTerminal ? (isFailedSome ? 'is-mixed' : 'is-done') : 'is-running';
        el.className = `bulk-wa-chip ${chipClass} ${chip.expanded ? 'is-expanded' : ''}`;

        const headerHtml = `
            <div class="bulk-wa-chip-head" onclick="bulkWaToggle('${esc(chip.batchId)}')">
                <div class="bulk-wa-chip-icon" aria-hidden="true">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M20.52 3.48A11.94 11.94 0 0 0 12.02 0C5.4 0 .07 5.35.07 11.96c0 2.11.55 4.17 1.6 5.99L0 24l6.21-1.63a11.93 11.93 0 0 0 5.81 1.48h.01c6.62 0 11.95-5.35 11.95-11.96 0-3.19-1.24-6.19-3.46-8.41z"/>
                    </svg>
                </div>
                <div class="bulk-wa-chip-body">
                    <div class="bulk-wa-chip-title">${isTerminal ? 'Bulk send complete' : 'Sending bulk WhatsApp'}</div>
                    <div class="bulk-wa-chip-meta">
                        ${total > 0 ? `${done} of ${total}` : 'Starting…'}
                        ${isFailedSome ? ` · <span class="bulk-wa-chip-fail">${(counts.failed || 0) + (counts.skipped || 0) + (counts.cancelled || 0)} failed</span>` : ''}
                    </div>
                    <div class="bulk-wa-chip-bar"><div class="bulk-wa-chip-bar-inner" style="width:${pct}%"></div></div>
                </div>
                <button class="bulk-wa-chip-dismiss" title="Dismiss" onclick="event.stopPropagation(); bulkWaDismiss('${esc(chip.batchId)}')">×</button>
            </div>
        `;
        const expandedHtml = chip.expanded ? `<div class="bulk-wa-chip-detail" id="bulkWaChipDetail_${esc(chip.batchId)}">${renderDetail(chip)}</div>` : '';
        el.innerHTML = headerHtml + expandedHtml;
    }

    function renderDetail(chip) {
        const recipients = chip.recipientsCache;
        if (!recipients) return `<div class="bulk-wa-chip-loading">Loading recipients…</div>`;
        if (recipients.length === 0) return `<div class="bulk-wa-chip-loading">No recipients found.</div>`;
        const failed = recipients.filter(r => r.status === 'failed' || r.status === 'cancelled' || r.status === 'skipped');
        const success = recipients.filter(r => r.status === 'delivered' || r.status === 'read');
        const inFlight = recipients.filter(r => r.status === 'sent' || r.status === 'sending' || r.status === 'pending');

        const card = (r, klass) => {
            const err = classifyError(r.error_message);
            const errDisp = err
                ? `<div class="bulk-wa-detail-err"><strong>${esc(err.code)} — ${esc(err.label)}</strong><div class="bulk-wa-detail-err-help">${esc(err.help)}</div></div>`
                : (r.error_message ? `<div class="bulk-wa-detail-err">${esc(r.error_message)}</div>` : '');
            return `<div class="bulk-wa-detail-row is-${klass}">
                <div class="bulk-wa-detail-phone">${esc(r.phone)} ${r.recipient_name ? `<span class="bulk-wa-detail-name">· ${esc(r.recipient_name)}</span>` : ''}</div>
                <div class="bulk-wa-detail-status">${esc(r.status)}</div>${errDisp}
            </div>`;
        };
        let html = '';
        if (failed.length) html += `<h4 class="bulk-wa-detail-section-h">Needs attention (${failed.length})</h4>` + failed.map(r => card(r,'fail')).join('');
        if (inFlight.length) html += `<h4 class="bulk-wa-detail-section-h">In flight (${inFlight.length})</h4>` + inFlight.map(r => card(r,'inflight')).join('');
        if (success.length) html += `<h4 class="bulk-wa-detail-section-h">Delivered (${success.length})</h4>` + success.map(r => card(r,'ok')).join('');
        return html;
    }

    async function loadRecipientsFor(chip) {
        try {
            const resp = await api.request(`/whatsapp/bulk-send/${chip.batchId}/recipients`);
            chip.recipientsCache = (resp && resp.recipients) || [];
        } catch (err) {
            console.error('[BulkWA-Tracker] recipients load failed', err);
            chip.recipientsCache = [];
        }
    }

    // ─── Polling ─────────────────────────────────────────────────

    async function pollOnce(chip) {
        if (chip.dismissed) return;
        try {
            const data = await api.request(`/whatsapp/bulk-send/${chip.batchId}`);
            chip.lastPoll = data;
            // If expanded and we have failures or is-terminal, refresh detail.
            const counts = data.counts || {};
            const hasFailures = (counts.failed || 0) + (counts.skipped || 0) + (counts.cancelled || 0) > 0;
            const isTerminal = ['completed','cancelled','failed'].includes(data.status);
            if (chip.expanded && (hasFailures || isTerminal)) {
                await loadRecipientsFor(chip);
            }
            renderChip(chip);
            // Terminal? stop polling + arm auto-dismiss.
            if (isTerminal) {
                stopPolling(chip);
                armAutoDismiss(chip);
                saveActiveBatchIds(); // remove from persistence
            }
        } catch (err) {
            console.error('[BulkWA-Tracker] poll failed', err);
        }
    }

    function startPolling(chip) {
        if (chip.pollHandle) return;
        pollOnce(chip); // immediate
        chip.pollHandle = setInterval(() => pollOnce(chip), POLL_INTERVAL_MS);
    }

    function stopPolling(chip) {
        if (chip.pollHandle) {
            clearInterval(chip.pollHandle);
            chip.pollHandle = null;
        }
    }

    function armAutoDismiss(chip) {
        if (chip.autoDismissHandle) return;
        chip.autoDismissHandle = setTimeout(() => {
            chip.dismissed = true;
            renderChip(chip);
            chips.delete(chip.batchId);
            saveActiveBatchIds();
        }, AUTO_DISMISS_MS);
    }

    function dismiss(batchId) {
        const chip = chips.get(batchId);
        if (!chip) return;
        stopPolling(chip);
        if (chip.autoDismissHandle) clearTimeout(chip.autoDismissHandle);
        chip.dismissed = true;
        renderChip(chip);
        chips.delete(batchId);
        saveActiveBatchIds();
    }

    async function toggleExpand(batchId) {
        const chip = chips.get(batchId);
        if (!chip) return;
        chip.expanded = !chip.expanded;
        if (chip.expanded && !chip.recipientsCache) {
            renderChip(chip); // show "Loading…"
            await loadRecipientsFor(chip);
        }
        renderChip(chip);
    }

    // ─── Page-load hydration ────────────────────────────────────

    function hydrate() {
        const ids = loadActiveBatchIds();
        if (ids.length === 0) return;
        console.log(`[BulkWA-Tracker] resuming ${ids.length} active batch(es) from previous session`);
        for (const id of ids) track(id);
    }

    // Wait for api.js to load before hydrating (it's required for
    // the poll calls). Listen for DOMContentLoaded and ALSO for the
    // window load event in case the script ordering races api.js.
    function whenReady(fn) {
        if (document.readyState === 'complete' || document.readyState === 'interactive') {
            setTimeout(fn, 0);
        } else {
            document.addEventListener('DOMContentLoaded', fn);
        }
    }
    whenReady(() => {
        // api.js exposes `api` as a global; require it before kicking off.
        if (typeof api !== 'undefined') hydrate();
        else setTimeout(hydrate, 500); // one-shot retry
    });

    // ─── Public surface ──────────────────────────────────────────

    window.bulkWaTrack = track;
    window.bulkWaDismiss = dismiss;
    window.bulkWaToggle = toggleExpand;
})();
