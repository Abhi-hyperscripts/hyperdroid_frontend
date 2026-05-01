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

    // Handle "Join as Myself" button.
    // Two cases the user can land in here:
    //   (a) Same-tenant meeting: their JWT works, lobby will accept it. Just redirect.
    //   (b) Cross-tenant meeting: backend checkMeetingAccess returns 404 because the
    //       meeting belongs to a different tenant. Previously this caused the lobby
    //       to bounce back here with forceGuest=1, dropping the user on a form they
    //       had to refill — which they (rightly) experience as "you sent me back to
    //       a non-meeting page." We now silently call the guest-join API with their
    //       JWT first/last name and proceed to lobby with a guest session. One click.
    document.getElementById('joinAsAuthenticatedBtn').addEventListener('click', async () => {
        const btn = document.getElementById('joinAsAuthenticatedBtn');
        btn.disabled = true;
        try {
            const access = await api.checkMeetingAccess(meetingId);
            if (access && access.canJoin) {
                window.location.href = `lobby.html?id=${meetingId}`;
                return;
            }
            // Backend said canJoin:false (e.g. participant-controlled, not on
            // allowed list). Surface the reason and still attempt guest fallback
            // so the user is not stranded.
            if (access && access.message) {
                Toast.info(access.message);
            }
        } catch (err) {
            // 404 (cross-tenant) or transient error — silently fall through.
            console.log('[guest-join] same-tenant access check failed, falling back to guest with JWT name:', err.message);
        }
        // Fallback: guest-join using the user's JWT first/last name. Mirrors the
        // form-submission path below so meeting.js sees a guest session.
        try {
            const firstName = authenticatedUser.firstName || 'User';
            const lastName = authenticatedUser.lastName || authenticatedUser.firstName || 'User';
            const r = await api.guestJoinMeeting(meetingId, firstName, lastName);
            if (r && r.token) {
                sessionStorage.setItem('guestToken', r.token);
                sessionStorage.setItem('guestName', r.participant_name);
                sessionStorage.setItem('guestWsUrl', r.ws_url);
                sessionStorage.setItem('isGuest', 'true');
                sessionStorage.setItem('guestMeetingId', meetingId);
                window.location.href = `lobby.html?id=${meetingId}`;
            } else {
                Toast.error('Failed to join meeting. Please try again.');
                btn.disabled = false;
            }
        } catch (e) {
            console.error('[guest-join] guest fallback failed:', e);
            Toast.error(e.message || 'Failed to join meeting');
            btn.disabled = false;
        }
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
