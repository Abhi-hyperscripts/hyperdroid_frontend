/**
 * HRMS Announcements Page
 */

let allAnnouncements = [];
let currentFilter = 'all';
let isAdmin = false;
let departments = [];
let offices = [];

document.addEventListener('DOMContentLoaded', async () => {
    if (!api.isAuthenticated()) {
        window.location.href = '../login.html';
        return;
    }

    if (typeof Navigation !== 'undefined') Navigation.init();

    checkAdminAccess();
    await loadAnnouncements();
    await loadTargetOptions();

    // Check for specific announcement ID in URL
    const urlParams = new URLSearchParams(window.location.search);
    const announcementId = urlParams.get('id');
    if (announcementId) {
        highlightAnnouncement(announcementId);
    }
});

function checkAdminAccess() {
    const userData = localStorage.getItem('userData');
    if (userData) {
        try {
            const user = JSON.parse(userData);
            const roles = user.roles || [];
            const adminRoles = ['SUPERADMIN', 'HRMS_ADMIN', 'HRMS_HR_ADMIN'];
            if (roles.some(r => adminRoles.includes(r))) {
                isAdmin = true;
                document.getElementById('adminActions').style.display = 'flex';
            }
        } catch (e) {}
    }
}

async function loadAnnouncements() {
    const container = document.getElementById('announcementsList');

    try {
        allAnnouncements = await api.getHrmsAnnouncements(false, 50) || [];
        renderAnnouncements();
    } catch (error) {
        console.error('Error loading announcements:', error);
        container.innerHTML = '<div class="ess-error-state"><p>Failed to load announcements</p></div>';
    }
}

async function loadTargetOptions() {
    try {
        [departments, offices] = await Promise.all([
            api.getHrmsDepartments(),
            api.getHrmsOffices()
        ]);
    } catch (e) {
        console.error('Error loading target options:', e);
    }
}

function renderAnnouncements() {
    const container = document.getElementById('announcementsList');
    let filtered = [...allAnnouncements];

    if (currentFilter === 'unread') {
        filtered = filtered.filter(a => !a.is_read);
    } else if (currentFilter !== 'all') {
        filtered = filtered.filter(a => a.announcement_type === currentFilter);
    }

    // Sort: pinned first, then by date
    filtered.sort((a, b) => {
        if (a.is_pinned && !b.is_pinned) return -1;
        if (!a.is_pinned && b.is_pinned) return 1;
        return new Date(b.publish_date) - new Date(a.publish_date);
    });

    if (filtered.length === 0) {
        container.innerHTML = `
            <div class="ess-empty-state">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                    <polyline points="14 2 14 8 20 8"/>
                </svg>
                <p>No announcements found</p>
            </div>
        `;
        return;
    }

    container.innerHTML = filtered.map(a => `
        <div class="announcement-card ${a.is_read ? '' : 'unread'} ${a.is_pinned ? 'pinned' : ''}"
             id="announcement-${a.id}" onclick="markAsRead('${a.id}')">
            <div class="announcement-card-header">
                <div class="announcement-badges">
                    ${a.is_pinned ? '<span class="announcement-badge pinned">Pinned</span>' : ''}
                    ${a.priority === 'high' || a.priority === 'critical' ?
                        `<span class="announcement-badge priority-${a.priority}">${capitalize(a.priority)}</span>` : ''}
                </div>
                ${isAdmin ? `
                    <div class="announcement-actions">
                        <button class="icon-btn" onclick="event.stopPropagation(); editAnnouncement('${a.id}')" title="Edit">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                            </svg>
                        </button>
                        <button class="icon-btn danger" onclick="event.stopPropagation(); deleteAnnouncement('${a.id}')" title="Delete">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <polyline points="3 6 5 6 21 6"/>
                                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                            </svg>
                        </button>
                    </div>
                ` : ''}
            </div>
            <h2>${escapeHtml(a.title)}</h2>
            <div class="announcement-card-content">${a.content}</div>
            <div class="announcement-card-footer">
                <div class="announcement-meta">
                    <span>${formatDate(a.publish_date)}</span>
                    <span>${a.announcement_type ? capitalize(a.announcement_type) : 'General'}</span>
                </div>
            </div>
        </div>
    `).join('');
}

function filterAnnouncements(filter) {
    currentFilter = filter;
    document.querySelectorAll('.announcement-filter-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.filter === filter);
    });
    renderAnnouncements();
}

async function markAsRead(id) {
    const ann = allAnnouncements.find(a => a.id === id);
    if (ann && !ann.is_read) {
        try {
            await api.markAnnouncementAsRead(id);
            ann.is_read = true;
            renderAnnouncements();
        } catch (e) {
            console.error('Error marking as read:', e);
        }
    }
}

function highlightAnnouncement(id) {
    const el = document.getElementById(`announcement-${id}`);
    if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.classList.add('highlighted');
        markAsRead(id);
    }
}

function openCreateModal() {
    document.getElementById('modalTitle').textContent = 'Create Announcement';
    document.getElementById('announcementId').value = '';
    document.getElementById('announcementForm').reset();
    document.getElementById('publishDate').value = new Date().toISOString().split('T')[0];
    document.getElementById('announcementModal').style.display = 'flex';
}

async function editAnnouncement(id) {
    const ann = allAnnouncements.find(a => a.id === id);
    if (!ann) return;

    document.getElementById('modalTitle').textContent = 'Edit Announcement';
    document.getElementById('announcementId').value = id;
    document.getElementById('title').value = ann.title || '';
    document.getElementById('content').value = ann.content || '';
    document.getElementById('announcementType').value = ann.announcement_type || 'general';
    document.getElementById('priority').value = ann.priority || 'normal';
    document.getElementById('publishDate').value = ann.publish_date ? ann.publish_date.split('T')[0] : '';
    document.getElementById('expiryDate').value = ann.expiry_date ? ann.expiry_date.split('T')[0] : '';
    document.getElementById('targetType').value = ann.target_type || 'all';
    document.getElementById('isPinned').checked = ann.is_pinned || false;

    onTargetTypeChange();
    if (ann.target_office_id) document.getElementById('targetId').value = ann.target_office_id;
    if (ann.target_department_id) document.getElementById('targetId').value = ann.target_department_id;

    document.getElementById('announcementModal').style.display = 'flex';
}

function closeModal() {
    document.getElementById('announcementModal').style.display = 'none';
}

function onTargetTypeChange() {
    const targetType = document.getElementById('targetType').value;
    const targetSelectGroup = document.getElementById('targetSelect');
    const targetSelect = document.getElementById('targetId');

    if (targetType === 'all') {
        targetSelectGroup.style.display = 'none';
        return;
    }

    targetSelectGroup.style.display = 'block';
    const options = targetType === 'department' ? departments : offices;
    targetSelect.innerHTML = '<option value="">Select...</option>' +
        options.map(o => `<option value="${o.id}">${escapeHtml(o.department_name || o.office_name)}</option>`).join('');
}

async function saveAnnouncement(event) {
    event.preventDefault();

    const id = document.getElementById('announcementId').value;
    const targetType = document.getElementById('targetType').value;
    const targetId = document.getElementById('targetId').value;

    const data = {
        title: document.getElementById('title').value,
        content: document.getElementById('content').value,
        announcement_type: document.getElementById('announcementType').value,
        priority: document.getElementById('priority').value,
        publish_date: document.getElementById('publishDate').value || null,
        expiry_date: document.getElementById('expiryDate').value || null,
        target_type: targetType,
        target_department_id: targetType === 'department' ? targetId : null,
        target_office_id: targetType === 'office' ? targetId : null,
        is_pinned: document.getElementById('isPinned').checked
    };

    try {
        if (id) {
            await api.updateHrmsAnnouncement(id, data);
            showToast('Announcement updated successfully', 'success');
        } else {
            await api.createHrmsAnnouncement(data);
            showToast('Announcement created successfully', 'success');
        }
        closeModal();
        await loadAnnouncements();
    } catch (error) {
        console.error('Error saving announcement:', error);
        showToast(error.message || 'Failed to save announcement', 'error');
    }
}

async function deleteAnnouncement(id) {
    const confirmed = await Confirm.show({
        title: 'Delete Announcement',
        message: 'Are you sure you want to delete this announcement?',
        type: 'danger',
        confirmText: 'Delete',
        cancelText: 'Cancel'
    });

    if (!confirmed) return;

    try {
        await api.deleteHrmsAnnouncement(id);
        showToast('Announcement deleted', 'success');
        await loadAnnouncements();
    } catch (error) {
        console.error('Error deleting announcement:', error);
        showToast('Failed to delete announcement', 'error');
    }
}

// Utility functions
function formatDate(dateStr) {
    if (!dateStr) return '';
    return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function capitalize(str) {
    return str ? str.charAt(0).toUpperCase() + str.slice(1) : '';
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Local showToast removed - using unified toast.js instead
