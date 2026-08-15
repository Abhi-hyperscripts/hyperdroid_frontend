/**
 * Rep coaching scoreboard — Calls Inbox
 * ----------------------------------------------------------------------------
 * A Hangfire job scores every recorded call against a rubric and writes the
 * result to lead_call_scores. The per-call grade was reachable; the aggregate
 * that answers "who needs coaching this week" was not — GET /api/Calls/rep-scores
 * had no caller anywhere in the app.
 *
 *   GET /api/Calls/rep-scores?from=&to=   → { from, to, items: [...] }
 *
 * Backend sorts ASC by average, i.e. worst first. That is deliberate — the
 * point of the list is coaching, not a leaderboard — so this preserves the
 * server's order rather than re-sorting to flatter it.
 *
 * Field names come from RepScoreAggregate via SnakeCaseLower, NOT from the SQL
 * aliases: the column is `avg_total`, the wire field is `avg_total_score`.
 *
 * Admin-only endpoint (CRM_ADMIN / SUPERADMIN). A 403 hides the section rather
 * than showing an error — a rep has no business seeing an access failure for a
 * feature that was never offered to them.
 */
const RepScores = (() => {
    'use strict';

    const esc = (t) => String(t ?? '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

    const RANGES = [
        { days: 7,  label: '7 days' },
        { days: 30, label: '30 days' },
        { days: 90, label: '90 days' }
    ];

    let _host = null;
    let _days = 7;
    let _userMap = null;
    let _bound = false;

    // Grade band from the 0-100 total. Mirrors the rubric's own A–F cut points
    // so a rep's row colour agrees with the letter on their individual calls.
    function band(score) {
        if (score >= 85) return { cls: 'rs-a', label: 'A' };
        if (score >= 70) return { cls: 'rs-b', label: 'B' };
        if (score >= 55) return { cls: 'rs-c', label: 'C' };
        if (score >= 40) return { cls: 'rs-d', label: 'D' };
        return { cls: 'rs-f', label: 'F' };
    }

    async function userMap() {
        if (_userMap) return _userMap;
        try {
            const users = await api.request('/crm/teams/users?includeInactive=true');
            _userMap = new Map();
            (users || []).forEach(u => {
                if (u.user_id) _userMap.set(u.user_id, u.display_name || u.email || u.user_id);
            });
        } catch (e) {
            console.warn('[rep-scores] user map failed:', e?.message || e);
            _userMap = new Map();
        }
        return _userMap;
    }

    function shell() {
        return `
        <details class="rs" id="repScoresDetails">
            <summary class="rs-summary">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 3v18h18"/><rect x="7" y="12" width="3" height="6"/><rect x="12" y="8" width="3" height="10"/><rect x="17" y="4" width="3" height="14"/></svg>
                <span class="rs-summary-text">Coaching scoreboard</span>
                <span class="rs-summary-hint">AI call scores by rep</span>
                <svg class="rs-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
            </summary>
            <div class="rs-body">
                <div class="rs-head">
                    <p class="rs-lede">
                        Every recorded call is scored against your rubric. Reps are listed
                        <strong>lowest average first</strong> — the top of this list is where coaching pays off.
                    </p>
                    <div class="rs-ranges" role="group" aria-label="Date range">
                        ${RANGES.map(r => `<button type="button" class="rs-range${r.days === _days ? ' active' : ''}"
                                data-rs="range" data-days="${r.days}">${r.label}</button>`).join('')}
                    </div>
                </div>
                <div class="rs-list" data-rs="list"></div>
            </div>
        </details>`;
    }

    function rowMarkup(r, name) {
        const avg = Number(r.avg_total_score || 0);
        const b = band(avg);
        const calls = Number(r.calls || 0);
        const good = Number(r.good_calls || 0);
        const bad = Number(r.bad_calls || 0);
        // Percentages are of scored calls, which is what `calls` counts — an
        // unscored call never reaches this table, so this cannot read as
        // "12% of everything they did".
        const goodPct = calls ? Math.round((good / calls) * 100) : 0;
        return `
        <div class="rs-row">
            <div class="rs-rep">
                <span class="rs-avatar ${b.cls}">${b.label}</span>
                <span class="rs-name">${esc(name)}</span>
            </div>
            <div class="rs-score">
                <span class="rs-score-num ${b.cls}">${avg}</span>
                <span class="rs-score-of">/ 100 avg</span>
            </div>
            <div class="rs-bar" role="img" aria-label="${goodPct}% of ${calls} scored calls graded A or B">
                <span class="rs-bar-fill ${b.cls}" style="width: ${Math.max(2, Math.min(100, avg))}%"></span>
            </div>
            <div class="rs-counts">
                <span class="rs-count"><strong>${calls}</strong> scored</span>
                <span class="rs-count rs-good"><strong>${good}</strong> A/B</span>
                ${bad ? `<span class="rs-count rs-bad"><strong>${bad}</strong> F</span>` : ''}
            </div>
        </div>`;
    }

    async function load() {
        if (!_host) return;
        const list = _host.querySelector('[data-rs="list"]');
        if (!list) return;
        list.innerHTML = '<p class="rs-state">Loading scores…</p>';

        const to = new Date();
        const from = new Date(to.getTime() - _days * 86400000);
        try {
            const [res, names] = await Promise.all([
                api.request(`/crm/calls/rep-scores?from=${from.toISOString()}&to=${to.toISOString()}`),
                userMap()
            ]);
            const items = Array.isArray(res) ? res : (res?.items || []);
            list.innerHTML = items.length
                ? items.map(r => rowMarkup(r, names.get(r.rep_user_id) || r.rep_user_id)).join('')
                : `<p class="rs-state">No scored calls in this window.
                     Calls are scored automatically once a recording finishes transcribing —
                     try a longer range, or check that call recording is on for your numbers.</p>`;
        } catch (e) {
            // 403 = not an admin. The section should not have been offered at
            // all, so retire it rather than explain the refusal.
            if (String(e.status) === '403' || /forbidden/i.test(e.message || '')) {
                _host.style.display = 'none';
                return;
            }
            console.error('[rep-scores] load failed:', e);
            list.innerHTML = `<p class="rs-state">Could not load scores. ${esc(e.message || '')}</p>`;
        }
    }

    function mount(host) {
        if (!host) return;
        _host = host;
        host.innerHTML = shell();

        if (!_bound) {
            _bound = true;
            host.addEventListener('click', (e) => {
                const btn = e.target.closest('[data-rs="range"]');
                if (!btn) return;
                _days = Number(btn.getAttribute('data-days')) || 7;
                host.querySelectorAll('.rs-range').forEach(b =>
                    b.classList.toggle('active', b === btn));
                load();
            });
            // Fetch on first expand, not on page load — the scoreboard is a
            // secondary view and the inbox below it is what the page is for.
            host.addEventListener('toggle', (e) => {
                if (e.target.id === 'repScoresDetails' && e.target.open && !e.target.dataset.loaded) {
                    e.target.dataset.loaded = '1';
                    load();
                }
            }, true);
        }
    }

    return { mount, reload: load };
})();
