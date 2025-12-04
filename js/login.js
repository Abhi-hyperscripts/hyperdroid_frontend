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
const swipeHandle = document.getElementById('swipeHandle');
const swipeTrack = swipeHandle?.parentElement;
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

// Initialize swipe button
if (swipeHandle && swipeTrack) {
    let isDragging = false;
    let startX = 0;
    let currentX = 0;
    const trackWidth = swipeTrack.offsetWidth;
    const handleWidth = swipeHandle.offsetWidth;
    const maxDistance = trackWidth - handleWidth - 4;
    const threshold = maxDistance * 0.8;

    // Mouse events
    swipeHandle.addEventListener('mousedown', handleDragStart);
    document.addEventListener('mousemove', handleDragMove);
    document.addEventListener('mouseup', handleDragEnd);

    // Touch events
    swipeHandle.addEventListener('touchstart', handleDragStart, { passive: false });
    document.addEventListener('touchmove', handleDragMove, { passive: false });
    document.addEventListener('touchend', handleDragEnd);

    function handleDragStart(e) {
        isDragging = true;
        swipeTrack.classList.add('swiping');
        startX = e.type === 'mousedown' ? e.clientX : e.touches[0].clientX;
        currentX = swipeHandle.offsetLeft;
    }

    function handleDragMove(e) {
        if (!isDragging) return;
        e.preventDefault();

        const clientX = e.type === 'mousemove' ? e.clientX : e.touches[0].clientX;
        const deltaX = clientX - startX;
        let newX = currentX + deltaX;

        newX = Math.max(2, Math.min(newX, maxDistance + 2));
        swipeHandle.style.left = `${newX}px`;
    }

    function handleDragEnd() {
        if (!isDragging) return;
        isDragging = false;
        swipeTrack.classList.remove('swiping');

        const finalPosition = swipeHandle.offsetLeft;

        if (finalPosition >= threshold) {
            completeSwipe();
        } else {
            resetSwipe();
        }
    }

    function completeSwipe() {
        swipeHandle.style.left = `${maxDistance + 2}px`;
        swipeTrack.classList.add('success');
        setTimeout(() => handleFormSubmit(), 300);
    }

    function resetSwipe() {
        swipeHandle.style.left = '2px';
    }
}

// Form submission
async function handleFormSubmit() {
    const email = emailInput.value.trim();
    const password = passwordInput.value;

    // Hide previous errors
    errorMessage.style.display = 'none';
    errorMessage.classList.remove('show');

    // Basic validation
    if (!email || !password) {
        showError('Please enter both email and password');
        resetSwipeButton();
        return;
    }

    // Show loading state
    const handleText = swipeHandle.querySelector('.handle-text');
    handleText.textContent = 'Signing in...';

    try {
        const response = await api.login(email, password);

        if (response.success) {
            handleText.textContent = 'Success!';
            setTimeout(() => {
                window.location.href = 'home.html';
            }, 500);
        } else {
            showError(response.message || 'Login failed');
            resetSwipeButton();
        }
    } catch (error) {
        showError(error.message || 'An error occurred');
        resetSwipeButton();
    }
}

function showError(message) {
    errorMessage.textContent = message;
    errorMessage.style.display = 'block';
    errorMessage.classList.add('show');
}

function resetSwipeButton() {
    if (swipeHandle && swipeTrack) {
        // Use requestAnimationFrame to ensure smooth transition
        requestAnimationFrame(() => {
            swipeHandle.style.left = '2px';
            swipeTrack.classList.remove('success');
            const handleText = swipeHandle.querySelector('.handle-text');
            handleText.textContent = 'Swipe to Sign In';
        });
    }
}

// Prevent default form submission
loginForm.addEventListener('submit', (e) => {
    e.preventDefault();
});
