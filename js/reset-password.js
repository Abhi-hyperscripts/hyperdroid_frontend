// Reset Password page JavaScript
const params = new URLSearchParams(window.location.search);
const token = params.get('token');
const email = params.get('email');

const errorCard = document.getElementById('errorCard');
const resetCard = document.getElementById('resetCard');
const successCard = document.getElementById('successCard');
const emailDisplay = document.getElementById('emailDisplay');
const resetForm = document.getElementById('resetPasswordForm');
const newPasswordInput = document.getElementById('newPassword');
const confirmPasswordInput = document.getElementById('confirmPassword');
const resetBtn = document.getElementById('resetBtn');

// Show appropriate state based on URL params
if (!token || !email) {
    errorCard.style.display = 'block';
} else {
    resetCard.style.display = 'block';
    emailDisplay.textContent = decodeURIComponent(email);
}

// Toggle password visibility
function setupToggle(btnId, inputId) {
    const btn = document.getElementById(btnId);
    const input = document.getElementById(inputId);
    if (!btn || !input) return;

    btn.addEventListener('click', () => {
        const type = input.type === 'password' ? 'text' : 'password';
        input.type = type;

        const eyeIcon = btn.querySelector('.eye-icon');
        if (type === 'text') {
            eyeIcon.innerHTML = `
                <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                <line x1="1" y1="1" x2="23" y2="23" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            `;
        } else {
            eyeIcon.innerHTML = `
                <path d="M1 12S5 4 12 4s11 8 11 8-4 8-11 8S1 12 1 12z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                <circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            `;
        }
    });
}

setupToggle('toggleNewPassword', 'newPassword');
setupToggle('toggleConfirmPassword', 'confirmPassword');

function setButtonLoading(loading) {
    if (!resetBtn) return;
    if (loading) {
        resetBtn.classList.add('loading');
        resetBtn.disabled = true;
    } else {
        resetBtn.classList.remove('loading');
        resetBtn.disabled = false;
    }
}

// Password strength regex (same as register.js)
const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*])[A-Za-z\d!@#$%^&*]{8,}$/;

async function handleResetPassword() {
    const newPassword = newPasswordInput.value;
    const confirmPassword = confirmPasswordInput.value;

    if (!newPassword || !confirmPassword) {
        Toast.error('Please fill in both password fields');
        return;
    }

    if (newPassword !== confirmPassword) {
        Toast.error('Passwords do not match');
        return;
    }

    if (!passwordRegex.test(newPassword)) {
        Toast.error('Password must be at least 8 characters with uppercase, lowercase, digit, and special character (!@#$%^&*)');
        return;
    }

    setButtonLoading(true);

    try {
        const response = await fetch(`${CONFIG.authApiBaseUrl}/auth/forgot-password/reset`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                email: decodeURIComponent(email),
                token: token,
                newPassword: newPassword
            })
        });

        const data = await response.json();

        if (data.success) {
            // Show success state
            resetCard.style.display = 'none';
            successCard.style.display = 'block';
        } else {
            Toast.error(data.message || 'Failed to reset password. The link may have expired.');
            setButtonLoading(false);
        }
    } catch (error) {
        Toast.error('Unable to connect to the server. Please try again later.');
        setButtonLoading(false);
    }
}

if (resetForm) {
    resetForm.addEventListener('submit', (e) => {
        e.preventDefault();
        handleResetPassword();
    });
}
