// Guest join page JavaScript
// Get meeting ID from URL
const urlParams = new URLSearchParams(window.location.search);
const meetingId = urlParams.get('id');

// Redirect if no meeting ID
if (!meetingId) {
    alert('Meeting ID not provided');
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
if (isAuthenticated && authenticatedUser) {
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
    // Show guest form for non-authenticated users
    document.getElementById('authenticatedChoice').style.display = 'none';
    document.getElementById('guestJoinCard').style.display = 'block';
}

// Handle guest join form submission
document.getElementById('guestJoinForm').addEventListener('submit', async (e) => {
    e.preventDefault();

    const firstName = document.getElementById('firstName').value.trim();
    const lastName = document.getElementById('lastName').value.trim();
    const errorMessage = document.getElementById('errorMessage');

    if (!firstName || !lastName) {
        errorMessage.textContent = 'Please enter both first and last name';
        errorMessage.style.display = 'block';
        return;
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
