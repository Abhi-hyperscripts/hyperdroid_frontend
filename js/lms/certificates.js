/**
 * LMS Certificates
 * Displays earned certificates, download PDF, share, and verify.
 */

// ==================== State ====================
let certificates = [];

// ==================== Initialization ====================

document.addEventListener('DOMContentLoaded', () => {
    Navigation.init('lms', '../');

    if (!api.isAuthenticated()) {
        window.location.href = '../login.html';
        return;
    }

    loadCertificates();
});

// ==================== Load Certificates ====================

async function loadCertificates() {
    try {
        const response = await api.request('/lms/certificates/my');
        certificates = response.data || response || [];
        renderCertificateGrid();
    } catch (err) {
        console.error('Failed to load certificates:', err);
        document.getElementById('certificateGrid').innerHTML =
            '<div class="lms-empty-state"><p style="color:var(--color-error);">Failed to load certificates.</p></div>';
    }
}

// ==================== Render Grid ====================

function renderCertificateGrid() {
    const container = document.getElementById('certificateGrid');

    if (certificates.length === 0) {
        container.innerHTML = `
            <div class="lms-empty-state" style="grid-column: 1 / -1;">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" stroke-width="1.5">
                    <circle cx="12" cy="8" r="7"/>
                    <polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88"/>
                </svg>
                <h3 style="margin-top: var(--space-3);">No Certificates Yet</h3>
                <p>Complete courses to earn certificates.</p>
                <a href="catalog.html" class="btn btn-primary" style="margin-top: var(--space-3);">Browse Courses</a>
            </div>
        `;
        return;
    }

    container.innerHTML = certificates.map(cert => {
        const issuedDate = cert.issued_at || cert.issued_date
            ? new Date(cert.issued_at || cert.issued_date).toLocaleDateString()
            : '-';
        const certNumber = cert.certificate_number || cert.number || '-';

        return `
            <div class="lms-course-card" style="cursor: default;">
                <!-- Certificate Visual -->
                <div style="background: linear-gradient(135deg, var(--bg-tertiary) 0%, var(--bg-secondary) 100%);
                            padding: var(--space-6) var(--space-4); text-align: center; border-bottom: 1px solid var(--border-primary);">
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--brand-primary)" stroke-width="1.5">
                        <circle cx="12" cy="8" r="7"/>
                        <polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88"/>
                    </svg>
                    <p style="color: var(--text-muted); font-size: var(--font-size-xs); margin-top: var(--space-2);">Certificate of Completion</p>
                </div>

                <!-- Certificate Info -->
                <div style="padding: var(--space-4);">
                    <h4 style="color: var(--text-primary); margin: 0 0 var(--space-2) 0; font-size: var(--font-size-base);">
                        ${cert.course_title || cert.title || 'Course'}
                    </h4>
                    <div style="display: flex; flex-direction: column; gap: var(--space-1); margin-bottom: var(--space-4);">
                        <span style="color: var(--text-muted); font-size: var(--font-size-sm);">
                            Issued: ${issuedDate}
                        </span>
                        <span style="color: var(--text-muted); font-size: var(--font-size-xs); font-family: monospace;">
                            ${certNumber}
                        </span>
                    </div>

                    <div style="display: flex; gap: var(--space-2);">
                        <button class="btn btn-primary btn-sm" onclick="downloadPdf('${cert.id}')" style="flex: 1;">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                                <polyline points="7 10 12 15 17 10"/>
                                <line x1="12" y1="15" x2="12" y2="3"/>
                            </svg>
                            PDF
                        </button>
                        <button class="btn btn-outline-primary btn-sm" onclick="shareCertificate('${cert.id}', '${certNumber}')" style="flex: 1;">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/>
                                <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/>
                                <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
                            </svg>
                            Share
                        </button>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

// ==================== Download PDF ====================

async function downloadPdf(certId) {
    try {
        const response = await api.request(`/lms/certificates/${certId}/pdf`, {
            responseType: 'blob'
        });

        // Handle blob download
        const blob = response instanceof Blob ? response : new Blob([response], { type: 'application/pdf' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `certificate-${certId}.pdf`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
    } catch (err) {
        console.error('Failed to download certificate:', err);
        if (typeof showToast === 'function') showToast('Failed to download certificate.', 'error');
    }
}

// ==================== Share ====================

function shareCertificate(certId, certNumber) {
    const verifyUrl = `${window.location.origin}/pages/lms/certificates.html?verify=${encodeURIComponent(certNumber)}`;

    if (navigator.share) {
        navigator.share({
            title: 'Course Certificate',
            text: `I earned a certificate! Verify it with number: ${certNumber}`,
            url: verifyUrl
        }).catch(() => {});
    } else {
        // Fallback: copy to clipboard
        navigator.clipboard.writeText(verifyUrl).then(() => {
            if (typeof showToast === 'function') showToast('Verification link copied to clipboard!', 'success');
        }).catch(() => {
            if (typeof showToast === 'function') showToast('Failed to copy link.', 'error');
        });
    }
}

// ==================== Verify Certificate ====================

async function verifyCertificate() {
    const input = document.getElementById('verifyCertNumber');
    const number = input.value.trim();
    if (!number) {
        if (typeof showToast === 'function') showToast('Please enter a certificate number.', 'warning');
        return;
    }

    const resultDiv = document.getElementById('verifyResult');
    resultDiv.style.display = '';
    resultDiv.innerHTML = '<p style="color: var(--text-muted);">Verifying...</p>';

    try {
        const result = await api.request(`/lms/certificates/verify/${encodeURIComponent(number)}`);

        if (result && result.valid) {
            resultDiv.innerHTML = `
                <div style="background: var(--bg-tertiary); border-left: 3px solid var(--color-success); padding: var(--space-4); border-radius: var(--radius-md);">
                    <div style="display: flex; align-items: center; gap: var(--space-2); margin-bottom: var(--space-2);">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--color-success)" stroke-width="2">
                            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>
                        </svg>
                        <strong style="color: var(--color-success);">Valid Certificate</strong>
                    </div>
                    <p style="color: var(--text-secondary); font-size: var(--font-size-sm); margin: 0;">
                        <strong>${result.holder_name || 'Learner'}</strong> completed
                        <strong>${result.course_title || 'a course'}</strong>
                        on ${result.issued_date ? new Date(result.issued_date).toLocaleDateString() : '-'}.
                    </p>
                </div>
            `;
        } else {
            resultDiv.innerHTML = `
                <div style="background: var(--bg-tertiary); border-left: 3px solid var(--color-error); padding: var(--space-4); border-radius: var(--radius-md);">
                    <div style="display: flex; align-items: center; gap: var(--space-2);">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--color-error)" stroke-width="2">
                            <circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>
                        </svg>
                        <strong style="color: var(--color-error);">Invalid Certificate</strong>
                    </div>
                    <p style="color: var(--text-secondary); font-size: var(--font-size-sm); margin-top: var(--space-2);">
                        No certificate found with this number.
                    </p>
                </div>
            `;
        }
    } catch (err) {
        console.error('Failed to verify certificate:', err);
        resultDiv.innerHTML = `<p style="color: var(--color-error);">Verification failed. Please try again.</p>`;
    }
}

// ==================== Auto-verify from URL ====================

(function checkUrlVerify() {
    const params = new URLSearchParams(window.location.search);
    const verifyNumber = params.get('verify');
    if (verifyNumber) {
        // Wait for DOM + scripts to load, then auto-verify
        window.addEventListener('load', () => {
            document.getElementById('verifyCertNumber').value = verifyNumber;
            verifyCertificate();
            // Scroll to verify section
            document.getElementById('verifyCertNumber').scrollIntoView({ behavior: 'smooth', block: 'center' });
        });
    }
})();
