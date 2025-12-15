// Register page JavaScript
// Redirect if already authenticated
if (api.isAuthenticated()) {
    window.location.href = 'home.html';
}

// DOM Elements
const registerForm = document.getElementById('registerForm');
const firstNameInput = document.getElementById('firstName');
const lastNameInput = document.getElementById('lastName');
const emailInput = document.getElementById('email');
const passwordInput = document.getElementById('password');
const confirmPasswordInput = document.getElementById('confirmPassword');
const togglePasswordBtn = document.getElementById('togglePassword');
const toggleConfirmPasswordBtn = document.getElementById('toggleConfirmPassword');
const swipeHandle = document.getElementById('swipeHandle');
const swipeTrack = swipeHandle?.parentElement;
const errorMessage = document.getElementById('errorMessage');
const successMessage = document.getElementById('successMessage');

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

// Toggle confirm password visibility
toggleConfirmPasswordBtn?.addEventListener('click', () => {
    const type = confirmPasswordInput.type === 'password' ? 'text' : 'password';
    confirmPasswordInput.type = type;

    const eyeIcon = toggleConfirmPasswordBtn.querySelector('.eye-icon');
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
    const firstName = firstNameInput.value.trim();
    const lastName = lastNameInput.value.trim();
    const email = emailInput.value.trim();
    const password = passwordInput.value;
    const confirmPassword = confirmPasswordInput.value;

    // Hide previous messages
    errorMessage.style.display = 'none';
    errorMessage.classList.remove('show');
    successMessage.style.display = 'none';
    successMessage.classList.remove('show');

    // Basic validation
    if (!firstName || !lastName || !email || !password || !confirmPassword) {
        Toast.error('Please fill in all fields');
        resetSwipeButton();
        return;
    }

    // Password matching validation
    if (password !== confirmPassword) {
        Toast.error('Passwords do not match');
        resetSwipeButton();
        return;
    }

    // Password strength validation
    const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*])[A-Za-z\d!@#$%^&*]{8,}$/;
    if (!passwordRegex.test(password)) {
        Toast.error('Password must be at least 8 characters with uppercase, lowercase, digit, and special character (!@#$%^&*)');
        resetSwipeButton();
        return;
    }

    // Show loading state
    const handleText = swipeHandle.querySelector('.handle-text');
    handleText.textContent = 'Creating Account...';

    try {
        const response = await api.register(email, password, firstName, lastName);

        if (response.success) {
            handleText.textContent = 'Success!';
            Toast.success('Account created successfully! Redirecting to login...');

            setTimeout(() => {
                window.location.href = 'login.html';
            }, 2000);
        } else {
            Toast.error(response.message || 'Registration failed');
            resetSwipeButton();
        }
    } catch (error) {
        Toast.error(error.message || 'An error occurred');
        resetSwipeButton();
    }
}

// Local showError/showSuccess removed - using unified toast.js instead

function resetSwipeButton() {
    if (swipeHandle && swipeTrack) {
        // Use requestAnimationFrame to ensure smooth transition
        requestAnimationFrame(() => {
            swipeHandle.style.left = '2px';
            swipeTrack.classList.remove('success');
            const handleText = swipeHandle.querySelector('.handle-text');
            handleText.textContent = 'Swipe to Sign Up';
        });
    }
}

// Prevent default form submission
registerForm.addEventListener('submit', (e) => {
    e.preventDefault();
});
