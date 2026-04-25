// Guest join page JavaScript
// Get meeting ID from URL
const urlParams = new URLSearchParams(window.location.search);
const meetingId = urlParams.get('id');
// forceGuest=1 — set when lobby bounces a logged-in user here because their
// account doesn't have access (typically a cross-tenant guest link). Skip the
// choice screen and put them straight on the guest form.
const forceGuest = urlParams.get('forceGuest') === '1';

// Redirect if no meeting ID
if (!meetingId) {
    Toast.error('Meeting ID not provided');
    window.location.href = '../login.html';
}

// Clear any existing guest session data to prevent duplicates
sessionStorage.removeItem('guestToken');
sessionStorage.removeItem('guestName');
sessionStorage.removeItem('guestWsUrl');
sessionStorage.removeItem('isGuest');
sessionStorage.removeItem('guestMeetingId');

// Check if user is authenticated
const isAuthenticated = api.isAuthenticated();
const authenticatedUser = api.getUser();

// Show appropriate UI based on authentication status
if (isAuthenticated && authenticatedUser && !forceGuest) {
    // Show choice screen for authenticated users
    document.getElementById('guestJoinCard').style.display = 'none';
    document.getElementById('authenticatedChoice').style.display = 'block';
    document.getElementById('userDisplayName').textContent = `${authenticatedUser.firstName} ${authenticatedUser.lastName}`;

    // Handle "Join as Myself" button
    document.getElementById('joinAsAuthenticatedBtn').addEventListener('click', async () => {
        console.log('Authenticated user choosing to join as themselves');
        // Redirect to lobby for device testing - will use authenticated token
        window.location.href = `lobby.html?id=${meetingId}`;
    });

    // Handle "Join as Guest" button
    document.getElementById('joinAsGuestBtn').addEventListener('click', () => {
        console.log('Authenticated user choosing to join as guest');
        // Show guest form
        document.getElementById('authenticatedChoice').style.display = 'none';
        document.getElementById('guestJoinCard').style.display = 'block';
    });
} else {
    // Show guest form for non-authenticated users (or for authenticated users
    // who were bounced here with forceGuest=1 because their account can't
    // access this meeting — typical for cross-tenant guest links).
    document.getElementById('authenticatedChoice').style.display = 'none';
    document.getElementById('guestJoinCard').style.display = 'block';
    if (forceGuest && isAuthenticated && authenticatedUser) {
        // Pre-fill the name from their authenticated profile so they don't have
        // to retype it. They're still a guest in this meeting's tenant.
        const fn = document.getElementById('firstName');
        const ln = document.getElementById('lastName');
        if (fn && !fn.value) fn.value = authenticatedUser.firstName || '';
        if (ln && !ln.value) ln.value = authenticatedUser.lastName || '';
    }
}

// Handle guest join form submission
document.getElementById('guestJoinForm').addEventListener('submit', async (e) => {
    e.preventDefault();

    const firstName = document.getElementById('firstName').value.trim();
    let lastName = document.getElementById('lastName').value.trim();
    const errorMessage = document.getElementById('errorMessage');

    if (!firstName) {
        errorMessage.textContent = 'Please enter your first name';
        errorMessage.style.display = 'block';
        return;
    }

    // If last name is not provided, use first name
    if (!lastName) {
        lastName = firstName;
    }

    try {
        // Call guest join API
        const response = await api.guestJoinMeeting(meetingId, firstName, lastName);

        if (response && response.token) {
            // Store guest info in sessionStorage
            sessionStorage.setItem('guestToken', response.token);
            sessionStorage.setItem('guestName', response.participant_name);
            sessionStorage.setItem('guestWsUrl', response.ws_url);
            sessionStorage.setItem('isGuest', 'true');
            sessionStorage.setItem('guestMeetingId', meetingId);

            // Redirect to lobby for device testing
            window.location.href = `lobby.html?id=${meetingId}`;
        } else {
            errorMessage.textContent = 'Failed to join meeting. Please try again.';
            errorMessage.style.display = 'block';
        }
    } catch (error) {
        console.error('Guest join error:', error);
        errorMessage.textContent = error.message || 'An error occurred. Please try again.';
        errorMessage.style.display = 'block';
    }
});
