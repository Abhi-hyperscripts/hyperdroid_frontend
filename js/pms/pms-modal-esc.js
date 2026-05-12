// ── PMS Global ESC handler ────────────────────────────────────────────
// Closes the topmost open modal on ESC. Triggers the modal's own close
// button so per-modal cleanup functions (resetting forms, clearing state)
// still run.
document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    const active = Array.from(document.querySelectorAll('.modal.active, .gm-overlay:not([hidden])')).pop();
    if (!active) return;
    const closeBtn = active.querySelector('.close-btn, .gm-close, .btn-secondary[onclick*="close"]');
    if (closeBtn) {
        e.preventDefault();
        closeBtn.click();
    }
});
