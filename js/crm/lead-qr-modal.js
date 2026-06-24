/**
 * Lead QR modal — opens from the lead detail panel's "QR Code" button.
 *
 * Fetches the lead's QR PNG from /api/leads/{id}/qr.png (authenticated)
 * and renders it inline as a blob URL. Includes a Download button that
 * pulls a higher-resolution variant for printing.
 *
 * The QR encodes the public lead-card URL, which works for anyone with
 * the URL (no auth) — that's the point. The token IS the credential and
 * lives only on the server side until a rep generates and shares it.
 */
(function () {
    'use strict';

    let activeBlobUrl = null;
    let activeLeadId = null;
    let activeCardUrl = null;

    /**
     * Server returns the QR PNG with proper Content-Type + ETag, so we
     * can hit the endpoint normally (no special headers) and get a
     * cacheable response. We use the api singleton's fetch path so the
     * Authorization header is attached.
     */
    async function fetchQrPngBlob(leadId, size) {
        // CONFIG.crmApiBaseUrl already includes the /api segment, so
        // concatenating /api/leads/... here would produce /api/api/...
        // and a 404. Pin: base + /leads/... only.
        const base = (typeof CONFIG !== 'undefined' && CONFIG.crmApiBaseUrl)
            ? CONFIG.crmApiBaseUrl
            : (location.hostname === 'localhost' ? 'http://localhost:5112/api' : 'https://crm.ragenaizer.com/api');
        const url = `${base}/leads/${encodeURIComponent(leadId)}/qr.png?size=${size}`;
        // Use the global getAuthToken() helper exposed by config.js /
        // api.js — same token the rest of the app uses, picks up
        // refreshes too. Fall back to localStorage only if the helper
        // isn't loaded (shouldn't happen on the leads page).
        const token = (typeof getAuthToken === 'function') ? getAuthToken() : localStorage.getItem('token');
        const resp = await fetch(url, {
            headers: token ? { 'Authorization': `Bearer ${token}` } : {},
        });
        if (!resp.ok) {
            throw new Error(`QR fetch failed: HTTP ${resp.status}`);
        }
        return await resp.blob();
    }

    /**
     * Probe the lead-card public URL via the server's rotate endpoint?
     * No — we instead derive the URL from the lead's id by looking at
     * an already-returned response. Cleaner: server returns the URL in
     * a header. For v1 just compute it from the deployed CRM config.
     *
     * Actually simplest: server-render the QR is sufficient. The URL
     * preview below is for the rep's visual reference; if Card Token
     * is exposed via /api/leads/{id} response, use that.
     */
    function publicCardUrl(token) {
        const fe = (typeof CONFIG !== 'undefined' && CONFIG.frontendDomain)
            ? CONFIG.frontendDomain
            : (location.protocol + '//' + location.host);
        return `${fe}/pages/lead-card.html?t=${encodeURIComponent(token)}`;
    }

    async function openLeadQrModal(leadId) {
        if (!leadId) return;
        activeLeadId = leadId;
        const modal = document.getElementById('leadQrModal');
        const wrap = document.getElementById('leadQrImageWrap');
        const urlPreview = document.getElementById('leadQrUrlPreview');
        if (!modal || !wrap) return;

        // Reset state on every open. Revoke any prior blob URL so we
        // don't leak memory across multiple opens in the same session.
        if (activeBlobUrl) { URL.revokeObjectURL(activeBlobUrl); activeBlobUrl = null; }
        wrap.innerHTML = '<span style="color:#64748b;font-size:13px;">Loading…</span>';
        urlPreview.textContent = '';
        activeCardUrl = null;
        const copyBtn = document.getElementById('leadQrCopyLinkBtn');
        if (copyBtn) {
            copyBtn.disabled = true;
            // Reset label state on every open in case a previous open
            // left it stuck on "Copied!" from a clipboard write.
            copyBtn.innerHTML = copyBtn.dataset.defaultHtml || copyBtn.innerHTML;
            if (!copyBtn.dataset.defaultHtml) copyBtn.dataset.defaultHtml = copyBtn.innerHTML;
        }
        // Match the leads.html openModal() pattern: clear the inline
        // display:none, then add gm-animating + active classes so the
        // page's existing .modal CSS handles position, centering, and
        // backdrop. Setting style.display='flex' directly bypassed the
        // page's overrides and left the dialog stuck top-left.
        modal.style.display = '';
        modal.classList.add('gm-animating');
        requestAnimationFrame(() => modal.classList.add('active'));

        try {
            // Fetch the lead so we have the card_token for the URL
            // preview. The QR itself is rendered server-side; we just
            // mirror the URL for the rep's benefit.
            const lead = await api.request(`/crm/leads/${leadId}`);
            const cardToken = lead?.card_token;
            if (cardToken) {
                activeCardUrl = publicCardUrl(cardToken);
                urlPreview.textContent = activeCardUrl;
                if (copyBtn) copyBtn.disabled = false;
            }

            const blob = await fetchQrPngBlob(leadId, 320);
            activeBlobUrl = URL.createObjectURL(blob);
            wrap.innerHTML = `<img src="${activeBlobUrl}" alt="Lead QR code" style="max-width:280px;width:100%;height:auto;display:block;">`;
        } catch (err) {
            wrap.innerHTML = `<span style="color:#dc2626;font-size:13px;">Could not load QR — ${escapeHtml(err.message || 'try again')}</span>`;
        }
    }

    function closeLeadQrModal() {
        const modal = document.getElementById('leadQrModal');
        if (modal) {
            // Mirror leads.js closeModal(): drop the active class to
            // trigger the close animation, then strip gm-animating
            // after the transition completes. We also reapply
            // display:none after the animation so the modal doesn't
            // intercept clicks while hidden.
            modal.classList.remove('active');
            setTimeout(() => {
                modal.classList.remove('gm-animating');
                modal.style.display = 'none';
            }, 200);
        }
        if (activeBlobUrl) { URL.revokeObjectURL(activeBlobUrl); activeBlobUrl = null; }
        activeLeadId = null;
        activeCardUrl = null;
    }

    async function copyLeadCardLink() {
        if (!activeCardUrl) return;
        const copyBtn = document.getElementById('leadQrCopyLinkBtn');
        let ok = false;
        try {
            // Modern path — needs HTTPS or localhost. Will throw on http
            // pages, which is why we fall back to execCommand below.
            if (navigator.clipboard && navigator.clipboard.writeText) {
                await navigator.clipboard.writeText(activeCardUrl);
                ok = true;
            }
        } catch (_) { /* fall through to legacy path */ }
        if (!ok) {
            // Legacy path for http contexts (some self-hosted CRMs).
            // textarea + execCommand still works in every browser.
            const ta = document.createElement('textarea');
            ta.value = activeCardUrl;
            ta.style.position = 'fixed';
            ta.style.left = '-9999px';
            document.body.appendChild(ta);
            ta.select();
            try { ok = document.execCommand('copy'); } catch (_) { ok = false; }
            document.body.removeChild(ta);
        }
        if (copyBtn) {
            const defaultHtml = copyBtn.dataset.defaultHtml || copyBtn.innerHTML;
            if (ok) {
                copyBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:4px;"><polyline points="20 6 9 17 4 12"/></svg>Copied`;
                setTimeout(() => { copyBtn.innerHTML = defaultHtml; }, 1600);
            }
        }
        if (typeof Toast !== 'undefined') {
            if (ok) Toast.success('Link copied'); else Toast.error('Could not copy link');
        }
    }

    async function downloadLeadQr() {
        if (!activeLeadId) return;
        try {
            // 600px for crisp printing. Server clamps to 1024 so this
            // is safe regardless of what we ask for.
            const blob = await fetchQrPngBlob(activeLeadId, 600);
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `lead-qr-${activeLeadId.slice(0, 8)}.png`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            // Revoke after a tick so the click actually fires before
            // the URL becomes invalid. 100ms is a safe margin.
            setTimeout(() => URL.revokeObjectURL(url), 1000);
        } catch (err) {
            if (typeof Toast !== 'undefined') Toast.error(err.message || 'Download failed');
        }
    }

    function escapeHtml(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    // Wire the modal buttons once the DOM is ready.
    document.addEventListener('DOMContentLoaded', () => {
        const btn = document.getElementById('leadQrDownloadBtn');
        if (btn) btn.addEventListener('click', downloadLeadQr);
        const copyBtn = document.getElementById('leadQrCopyLinkBtn');
        if (copyBtn) copyBtn.addEventListener('click', copyLeadCardLink);
    });

    // Public surface — referenced by inline onclick handlers in
    // leads.html. Mirrors how the other lead-action modals are exposed.
    window.openLeadQrModal = openLeadQrModal;
    window.closeLeadQrModal = closeLeadQrModal;
})();
