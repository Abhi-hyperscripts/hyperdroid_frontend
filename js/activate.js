/**
 * ACTIVATE PAGE SCRIPT
 * ====================
 * Handles tenant license activation.
 * Validates license key and displays activation results.
 */

/**
 * Copy text to clipboard with visual feedback
 * @param {string} elementId - ID of the element containing text to copy
 */
function copyToClipboard(elementId) {
    const text = document.getElementById(elementId).textContent;
    navigator.clipboard.writeText(text).then(() => {
        // Show a brief visual feedback
        const btn = event.currentTarget;
        const originalColor = btn.style.color;
        btn.style.color = 'var(--status-approved)';
        setTimeout(() => {
            btn.style.color = originalColor;
        }, 500);
    }).catch(err => {
        console.error('Failed to copy:', err);
    });
}

/**
 * Display error message
 * @param {string} message - Error message to display
 * @param {HTMLElement} errorElement - Error message element
 */
function showActivationError(message, errorElement) {
    errorElement.textContent = message;
    errorElement.style.display = 'block';
}

/**
 * Display success card with activation details
 * @param {Object} data - Activation response data
 * @param {HTMLElement} activationForm - Form element to hide
 * @param {HTMLElement} successCard - Success card element to show
 */
function showActivationSuccess(data, activationForm, successCard) {
    // Hide activation form, show success card
    activationForm.style.display = 'none';
    successCard.style.display = 'block';

    // Populate success card with data
    const displayName = data.organizationName || data.tenantName;
    document.getElementById('tenantNameDisplay').textContent =
        `"${displayName}" has been successfully activated.`;
    document.getElementById('adminEmail').textContent = data.superAdminEmail;
    document.getElementById('adminPassword').textContent = data.generatedPassword;

    // Populate license info
    document.getElementById('infoOrgName').textContent = data.organizationName || '-';
    document.getElementById('infoTenantName').textContent = data.tenantName;
    document.getElementById('infoGeneratedAt').textContent =
        data.generatedAt ? new Date(data.generatedAt).toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        }) : '-';
    document.getElementById('infoExpiry').textContent =
        new Date(data.expiryDate).toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });
    document.getElementById('infoMaxUsers').textContent =
        data.maxUsers === -1 ? 'Unlimited' : data.maxUsers;

    // Populate services
    const servicesList = document.getElementById('servicesList');
    servicesList.innerHTML = '';
    if (data.services && data.services.length > 0) {
        data.services.forEach(service => {
            const badge = document.createElement('span');
            badge.className = 'service-badge';
            badge.textContent = service;
            servicesList.appendChild(badge);
        });
    } else {
        servicesList.innerHTML = '<span class="text-muted">All services</span>';
    }
}

/**
 * Get the activate button HTML content
 * @param {boolean} loading - Whether to show loading state
 * @returns {string} Button inner HTML
 */
function getActivateButtonContent(loading = false) {
    if (loading) {
        return '<div class="spinner"></div> Activating...';
    }
    return `
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M15 3H19C19.5304 3 20.0391 3.21071 20.4142 3.58579C20.7893 3.96086 21 4.46957 21 5V19C21 19.5304 20.7893 20.0391 20.4142 20.4142C20.0391 20.7893 19.5304 21 19 21H15" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M10 17L15 12L10 7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M15 12H3" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        Activate License
    `;
}

/**
 * Initialize activation page
 */
function initActivatePage() {
    const form = document.getElementById('licenseForm');
    const activateBtn = document.getElementById('activateBtn');
    const errorMessage = document.getElementById('errorMessage');
    const activationForm = document.getElementById('activationForm');
    const successCard = document.getElementById('successCard');

    if (!form) {
        console.error('License form not found');
        return;
    }

    form.addEventListener('submit', async function(e) {
        e.preventDefault();

        const licenseKey = document.getElementById('licenseKey').value.trim();

        if (!licenseKey) {
            showActivationError('Please paste your license key.', errorMessage);
            return;
        }

        // Show loading state
        activateBtn.disabled = true;
        activateBtn.innerHTML = getActivateButtonContent(true);
        errorMessage.style.display = 'none';

        try {
            // Call the activation API
            const response = await fetch(`${CONFIG.authApiBaseUrl}/auth/activate-tenant`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    licenseKey: licenseKey
                })
            });

            const data = await response.json();

            if (response.ok && data.success) {
                // Show success card
                showActivationSuccess(data, activationForm, successCard);
            } else {
                showActivationError(
                    data.message || 'Failed to activate license. Please check your license key and try again.',
                    errorMessage
                );
            }
        } catch (error) {
            console.error('Activation error:', error);
            showActivationError('Network error. Please check your connection and try again.', errorMessage);
        } finally {
            // Reset button state
            activateBtn.disabled = false;
            activateBtn.innerHTML = getActivateButtonContent(false);
        }
    });
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', initActivatePage);
