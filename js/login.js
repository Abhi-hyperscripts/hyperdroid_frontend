// Login page JavaScript
// Redirect if already authenticated
if (api.isAuthenticated()) {
    window.location.href = 'home.html';
}

// DOM Elements
const loginForm = document.getElementById('loginForm');
const emailInput = document.getElementById('email');
const passwordInput = document.getElementById('password');
const togglePasswordBtn = document.getElementById('togglePassword');
const loginBtn = document.getElementById('loginBtn');
const errorMessage = document.getElementById('errorMessage');

// Detect browser autofill and adjust input styling
function detectAutofill() {
    const inputs = document.querySelectorAll('.form-input');
    inputs.forEach(input => {
        const wrapper = input.closest('.input-wrapper');
        if (!wrapper) return;

        // Check if input has been autofilled
        const checkAutofill = () => {
            try {
                // Safari/Chrome autofill detection
                const isAutofilled = input.matches(':-webkit-autofill') ||
                                    input.matches(':autofill') ||
                                    (input.value && window.getComputedStyle(input).backgroundColor !== 'rgba(255, 255, 255, 0.9)');

                if (isAutofilled || input.value) {
                    wrapper.classList.add('autofilled');
                } else {
                    wrapper.classList.remove('autofilled');
                }
            } catch (e) {
                // Fallback: just check if there's a value
                if (input.value) {
                    wrapper.classList.add('autofilled');
                } else {
                    wrapper.classList.remove('autofilled');
                }
            }
        };

        // Check on various events
        input.addEventListener('input', checkAutofill);
        input.addEventListener('change', checkAutofill);
        input.addEventListener('focus', checkAutofill);
        input.addEventListener('blur', checkAutofill);

        // Check after a delay for browser autofill
        setTimeout(checkAutofill, 100);
        setTimeout(checkAutofill, 500);
        setTimeout(checkAutofill, 1000);
    });
}

// Run autofill detection
detectAutofill();

// Toggle password visibility
togglePasswordBtn?.addEventListener('click', () => {
    const type = passwordInput.type === 'password' ? 'text' : 'password';
    passwordInput.type = type;

    const eyeIcon = togglePasswordBtn.querySelector('.eye-icon');
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

// Form submission
async function handleFormSubmit() {
    const email = emailInput.value.trim();
    const password = passwordInput.value;

    // Hide previous errors
    errorMessage.style.display = 'none';
    errorMessage.classList.remove('show');

    // Basic validation
    if (!email || !password) {
        Toast.error('Please enter both email and password');
        return;
    }

    // Show loading state
    setButtonLoading(true);

    try {
        const response = await api.login(email, password);

        if (response.success) {
            setButtonSuccess();

            // Request notification permission before redirect.
            // This ONLY shows the browser prompt — no Firebase loading.
            // Race with 5s timeout as safety net.
            if (typeof requestNotificationPermissionOnly === 'function') {
                try {
                    await Promise.race([
                        requestNotificationPermissionOnly(),
                        new Promise(resolve => setTimeout(resolve, 5000))
                    ]);
                } catch (e) {
                    console.warn('[Login] Notification permission request failed:', e);
                }
            }

            // Force FCM re-registration on next page load so backend gets the freshest token
            if (typeof forceRegistrationOnNextLoad === 'function') {
                forceRegistrationOnNextLoad();
            }

            // Redirect immediately — full FCM registration happens on home.html / navigation.js
            window.location.href = 'home.html';
        } else {
            Toast.error(response.message || 'Login failed');
            setButtonLoading(false);
        }
    } catch (error) {
        Toast.error(error.message || 'An error occurred');
        setButtonLoading(false);
    }
}

function setButtonLoading(loading) {
    if (loginBtn) {
        if (loading) {
            loginBtn.classList.add('loading');
            loginBtn.disabled = true;
        } else {
            loginBtn.classList.remove('loading');
            loginBtn.disabled = false;
        }
    }
}

function setButtonSuccess() {
    if (loginBtn) {
        loginBtn.classList.remove('loading');
        loginBtn.classList.add('success');
        const btnText = loginBtn.querySelector('.btn-text');
        if (btnText) {
            btnText.textContent = 'Success!';
        }
    }
}

// Form submission handler
loginForm.addEventListener('submit', (e) => {
    e.preventDefault();
    handleFormSubmit();
});

// Also handle button click directly
loginBtn?.addEventListener('click', (e) => {
    e.preventDefault();
    handleFormSubmit();
});
