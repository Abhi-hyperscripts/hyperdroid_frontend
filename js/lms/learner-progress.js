/**
 * What the learner has earned — points, streak, badges and skills.
 *
 * Four endpoints (points/mine, badges/mine, skills/mine, badges) had no caller,
 * so a learner could earn points and badges on every course completion and never
 * see any of it. The gamification existed entirely server-side.
 */

async function loadLearnerProgress() {
    const host = document.getElementById('learnerProgressPanel');
    if (!host) return;
    host.innerHTML = '<div class="lms-empty-state"><p>Loading…</p></div>';

    // Asked for together, and each failure isolated: a learner with no skills yet
    // must still see their points rather than an error for the whole panel.
    const [points, badges, skills, catalogue] = await Promise.all([
        api.request('/lms/learning/points/mine').catch(() => null),
        api.request('/lms/learning/badges/mine').catch(() => []),
        api.request('/lms/learning/skills/mine').catch(() => []),
        api.request('/lms/learning/badges').catch(() => [])
    ]);

    const earnedCodes = new Set((badges || []).map(b => b.code));
    const locked = (catalogue || []).filter(b => !earnedCodes.has(b.code));

    host.innerHTML = `
        <div class="progress-stats">
            <div class="progress-stat">
                <div class="progress-stat-value">${points ? (points.points ?? 0) : 0}</div>
                <div class="progress-stat-label">Points</div>
            </div>
            <div class="progress-stat">
                <div class="progress-stat-value">${points ? (points.streakDays ?? 0) : 0}</div>
                <div class="progress-stat-label">Day streak</div>
            </div>
            <div class="progress-stat">
                <div class="progress-stat-value">${(badges || []).length}</div>
                <div class="progress-stat-label">Badges</div>
            </div>
            <div class="progress-stat">
                <div class="progress-stat-value">${(skills || []).length}</div>
                <div class="progress-stat-label">Skills</div>
            </div>
        </div>

        <div class="progress-columns">
            <div class="progress-column">
                <h4 class="progress-column-title">Badges</h4>
                ${(badges || []).length === 0 && locked.length === 0
                    ? '<p class="text-muted progress-empty">No badges are set up yet.</p>'
                    : `<div class="badge-grid">
                        ${(badges || []).map(b => `
                            <div class="badge-chip earned" title="${lpEsc(b.description || '')}">
                                <span class="badge-chip-icon">${lpEsc(b.icon || '★')}</span>
                                <span class="badge-chip-name">${lpEsc(b.name)}</span>
                            </div>`).join('')}
                        ${locked.map(b => `
                            <div class="badge-chip locked" title="${lpEsc(lpCriteria(b))}">
                                <span class="badge-chip-icon">${lpEsc(b.icon || '★')}</span>
                                <span class="badge-chip-name">${lpEsc(b.name)}</span>
                            </div>`).join('')}
                       </div>`}
            </div>

            <div class="progress-column">
                <h4 class="progress-column-title">Skills</h4>
                ${(skills || []).length === 0
                    ? '<p class="text-muted progress-empty">Finish a course that grants a skill and it appears here.</p>'
                    : `<div class="skill-list">
                        ${skills.map(s => `
                            <div class="skill-row">
                                <span class="skill-name">${lpEsc(s.name)}</span>
                                ${s.category ? `<span class="skill-category">${lpEsc(s.category)}</span>` : ''}
                                <span class="skill-level" title="Level ${s.level} of 5">
                                    ${'●'.repeat(Math.max(0, Math.min(5, s.level)))}${'○'.repeat(Math.max(0, 5 - s.level))}
                                </span>
                            </div>`).join('')}
                       </div>`}
            </div>
        </div>`;
}

/** Says what an unearned badge is FOR, so a locked chip is an invitation rather than a tease. */
function lpCriteria(b) {
    switch (b.criteriaType) {
        case 'courses_completed': return `Complete ${b.criteriaValue} course(s)`;
        case 'streak_days':       return `Keep a ${b.criteriaValue}-day streak`;
        case 'points':            return `Earn ${b.criteriaValue} points`;
        case 'perfect_score':     return 'Score full marks on a quiz';
        default:                  return b.description || 'Awarded by an administrator';
    }
}

function lpEsc(t) {
    if (t === null || t === undefined) return '';
    const d = document.createElement('div');
    d.textContent = String(t);
    return d.innerHTML;
}
