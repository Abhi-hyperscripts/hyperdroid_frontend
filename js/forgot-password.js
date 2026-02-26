// Forgot Password page JavaScript
// Redirect if already logged in
if (typeof api !== 'undefined' && api.isAuthenticated()) {
    window.location.href = 'home.html';
}

const forgotForm = document.getElementById('forgotPasswordForm');
const emailInput = document.getElementById('email');
const submitBtn = document.getElementById('submitBtn');
const forgotCard = document.getElementById('forgotPasswordCard');
const successCard = document.getElementById('successCard');
const sentEmailSpan = document.getElementById('sentEmail');

function setButtonLoading(loading) {
    if (!submitBtn) return;
    if (loading) {
        submitBtn.classList.add('loading');
        submitBtn.disabled = true;
    } else {
        submitBtn.classList.remove('loading');
        submitBtn.disabled = false;
    }
}

async function handleForgotPassword() {
    const email = emailInput.value.trim();

    if (!email) {
        Toast.error('Please enter your email address');
        return;
    }

    setButtonLoading(true);

    try {
        const response = await fetch(`${CONFIG.authApiBaseUrl}/auth/forgot-password`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email })
        });

        const data = await response.json();

        if (data.success) {
            // Show success state
            sentEmailSpan.textContent = email;
            forgotCard.style.display = 'none';
            successCard.style.display = 'block';
        } else {
            Toast.error(data.message || 'Something went wrong. Please try again.');
            setButtonLoading(false);
        }
    } catch (error) {
        Toast.error('Unable to connect to the server. Please try again later.');
        setButtonLoading(false);
    }
}

forgotForm.addEventListener('submit', (e) => {
    e.preventDefault();
    handleForgotPassword();
});
