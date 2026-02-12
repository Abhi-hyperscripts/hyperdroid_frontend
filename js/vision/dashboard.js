// Dashboard page JavaScript - Meeting-Centric Dashboard
let currentProjectId = null;
let selectedMeetingType = 'regular'; // For create meeting modal
var tenantHasLlmKey = false; // Whether tenant has an active LLM API key (for AI Copilot)

// Check authentication
if (!api.isAuthenticated()) {
    window.location.href = '../login.html';
}

// User avatar and dropdown are now handled by Navigation.init() in navigation.js
const user = api.getUser();

// ============================================
// DASHBOARD STATE
// ============================================

let dashboardState = {
    meetings: [],
    page: 1,
    page_size: 20,
    total_count: 0,
    has_more: false,
    search: '',
    source_filter: 'all',
    type_filter: 'all',
    status_filter: 'all',
    sort_by: 'recent',
    project_id: null,
    month_filter: null,  // null = all months
    year_filter: new Date().getFullYear(),
    isLoading: false,
    projects: []
};

let _searchDebounceTimer = null;

// ============================================
// LOAD DASHBOARD (single API call)
// ============================================

async function loadDashboard(reset = true) {
    if (dashboardState.isLoading) return;
    dashboardState.isLoading = true;

    const grid = document.getElementById('meetingsGrid');
    const pagination = document.getElementById('dashboardPagination');

    if (reset) {
        dashboardState.page = 1;
        dashboardState.meetings = [];
        grid.innerHTML = '<div class="dashboard-loading"><div class="loading-spinner"></div><p>Loading meetings...</p></div>';
    }

    try {
        const result = await api.getDashboardMeetings({
            page: dashboardState.page,
            page_size: dashboardState.page_size,
            search: dashboardState.search || undefined,
            source_filter: dashboardState.source_filter,
            type_filter: dashboardState.type_filter,
            status_filter: dashboardState.status_filter,
            sort_by: dashboardState.sort_by,
            project_id: dashboardState.project_id || undefined
        });

        if (reset) {
            dashboardState.meetings = result.meetings;
        } else {
            dashboardState.meetings = dashboardState.meetings.concat(result.meetings);
        }
        dashboardState.total_count = result.total_count;
        dashboardState.has_more = result.has_more;

        renderMeetingsList(reset);
        updateResultsBar();
        updatePagination();
        if (reset) updateSourceFilterOptions(result.meetings);

    } catch (error) {
        console.error('Error loading dashboard:', error);
        if (reset) {
            grid.innerHTML = '<div class="empty-state"><h3>Error loading meetings</h3><p>Please try refreshing the page</p></div>';
        }
    } finally {
        dashboardState.isLoading = false;
    }
}

// Keep loadAllProjects as alias for backward compatibility with existing code
async function loadAllProjects() {
    await loadDashboard(true);
}

// ============================================
// RENDER MEETINGS LIST
// ============================================

function getMonthFilteredMeetings(meetings) {
    const { month_filter, year_filter } = dashboardState;
    // "All Months" (null) = no date filtering at all
    if (month_filter === null) return meetings;
    // Specific month selected — filter by year + month
    return meetings.filter(m => {
        const date = m.start_time ? new Date(m.start_time) : (m.created_at ? new Date(m.created_at) : null);
        if (!date) return false;
        return date.getFullYear() === year_filter && (date.getMonth() + 1) === month_filter;
    });
}

function renderMeetingsList(fullReplace = true) {
    const grid = document.getElementById('meetingsGrid');
    const filtered = getMonthFilteredMeetings(dashboardState.meetings);

    if (filtered.length === 0) {
        const hasFilters = dashboardState.search || dashboardState.source_filter !== 'all' || dashboardState.type_filter !== 'all' || dashboardState.status_filter !== 'all' || dashboardState.month_filter !== null;
        grid.innerHTML = `
            <div class="empty-state">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" stroke-width="1.5">
                    <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
                </svg>
                <h3>No meetings found</h3>
                <p>${hasFilters ? 'Try adjusting your filters' : 'Create your first meeting to get started'}</p>
                <button onclick="showCreateMeetingQuickModal()" class="btn btn-primary" style="margin-top: 12px;">+ New Meeting</button>
            </div>
        `;
        return;
    }

    if (fullReplace) {
        grid.innerHTML = filtered.map(m => createDashboardMeetingCard(m)).join('');
    } else {
        // Append new meetings (for Load More)
        const startIdx = filtered.length - (dashboardState.page_size);
        const newMeetings = filtered.slice(startIdx < 0 ? 0 : startIdx);
        grid.insertAdjacentHTML('beforeend', newMeetings.map(m => createDashboardMeetingCard(m)).join(''));
    }
}

// ============================================
// MEETING CARD V2
// ============================================

function createDashboardMeetingCard(meeting) {
    const type = meeting.meeting_type || 'regular';
    const isStarted = meeting.is_started || false;
    const isRecording = meeting.is_recording || false;
    const isActive = meeting.is_active !== false; // default true
    const recCount = meeting.recording_count || 0;
    const participantCount = meeting.allowed_participant_count || 0;
    const showGuestLink = meeting.allow_guests && type !== 'participant-controlled';

    const dateStr = meeting.start_time
        ? new Date(meeting.start_time).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
        : '';

    const typeBadge = getTypeBadgeHTML(type);
    const sourceBadge = getSourceBadgeHTML(meeting.source_service);

    const liveIndicator = isStarted && isActive
        ? '<span class="meeting-live-indicator"><span class="live-dot"></span>LIVE</span>'
        : '';

    // Build meta items — dots only between project and date, badges flow with gap
    const metaTextParts = [];
    metaTextParts.push(`<span class="mcv2-meta-project"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>${escapeHtml(meeting.project_name || 'Unknown')}</span>`);
    if (dateStr) metaTextParts.push(`<span class="mcv2-meta-date">${dateStr}</span>`);

    const metaBadges = [];
    metaBadges.push(typeBadge);
    if (sourceBadge) metaBadges.push(sourceBadge);
    if (recCount > 0) metaBadges.push(`<span class="badge badge-recording badge-clickable" onclick="event.stopPropagation(); playRecording('${meeting.id}')" title="${recCount} recording${recCount > 1 ? 's' : ''}">${recCount} rec</span>`);
    if (showGuestLink) metaBadges.push(`<span class="badge badge-guest badge-clickable" onclick="event.stopPropagation(); copyGuestLink('${meeting.id}')" title="Copy guest link"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="vertical-align:-1px;margin-right:2px"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>Copy Guest Link</span>`);
    if (type === 'participant-controlled') metaBadges.push(`<span class="badge badge-participants" id="participant-badge-${meeting.id}">${participantCount}</span>`);

    const cardClass = isActive ? 'meeting-card-v2' : 'meeting-card-v2 mcv2-ended';

    return `
        <div class="${cardClass}" id="meeting-${meeting.id}" data-meeting-id="${meeting.id}" data-is-started="${isStarted}" data-is-recording="${isRecording}">
            <div class="mcv2-card-border"></div>
            <div class="mcv2-card-content">
                <div class="mcv2-info">
                    <div class="mcv2-title-row">
                        ${liveIndicator}
                        <h4 class="mcv2-name">${escapeHtml(meeting.meeting_name || 'Untitled')}</h4>
                    </div>
                    <div class="mcv2-meta-row">
                        ${metaTextParts.join('<span class="mcv2-dot">\u00b7</span>')}
                    </div>
                    <div class="mcv2-badges-row">
                        ${metaBadges.join('')}
                    </div>
                </div>
                <div class="mcv2-actions">
                    <div class="mcv2-secondary-actions">
                        <button class="btn-icon-sm btn-delete" onclick="confirmDeleteMeeting('${meeting.id}')" title="Delete">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                            </svg>
                        </button>
                        <button class="btn-icon-sm" onclick="event.stopPropagation(); showMeetingSettingsModal('${meeting.id}', '${type}')" title="Settings">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
                            </svg>
                        </button>
                        <button class="btn-icon-sm" onclick="event.stopPropagation(); showTranscriptsPanel('${meeting.id}')" title="Transcripts">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/>
                            </svg>
                        </button>
                        <button class="btn-icon-sm" onclick="copyMeetingLink('${meeting.id}')" title="Copy Link">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
                            </svg>
                        </button>
                    </div>
                    <button class="btn-join-primary" onclick="joinMeeting('${meeting.id}')" title="Join Meeting">
                        Join
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                            <polyline points="9 18 15 12 9 6"/>
                        </svg>
                    </button>
                </div>
            </div>
        </div>
    `;
}

function getTypeBadgeHTML(type) {
    const badges = {
        'regular': '<span class="badge badge-type badge-type-open">Public</span>',
        'hosted': '<span class="badge badge-type badge-type-hosted">Hosted</span>',
        'participant-controlled': '<span class="badge badge-type badge-type-private">Invite Only</span>'
    };
    return badges[type] || badges['regular'];
}

function getSourceBadgeHTML(sourceService) {
    if (!sourceService) return '';
    const colors = {
        'Chat': 'var(--color-success)',
        'HRMS': '#a855f7',
        'ATS': '#f59e0b',
        'CRM': '#06b6d4'
    };
    const color = colors[sourceService] || 'var(--text-secondary)';
    return `<span class="badge badge-source" style="--source-color: ${color}">${escapeHtml(sourceService)}</span>`;
}

function getMeetingStatus(meeting) {
    if (!meeting.start_time && !meeting.end_time) return 'Active';
    const now = new Date();
    const start = meeting.start_time ? new Date(meeting.start_time) : null;
    const end = meeting.end_time ? new Date(meeting.end_time) : null;
    if (start && end) {
        if (now < start) return 'Scheduled';
        if (now > end) return 'Ended';
        return 'Active';
    }
    if (start && now < start) return 'Scheduled';
    return 'Active';
}

// ============================================
// FILTER / SEARCH / SORT / PAGINATION
// ============================================

function setFilter(type, value) {
    const filterMap = { source: 'source_filter', type: 'type_filter', status: 'status_filter' };
    const stateKey = filterMap[type];
    if (!stateKey) return;
    dashboardState[stateKey] = value;
    updateFilterCountBadge();
    loadDashboard(true);
}

function setSort(value) {
    dashboardState.sort_by = value;
    updateFilterCountBadge();
    loadDashboard(true);
}

function setProjectFilter(value) {
    dashboardState.project_id = value || null;
    loadDashboard(true);
}

// ============================================
// FILTER PANEL TOGGLE & BADGE
// ============================================

function toggleFilterPanel() {
    const panel = document.getElementById('filterPanel');
    const btn = document.getElementById('filterToggleBtn');
    if (!panel || !btn) return;
    panel.classList.toggle('open');
    btn.classList.toggle('active');
}

function updateFilterCountBadge() {
    let count = 0;
    if (dashboardState.source_filter !== 'all') count++;
    if (dashboardState.type_filter !== 'all') count++;
    if (dashboardState.status_filter !== 'all') count++;
    if (dashboardState.sort_by !== 'recent') count++;

    const badge = document.getElementById('filterCountBadge');
    const btn = document.getElementById('filterToggleBtn');
    if (badge) {
        badge.textContent = count;
        badge.style.display = count > 0 ? 'inline-flex' : 'none';
    }
    if (btn) {
        btn.classList.toggle('has-filters', count > 0);
    }

    // Update active summary
    const summary = document.getElementById('filterActiveSummary');
    const text = document.getElementById('activeFilterText');
    if (summary && text) {
        if (count > 0) {
            const parts = [];
            if (dashboardState.source_filter !== 'all') parts.push(`Source: ${dashboardState.source_filter}`);
            if (dashboardState.type_filter !== 'all') {
                const labels = { regular: 'Open', hosted: 'Hosted', 'participant-controlled': 'Private' };
                parts.push(`Type: ${labels[dashboardState.type_filter] || dashboardState.type_filter}`);
            }
            if (dashboardState.status_filter !== 'all') parts.push(`Status: ${dashboardState.status_filter}`);
            if (dashboardState.sort_by !== 'recent') {
                const sortLabels = { name: 'Name', upcoming: 'Upcoming' };
                parts.push(`Sort: ${sortLabels[dashboardState.sort_by] || dashboardState.sort_by}`);
            }
            text.textContent = parts.join('  \u00b7  ');
            summary.style.display = 'flex';
        } else {
            summary.style.display = 'none';
        }
    }
}

function clearAllFilters() {
    dashboardState.source_filter = 'all';
    dashboardState.type_filter = 'all';
    dashboardState.status_filter = 'all';
    dashboardState.sort_by = 'recent';
    dashboardState.month_filter = null;
    dashboardState.year_filter = new Date().getFullYear();
    // Reset all filter dropdowns
    if (sourceDropdownSD) sourceDropdownSD.setValue('all');
    if (typeDropdownSD) typeDropdownSD.setValue('all');
    if (statusDropdownSD) statusDropdownSD.setValue('all');
    if (sortDropdownSD) sortDropdownSD.setValue('recent');
    if (dashboardMonthPicker) dashboardMonthPicker.setValue(new Date().getFullYear(), null);
    updateFilterCountBadge();
    loadDashboard(true);
}

// ============================================
// SEARCHABLE DROPDOWN INIT (All Filters)
// ============================================

let projectDropdownSD = null;
let sourceDropdownSD = null;
let typeDropdownSD = null;
let statusDropdownSD = null;
let sortDropdownSD = null;
let dashboardMonthPicker = null;

function initDashboardDropdowns() {
    // Month picker for filtering by month/year
    dashboardMonthPicker = new MonthPicker('dashboardMonthPicker', {
        allowAllMonths: true,
        yearsBack: 3,
        yearsForward: 1,
        month: null, // Start with "All Months"
        onChange: ({ year, month }) => {
            dashboardState.year_filter = year;
            dashboardState.month_filter = month;
            loadDashboard(true);
        }
    });

    // Project dropdown (top bar) — populated later by loadProjectFilterDropdown
    projectDropdownSD = new SearchableDropdown('projectDropdownContainer', {
        id: 'projectDropdownSD',
        options: [{ value: '', label: 'All Projects' }],
        value: '',
        placeholder: 'All Projects',
        compact: true,
        linkedSelect: document.getElementById('dashboardProjectFilter'),
        onChange: (value) => { setProjectFilter(value); }
    });

    // Source dropdown — starts with "All Sources", dynamically updated after first load
    sourceDropdownSD = new SearchableDropdown('sourceDropdownContainer', {
        id: 'sourceDropdownSD',
        options: [{ value: 'all', label: 'All Sources' }],
        value: 'all',
        placeholder: 'All Sources',
        compact: true,
        onChange: (value) => { setFilter('source', value); }
    });

    // Type dropdown
    typeDropdownSD = new SearchableDropdown('typeDropdownContainer', {
        id: 'typeDropdownSD',
        options: [
            { value: 'all', label: 'All Types' },
            { value: 'regular', label: 'Open' },
            { value: 'hosted', label: 'Hosted' },
            { value: 'participant-controlled', label: 'Private' }
        ],
        value: 'all',
        placeholder: 'All Types',
        compact: true,
        onChange: (value) => { setFilter('type', value); }
    });

    // Status dropdown
    statusDropdownSD = new SearchableDropdown('statusDropdownContainer', {
        id: 'statusDropdownSD',
        options: [
            { value: 'all', label: 'All Status' },
            { value: 'live', label: 'Live' },
            { value: 'active', label: 'Active' },
            { value: 'scheduled', label: 'Scheduled' },
            { value: 'ended', label: 'Ended' }
        ],
        value: 'all',
        placeholder: 'All Status',
        compact: true,
        onChange: (value) => { setFilter('status', value); }
    });

    // Sort dropdown
    sortDropdownSD = new SearchableDropdown('sortDropdownContainer', {
        id: 'sortDropdownSD',
        options: [
            { value: 'recent', label: 'Recent' },
            { value: 'name', label: 'Name' },
            { value: 'upcoming', label: 'Upcoming' }
        ],
        value: 'recent',
        placeholder: 'Sort by',
        compact: true,
        onChange: (value) => { setSort(value); }
    });
}

// Dynamically update source dropdown options from loaded meetings
function updateSourceFilterOptions(meetings) {
    if (!sourceDropdownSD) return;
    const sources = new Set();
    meetings.forEach(m => {
        if (m.source && m.source !== 'manual') sources.add(m.source);
    });
    const opts = [{ value: 'all', label: 'All Sources' }, { value: 'manual', label: 'Manual' }];
    Array.from(sources).sort().forEach(s => opts.push({ value: s, label: s }));
    sourceDropdownSD.setOptions(opts);
}

function debounceSearch() {
    clearTimeout(_searchDebounceTimer);
    _searchDebounceTimer = setTimeout(() => {
        const input = document.getElementById('dashboardSearch');
        dashboardState.search = input ? input.value.trim() : '';
        loadDashboard(true);
    }, 300);
}

function loadMoreMeetings() {
    if (!dashboardState.has_more || dashboardState.isLoading) return;
    dashboardState.page++;
    loadDashboard(false);
}

function updateResultsBar() {
    const el = document.getElementById('resultsCount');
    if (!el) return;
    const filtered = getMonthFilteredMeetings(dashboardState.meetings);
    const showing = filtered.length;
    const total = dashboardState.total_count;
    if (dashboardState.month_filter !== null && showing !== total) {
        el.textContent = `Showing ${showing} of ${total} meeting${total !== 1 ? 's' : ''} (filtered by month)`;
    } else {
        el.textContent = `Showing ${showing} of ${total} meeting${total !== 1 ? 's' : ''}`;
    }
}

function updatePagination() {
    const pag = document.getElementById('dashboardPagination');
    const info = document.getElementById('paginationInfo');
    if (!pag) return;

    if (dashboardState.has_more) {
        pag.style.display = 'flex';
        const remaining = dashboardState.total_count - dashboardState.meetings.length;
        if (info) info.textContent = `${remaining} more meeting${remaining !== 1 ? 's' : ''}`;
    } else {
        pag.style.display = 'none';
    }
}

// ============================================
// PROJECT FILTER DROPDOWN
// ============================================

async function loadProjectFilterDropdown() {
    try {
        const projects = await api.getProjects();
        dashboardState.projects = projects;

        // Update SearchableDropdown options
        if (projectDropdownSD) {
            const opts = [{ value: '', label: 'All Projects' }];
            projects.forEach(p => opts.push({ value: p.id, label: p.project_name }));
            projectDropdownSD.setOptions(opts);
        }

        // Also update hidden select for fallback
        const select = document.getElementById('dashboardProjectFilter');
        if (select) {
            select.innerHTML = '<option value="">All Projects</option>';
            projects.forEach(p => {
                const opt = document.createElement('option');
                opt.value = p.id;
                opt.textContent = p.project_name;
                select.appendChild(opt);
            });
        }
    } catch (error) {
        console.error('Error loading project filter:', error);
    }
}

// ============================================
// QUICK CREATE MEETING (auto-select project)
// ============================================

function showCreateMeetingQuickModal() {
    if (dashboardState.projects.length === 0) {
        Toast.info('Create a project first before adding meetings');
        showCreateProjectModal();
        return;
    }

    // Reset form state
    selectedMeetingType = 'regular';
    createMeetingSelectedParticipants = [];
    const form = document.getElementById('createMeetingForm');
    if (form) form.reset();
    setDefaultDateTime();

    // Reset type buttons
    document.querySelectorAll('#meetingTypeToggle .segment-btn').forEach(btn => {
        btn.classList.remove('active');
        if (btn.dataset.type === 'regular') btn.classList.add('active');
    });
    document.getElementById('meetingTypeHelp').textContent = 'Anyone can join directly without approval';
    document.getElementById('hostSelectionGroup').style.display = 'none';
    document.getElementById('participantsSelectionGroup').style.display = 'none';
    document.getElementById('allowGuestsToggleGroup').classList.remove('hidden');

    // Reset AI Copilot toggle (hidden by default, only shown for hosted + LLM key)
    document.getElementById('aiCopilotToggleGroup').classList.add('hidden');
    document.getElementById('aiCopilot').checked = false;
    // Re-enable toggles that AI Copilot may have disabled
    document.getElementById('allowGuests').disabled = false;
    document.getElementById('autoTranscription').disabled = false;

    // Populate project selector
    const projectSelect = document.getElementById('meetingProjectSelect');
    const projectGroup = document.getElementById('meetingProjectSelectGroup');
    if (projectSelect && projectGroup) {
        if (dashboardState.projects.length === 1) {
            // Auto-select the only project
            currentProjectId = dashboardState.projects[0].id;
            document.getElementById('currentProjectId').value = currentProjectId;
            projectGroup.style.display = 'none';
        } else {
            currentProjectId = null;
            document.getElementById('currentProjectId').value = '';
            projectGroup.style.display = 'block';
            projectSelect.innerHTML = '<option value="">Select a project...</option>';
            dashboardState.projects.forEach(p => {
                const opt = document.createElement('option');
                opt.value = p.id;
                opt.textContent = p.project_name;
                projectSelect.appendChild(opt);
            });
        }
    }

    openModal('createMeetingModal');
    fetchAndPopulateUsers();
}

function onMeetingProjectSelected(projectId) {
    currentProjectId = projectId || null;
    document.getElementById('currentProjectId').value = projectId || '';
}

// ============================================
// CREATE PROJECT
// ============================================

function showCreateProjectModal() {
    openModal('createProjectModal');
}

document.getElementById('createProjectForm').addEventListener('submit', async (e) => {
    e.preventDefault();

    const projectName = document.getElementById('projectName').value;
    const description = document.getElementById('projectDescription').value;

    try {
        await api.createProject(projectName, description);
        closeModal('createProjectModal');
        document.getElementById('createProjectForm').reset();
        loadAllProjects();
    } catch (error) {
        Toast.error('Failed to create project: ' + error.message);
    }
});

// ============================================
// CREATE MEETING WITH TYPE SELECTION
// ============================================

// ============================================
// Custom Date Picker
// ============================================
let startDatePickerDate = new Date();
let endDatePickerDate = new Date();
let selectedStartDate = null;
let selectedEndDate = null;

const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];

function toggleDatePicker(type) {
    const dropdown = document.getElementById(type + 'DateDropdown');
    const isOpen = dropdown.classList.contains('open');

    // Close all dropdowns
    closeAllDatePickers();
    closeAllTimePickers();

    if (!isOpen) {
        dropdown.classList.add('open');
        renderDatePicker(type);
    }
}

function closeAllDatePickers() {
    document.querySelectorAll('.date-dropdown').forEach(d => d.classList.remove('open'));
}

function navigateMonth(type, direction) {
    const pickerDate = type === 'start' ? startDatePickerDate : endDatePickerDate;
    pickerDate.setMonth(pickerDate.getMonth() + direction);

    if (type === 'start') {
        startDatePickerDate = new Date(pickerDate);
    } else {
        endDatePickerDate = new Date(pickerDate);
    }

    renderDatePicker(type);
}

function renderDatePicker(type) {
    const pickerDate = type === 'start' ? startDatePickerDate : endDatePickerDate;
    const selectedDate = type === 'start' ? selectedStartDate : selectedEndDate;
    const daysContainer = document.getElementById(type + 'DateDays');
    const monthYearLabel = document.getElementById(type + 'MonthYear');

    const year = pickerDate.getFullYear();
    const month = pickerDate.getMonth();

    // Update month/year label
    monthYearLabel.textContent = `${monthNames[month]} ${year}`;

    // Get first day of month and total days
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const daysInPrevMonth = new Date(year, month, 0).getDate();

    // Today's date for comparison
    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

    let html = '';

    // Previous month days
    for (let i = firstDay - 1; i >= 0; i--) {
        const day = daysInPrevMonth - i;
        const prevMonth = month === 0 ? 11 : month - 1;
        const prevYear = month === 0 ? year - 1 : year;
        const dateStr = `${prevYear}-${String(prevMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        html += `<div class="date-day other-month" onclick="selectDate('${type}', '${dateStr}')">${day}</div>`;
    }

    // Current month days
    for (let day = 1; day <= daysInMonth; day++) {
        const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        const isToday = dateStr === todayStr;
        const isSelected = selectedDate === dateStr;
        const classes = ['date-day'];
        if (isToday) classes.push('today');
        if (isSelected) classes.push('selected');
        html += `<div class="${classes.join(' ')}" onclick="selectDate('${type}', '${dateStr}')">${day}</div>`;
    }

    // Next month days
    const totalCells = firstDay + daysInMonth;
    const remainingCells = totalCells % 7 === 0 ? 0 : 7 - (totalCells % 7);
    for (let day = 1; day <= remainingCells; day++) {
        const nextMonth = month === 11 ? 0 : month + 1;
        const nextYear = month === 11 ? year + 1 : year;
        const dateStr = `${nextYear}-${String(nextMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        html += `<div class="date-day other-month" onclick="selectDate('${type}', '${dateStr}')">${day}</div>`;
    }

    daysContainer.innerHTML = html;
}

function selectDate(type, dateStr) {
    if (type === 'start') {
        selectedStartDate = dateStr;
        startDatePickerDate = new Date(dateStr);
    } else {
        selectedEndDate = dateStr;
        endDatePickerDate = new Date(dateStr);
    }

    updateDateInputDisplay(type);
    closeAllDatePickers();
}

function updateDateInputDisplay(type) {
    const dateStr = type === 'start' ? selectedStartDate : selectedEndDate;
    const input = document.getElementById(type + 'Date');

    if (dateStr) {
        const date = new Date(dateStr);
        const day = date.getDate();
        const month = monthNames[date.getMonth()].slice(0, 3);
        const year = date.getFullYear();
        input.value = `${day} ${month} ${year}`;
    } else {
        input.value = '';
    }
}

function clearDate(type) {
    if (type === 'start') {
        selectedStartDate = null;
    } else {
        selectedEndDate = null;
    }
    updateDateInputDisplay(type);
    closeAllDatePickers();
}

function selectToday(type) {
    const today = new Date();
    const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    selectDate(type, dateStr);
}

// Get date value in YYYY-MM-DD format for form submission
function getDateValue(type) {
    return type === 'start' ? selectedStartDate : selectedEndDate;
}

// ============================================
// Custom Time Picker
// ============================================
let selectedStartHour = 9;
let selectedStartMinute = 0;
let selectedEndHour = 10;
let selectedEndMinute = 0;

function initTimePickerColumns() {
    const hourColumns = ['startHourColumn', 'endHourColumn'];
    const minuteColumns = ['startMinuteColumn', 'endMinuteColumn'];

    // Generate hours (00-23)
    hourColumns.forEach(colId => {
        const col = document.getElementById(colId);
        if (col) {
            col.innerHTML = '';
            for (let h = 0; h < 24; h++) {
                const hourStr = h.toString().padStart(2, '0');
                const div = document.createElement('div');
                div.className = 'time-option';
                div.textContent = hourStr;
                div.dataset.value = h;
                div.onclick = (e) => {
                    e.stopPropagation();
                    selectHour(colId.includes('start') ? 'start' : 'end', h);
                };
                col.appendChild(div);
            }
        }
    });

    // Generate minutes (00, 15, 30, 45)
    minuteColumns.forEach(colId => {
        const col = document.getElementById(colId);
        if (col) {
            col.innerHTML = '';
            [0, 15, 30, 45].forEach(m => {
                const minStr = m.toString().padStart(2, '0');
                const div = document.createElement('div');
                div.className = 'time-option';
                div.textContent = minStr;
                div.dataset.value = m;
                div.onclick = (e) => {
                    e.stopPropagation();
                    selectMinute(colId.includes('start') ? 'start' : 'end', m);
                };
                col.appendChild(div);
            });
        }
    });
}

function toggleTimePicker(type) {
    const dropdown = document.getElementById(type + 'TimeDropdown');
    const isOpen = dropdown.classList.contains('open');

    // Close all time dropdowns
    document.querySelectorAll('.time-dropdown').forEach(d => d.classList.remove('open'));

    if (!isOpen) {
        dropdown.classList.add('open');
        updateTimePickerSelection(type);
        scrollToSelected(type);
    }
}

function closeAllTimePickers() {
    document.querySelectorAll('.time-dropdown').forEach(d => d.classList.remove('open'));
}

function selectHour(type, hour) {
    if (type === 'start') {
        selectedStartHour = hour;
    } else {
        selectedEndHour = hour;
    }
    updateTimePickerSelection(type);
    updateTimeInputValue(type);
}

function selectMinute(type, minute) {
    if (type === 'start') {
        selectedStartMinute = minute;
    } else {
        selectedEndMinute = minute;
    }
    updateTimePickerSelection(type);
    updateTimeInputValue(type);
}

function updateTimePickerSelection(type) {
    const hourCol = document.getElementById(type + 'HourColumn');
    const minCol = document.getElementById(type + 'MinuteColumn');
    const selectedHour = type === 'start' ? selectedStartHour : selectedEndHour;
    const selectedMin = type === 'start' ? selectedStartMinute : selectedEndMinute;

    // Update hour selection
    hourCol.querySelectorAll('.time-option').forEach(opt => {
        opt.classList.toggle('selected', parseInt(opt.dataset.value) === selectedHour);
    });

    // Update minute selection
    minCol.querySelectorAll('.time-option').forEach(opt => {
        opt.classList.toggle('selected', parseInt(opt.dataset.value) === selectedMin);
    });
}

function scrollToSelected(type) {
    const hourCol = document.getElementById(type + 'HourColumn');
    const selectedHour = type === 'start' ? selectedStartHour : selectedEndHour;

    const selectedOption = hourCol.querySelector('.time-option.selected');
    if (selectedOption) {
        selectedOption.scrollIntoView({ block: 'center', behavior: 'instant' });
    }
}

function updateTimeInputValue(type) {
    const hour = type === 'start' ? selectedStartHour : selectedEndHour;
    const minute = type === 'start' ? selectedStartMinute : selectedEndMinute;
    const timeStr = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
    document.getElementById(type + 'Time').value = timeStr;
}

// Helper function to set default date/time values
function setDefaultDateTime() {
    const now = new Date();

    // Round up to next 15 minutes
    const minutes = now.getMinutes();
    const roundedMinutes = Math.ceil(minutes / 15) * 15;
    now.setMinutes(roundedMinutes, 0, 0);

    // If rounded to 60, add an hour
    if (roundedMinutes === 60) {
        now.setHours(now.getHours() + 1);
        now.setMinutes(0);
    }

    // Set start date
    const startDateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    selectedStartDate = startDateStr;
    startDatePickerDate = new Date(now);
    updateDateInputDisplay('start');

    // Set start time
    selectedStartHour = now.getHours();
    selectedStartMinute = now.getMinutes();
    updateTimeInputValue('start');

    // Set end values (1 hour later)
    const endDateTime = new Date(now.getTime() + 60 * 60 * 1000);
    const endDateStr = `${endDateTime.getFullYear()}-${String(endDateTime.getMonth() + 1).padStart(2, '0')}-${String(endDateTime.getDate()).padStart(2, '0')}`;
    selectedEndDate = endDateStr;
    endDatePickerDate = new Date(endDateTime);
    updateDateInputDisplay('end');

    selectedEndHour = endDateTime.getHours();
    selectedEndMinute = endDateTime.getMinutes();
    updateTimeInputValue('end');
}

// Initialize time picker columns on page load
document.addEventListener('DOMContentLoaded', initTimePickerColumns);

// Close pickers when clicking outside
document.addEventListener('click', function(e) {
    if (!e.target.closest('.custom-time-picker')) {
        closeAllTimePickers();
    }
    if (!e.target.closest('.custom-date-picker')) {
        closeAllDatePickers();
    }
});

// Selected participants for private meetings (during creation)
let createMeetingSelectedParticipants = [];
let createMeetingAllUsers = [];

async function showCreateMeetingModalForProject(projectId) {
    currentProjectId = projectId;
    selectedMeetingType = 'regular';
    createMeetingSelectedParticipants = [];

    const modal = document.getElementById('createMeetingModal');

    // Reset form
    document.getElementById('createMeetingForm').reset();
    document.getElementById('currentProjectId').value = projectId;

    // Hide project selector since project is pre-selected
    const projectGroup = document.getElementById('meetingProjectSelectGroup');
    if (projectGroup) projectGroup.style.display = 'none';

    // Set default date/time values (today, next 15-min slot)
    setDefaultDateTime();

    // Reset type selection
    document.querySelectorAll('#meetingTypeToggle .segment-btn').forEach(btn => {
        btn.classList.remove('active');
        if (btn.dataset.type === 'regular') {
            btn.classList.add('active');
        }
    });

    // Update help text
    document.getElementById('meetingTypeHelp').textContent = 'Anyone can join directly without approval';

    // Hide host and participants selection
    document.getElementById('hostSelectionGroup').style.display = 'none';
    document.getElementById('participantsSelectionGroup').style.display = 'none';

    // Show allow guests toggle (modal opens with 'regular' type by default)
    document.getElementById('allowGuestsToggleGroup').classList.remove('hidden');

    // Reset AI Copilot toggle (hidden by default, only shown for hosted + LLM key)
    document.getElementById('aiCopilotToggleGroup').classList.add('hidden');
    document.getElementById('aiCopilot').checked = false;
    document.getElementById('allowGuests').disabled = false;
    document.getElementById('autoTranscription').disabled = false;

    modal.classList.add('gm-animating');
    requestAnimationFrame(() => {
        requestAnimationFrame(() => modal.classList.add('active'));
    });
    await fetchAndPopulateUsers();
}

function selectMeetingType(type) {
    selectedMeetingType = type;

    // Update button states
    document.querySelectorAll('#meetingTypeToggle .segment-btn').forEach(btn => {
        btn.classList.remove('active');
        if (btn.dataset.type === type) {
            btn.classList.add('active');
        }
    });

    // Update help text
    const helpTexts = {
        'regular': 'Anyone can join directly without approval',
        'hosted': 'Host must start the meeting before others can join',
        'participant-controlled': 'Only allowed participants can join'
    };
    document.getElementById('meetingTypeHelp').textContent = helpTexts[type];

    // Show/hide host selection
    const hostGroup = document.getElementById('hostSelectionGroup');
    const hostRequiredMark = document.getElementById('hostRequiredMark');
    const hostHelp = document.getElementById('hostHelp');

    if (type === 'hosted') {
        hostGroup.style.display = 'block';
        hostRequiredMark.style.display = 'inline';
        hostHelp.textContent = 'Required for hosted meetings';
        populateCreateHostDropdown(type);
    } else if (type === 'participant-controlled') {
        hostGroup.style.display = 'block';
        hostRequiredMark.style.display = 'none';
        hostHelp.textContent = 'Optional - if set, host must start before participants can join';
        populateCreateHostDropdown(type);
    } else {
        hostGroup.style.display = 'none';
        createHostDropdownSelectedId = '';
        document.getElementById('meetingHost').value = '';
    }

    // Show/hide participants selection
    const participantsGroup = document.getElementById('participantsSelectionGroup');
    if (type === 'participant-controlled') {
        participantsGroup.style.display = 'block';
        loadCreateMeetingUsersList();
    } else {
        participantsGroup.style.display = 'none';
        createMeetingSelectedParticipants = [];
    }

    // Show/hide allow guests toggle (hidden for private meetings)
    const allowGuestsToggle = document.getElementById('allowGuestsToggleGroup');
    if (type === 'participant-controlled') {
        allowGuestsToggle.classList.add('hidden');
        document.getElementById('allowGuests').checked = false;
    } else {
        allowGuestsToggle.classList.remove('hidden');
    }

    // Show/hide AI Copilot toggle (only for hosted meetings + tenant has LLM key)
    const aiCopilotToggle = document.getElementById('aiCopilotToggleGroup');
    const meetingModeGroup = document.getElementById('meetingModeGroup');
    if (type === 'hosted' && tenantHasLlmKey) {
        aiCopilotToggle.classList.remove('hidden');
    } else {
        aiCopilotToggle.classList.add('hidden');
        document.getElementById('aiCopilot').checked = false;
        meetingModeGroup.classList.add('hidden');
        // Re-enable toggles that AI Copilot may have disabled
        document.getElementById('allowGuests').disabled = false;
        document.getElementById('autoTranscription').disabled = false;
    }
}

// ============================================
// AI Copilot Toggle Auto-Enable Logic
// ============================================

// Create modal: AI Copilot toggle
document.getElementById('aiCopilot').addEventListener('change', function() {
    const allowGuests = document.getElementById('allowGuests');
    const autoTranscription = document.getElementById('autoTranscription');
    const meetingModeGroup = document.getElementById('meetingModeGroup');
    if (this.checked) {
        allowGuests.checked = true;
        autoTranscription.checked = true;
        allowGuests.disabled = true;
        autoTranscription.disabled = true;
        meetingModeGroup.classList.remove('hidden');
    } else {
        allowGuests.disabled = false;
        autoTranscription.disabled = false;
        meetingModeGroup.classList.add('hidden');
    }
});

// Settings modal: AI Copilot toggle
document.getElementById('settingsAiCopilot').addEventListener('change', function() {
    const allowGuests = document.getElementById('settingsAllowGuests');
    const autoTranscription = document.getElementById('settingsAutoTranscription');
    const meetingModeGroup = document.getElementById('meetingModeSettingGroup');
    if (this.checked) {
        allowGuests.checked = true;
        autoTranscription.checked = true;
        allowGuests.disabled = true;
        autoTranscription.disabled = true;
        meetingModeGroup.style.setProperty('display', 'block', 'important');
    } else {
        allowGuests.disabled = false;
        autoTranscription.disabled = false;
        meetingModeGroup.style.setProperty('display', 'none', 'important');
    }
});

// ============================================
// Create Meeting Participants Multi-Select Dropdown
// ============================================
let createParticipantsDropdownOpen = false;
let createParticipantsFiltered = [];

async function loadCreateMeetingUsersList() {
    const container = document.getElementById('createParticipantsOptions');
    container.innerHTML = '<div class="dropdown-no-results">Loading users...</div>';

    try {
        createMeetingAllUsers = await api.getAllUsers();
        createParticipantsFiltered = [...createMeetingAllUsers];
        renderCreateParticipantsOptions();
        updateCreateParticipantsCount();
    } catch (error) {
        console.error('Error loading users:', error);
        container.innerHTML = '<div class="dropdown-no-results">Failed to load users</div>';
    }
}

function toggleCreateParticipantsDropdown() {
    const selectedDiv = document.getElementById('createParticipantsSelected');
    const menu = document.getElementById('createParticipantsMenu');
    const searchInput = document.getElementById('createParticipantsSearch');

    createParticipantsDropdownOpen = !createParticipantsDropdownOpen;

    if (createParticipantsDropdownOpen) {
        selectedDiv.classList.add('open');
        menu.classList.add('open');
        searchInput.value = '';
        createParticipantsFiltered = [...createMeetingAllUsers];
        renderCreateParticipantsOptions();
        setTimeout(() => searchInput.focus(), 50);
    } else {
        closeCreateParticipantsDropdown();
    }
}

function closeCreateParticipantsDropdown() {
    const selectedDiv = document.getElementById('createParticipantsSelected');
    const menu = document.getElementById('createParticipantsMenu');

    createParticipantsDropdownOpen = false;
    if (selectedDiv) selectedDiv.classList.remove('open');
    if (menu) menu.classList.remove('open');
}

function filterCreateParticipantsOptions() {
    const searchInput = document.getElementById('createParticipantsSearch');
    const query = searchInput.value.toLowerCase().trim();

    if (!query) {
        createParticipantsFiltered = [...createMeetingAllUsers];
    } else {
        createParticipantsFiltered = createMeetingAllUsers.filter(user => {
            const fullName = `${user.firstName || ''} ${user.lastName || ''}`.toLowerCase();
            const email = (user.email || '').toLowerCase();
            return fullName.includes(query) || email.includes(query);
        });
    }

    renderCreateParticipantsOptions();
}

function renderCreateParticipantsOptions() {
    const container = document.getElementById('createParticipantsOptions');

    if (createParticipantsFiltered.length === 0) {
        container.innerHTML = '<div class="dropdown-no-results">No users found</div>';
        return;
    }

    // Sort: selected participants first, then alphabetically by name
    const sortedUsers = [...createParticipantsFiltered].sort((a, b) => {
        const aSelected = createMeetingSelectedParticipants.includes((a.email || '').toLowerCase());
        const bSelected = createMeetingSelectedParticipants.includes((b.email || '').toLowerCase());

        if (aSelected && !bSelected) return -1;
        if (!aSelected && bSelected) return 1;

        // If same selection status, sort by name
        const aName = `${a.firstName || ''} ${a.lastName || ''}`.toLowerCase();
        const bName = `${b.firstName || ''} ${b.lastName || ''}`.toLowerCase();
        return aName.localeCompare(bName);
    });

    container.innerHTML = sortedUsers.map(user => {
        const email = user.email || '';
        const firstName = user.firstName || '';
        const lastName = user.lastName || '';
        const isSelected = createMeetingSelectedParticipants.includes(email.toLowerCase());

        return `
            <div class="dropdown-option ${isSelected ? 'selected' : ''}" onclick="toggleCreateParticipantSelection(event, '${escapeHtml(email)}')">
                <div class="option-info">
                    <div class="option-name">${escapeHtml(firstName)} ${escapeHtml(lastName)}</div>
                    <div class="option-email">${escapeHtml(email)}</div>
                </div>
                <div class="option-toggle">
                    <div class="mini-toggle ${isSelected ? 'active' : ''}"></div>
                </div>
            </div>
        `;
    }).join('');
}

function toggleCreateParticipantSelection(event, email) {
    event.stopPropagation(); // Prevent dropdown from closing
    if (!email) return;

    const lowerEmail = email.toLowerCase();
    const index = createMeetingSelectedParticipants.indexOf(lowerEmail);

    if (index > -1) {
        createMeetingSelectedParticipants.splice(index, 1);
    } else {
        createMeetingSelectedParticipants.push(lowerEmail);
    }

    updateCreateParticipantsCount();
    renderCreateParticipantsOptions();
}

function updateCreateParticipantsCount() {
    const countDisplay = document.getElementById('selectedParticipantsCount');
    if (countDisplay) {
        countDisplay.textContent = createMeetingSelectedParticipants.length;
    }
}

async function fetchAndPopulateUsers() {
    try {
        const users = await api.getAllUsers();
        const hostSelect = document.getElementById('meetingHost');
        hostSelect.innerHTML = '<option value="">Select Host</option>';

        users.forEach(user => {
            const option = document.createElement('option');
            option.value = user.userId;
            option.textContent = `${user.firstName} ${user.lastName} (${user.email})`;
            hostSelect.appendChild(option);
        });
    } catch (error) {
        console.error('Error fetching users:', error);
    }
}

// Create meeting form submission
document.getElementById('createMeetingForm').addEventListener('submit', async (e) => {
    e.preventDefault();

    if (!currentProjectId) {
        Toast.warning('Please select a project first');
        return;
    }

    const meetingName = document.getElementById('meetingName').value;

    // Combine custom date and time picker values
    const startDateVal = selectedStartDate; // YYYY-MM-DD format
    const startTimeVal = document.getElementById('startTime').value;
    const startTime = (startDateVal && startTimeVal) ? `${startDateVal}T${startTimeVal}` : null;

    const endDateVal = selectedEndDate; // YYYY-MM-DD format
    const endTimeVal = document.getElementById('endTime').value;
    const endTime = (endDateVal && endTimeVal) ? `${endDateVal}T${endTimeVal}` : null;

    const notes = document.getElementById('notes').value;
    const allowGuests = document.getElementById('allowGuests').checked;
    const autoRecording = document.getElementById('autoRecording').checked;
    const autoTranscription = document.getElementById('autoTranscription').checked;
    const aiSupport = document.getElementById('aiCopilot').checked;
    const meetingMode = aiSupport ? document.getElementById('meetingMode').value : null;
    const hostUserId = (selectedMeetingType === 'hosted' || selectedMeetingType === 'participant-controlled')
        ? (document.getElementById('meetingHost').value || null)
        : null;

    // Validate host for hosted meetings
    if (selectedMeetingType === 'hosted' && !hostUserId) {
        Toast.warning('Please select a host for the hosted meeting');
        return;
    }

    try {
        // Create the meeting
        const response = await api.createMeeting(
            currentProjectId,
            meetingName,
            startTime,
            endTime,
            notes,
            allowGuests,
            selectedMeetingType,
            autoRecording,
            hostUserId,
            autoTranscription,
            aiSupport,
            meetingMode
        );

        // Extract meeting from response (backend returns { success, message, meeting })
        const meeting = response.meeting;

        // If private meeting, add selected participants
        if (selectedMeetingType === 'participant-controlled' && createMeetingSelectedParticipants.length > 0 && meeting) {
            try {
                await api.addMultipleAllowedParticipants(meeting.id, createMeetingSelectedParticipants);
            } catch (error) {
                console.error('Error adding participants:', error);
                // Still continue, meeting was created
            }
        }

        closeModal('createMeetingModal');
        document.getElementById('createMeetingForm').reset();
        createMeetingSelectedParticipants = [];
        loadAllProjects();
    } catch (error) {
        Toast.error('Failed to create meeting: ' + error.message);
    }
});

// ============================================
// DELETE OPERATIONS
// ============================================

async function confirmDeleteProject(projectId) {
    await Confirm.show({
        title: 'Delete Project',
        message: 'This will permanently delete this project, all its meetings, recordings, and transcripts. This cannot be undone.\n\nAre you sure?',
        type: 'danger',
        confirmText: 'Delete',
        cancelText: 'Cancel',
        onConfirm: async () => {
            await api.deleteProject(projectId);
            loadAllProjects();
        }
    });
}

async function confirmDeleteMeeting(meetingId) {
    await Confirm.show({
        title: 'Delete Meeting',
        message: 'This will permanently delete this meeting, all recordings, and transcripts. This cannot be undone.\n\nAre you sure?',
        type: 'danger',
        confirmText: 'Delete',
        cancelText: 'Cancel',
        onConfirm: async () => {
            await api.permanentDeleteMeeting(meetingId);
            loadAllProjects();
        }
    });
}

async function confirmPermanentDeleteMeeting(meetingId) {
    await Confirm.show({
        title: 'Permanent Delete',
        message: 'WARNING: This will PERMANENTLY delete this meeting and all associated recordings. This action cannot be undone!\n\nAre you sure you want to permanently delete this meeting?',
        type: 'danger',
        confirmText: 'Delete Forever',
        cancelText: 'Cancel',
        onConfirm: async () => {
            await api.permanentDeleteMeeting(meetingId);
            loadAllProjects();
        }
    });
}

async function deleteMeeting(meetingId) {
    try {
        await api.permanentDeleteMeeting(meetingId);
        loadAllProjects();
    } catch (error) {
        Toast.error('Failed to delete meeting: ' + error.message);
    }
}

async function permanentDeleteMeeting(meetingId) {
    try {
        await api.permanentDeleteMeeting(meetingId);
        loadAllProjects();
    } catch (error) {
        Toast.error('Failed to permanently delete meeting: ' + error.message);
    }
}

// ============================================
// MEETING ACTIONS
// ============================================

function joinMeeting(meetingId) {
    window.open(`lobby.html?id=${meetingId}`, '_blank');
}

function copyMeetingLink(meetingId) {
    const link = `${window.location.origin}/pages/vision/lobby.html?id=${meetingId}`;
    navigator.clipboard.writeText(link).then(() => {
        showToast('Meeting link copied!');
    }).catch(() => {
        fallbackCopyToClipboard(link, 'Meeting link copied!');
    });
}

function copyGuestLink(meetingId) {
    const link = `${window.location.origin}/pages/vision/guest-join.html?id=${meetingId}`;
    navigator.clipboard.writeText(link).then(() => {
        showToast('Guest link copied!');
    }).catch(() => {
        fallbackCopyToClipboard(link, 'Guest link copied!');
    });
}

function fallbackCopyToClipboard(text, successMessage) {
    const textArea = document.createElement('textarea');
    textArea.value = text;
    document.body.appendChild(textArea);
    textArea.select();
    document.execCommand('copy');
    document.body.removeChild(textArea);
    showToast(successMessage);
}

// Local showToast removed - using unified toast.js instead

async function handleAutoRecordingToggle(meetingId, value) {
    try {
        await api.toggleAutoRecording(meetingId, value);
        console.log(`Auto-recording ${value ? 'enabled' : 'disabled'} for meeting ${meetingId}`);
    } catch (error) {
        console.error('Failed to toggle auto-recording:', error);
        Toast.error('Failed to toggle auto-recording: ' + error.message);
        const checkbox = document.getElementById(`autoRecording-${meetingId}`);
        if (checkbox) {
            checkbox.checked = !value;
        }
    }
}

// ============================================
// MANAGE PARTICIPANTS MODAL
// ============================================

let currentMeetingId = null;
let allRegisteredUsers = [];
let allowedParticipantEmails = [];
let currentFilteredUsers = [];
let displayedCount = 0;
const BATCH_SIZE = 50;
let isLoadingMore = false;
let currentFilter = 'all';

async function manageParticipants(meetingId) {
    currentMeetingId = meetingId;
    openModal('manageParticipantsModal');
    await loadAllowedParticipants(meetingId);
    await loadRegisteredUsers();
}

async function loadRegisteredUsers() {
    try {
        allRegisteredUsers = await api.getAllUsers();
        currentFilteredUsers = allRegisteredUsers;
        displayedCount = 0;
        displayRegisteredUsers(currentFilteredUsers, false);
    } catch (error) {
        console.error('Error loading users:', error);
        document.getElementById('registeredUsersList').innerHTML =
            '<p class="text-danger" style="text-align: center;">Failed to load users</p>';
    }
}

function displayRegisteredUsers(users, append = false) {
    const list = document.getElementById('registeredUsersList');
    const countDisplay = document.getElementById('userCountDisplay');

    if (!append) {
        currentFilteredUsers = users;
        displayedCount = 0;
    }

    const totalUsers = allRegisteredUsers.length;
    const filteredCount = currentFilteredUsers.length;
    countDisplay.textContent = filteredCount === totalUsers
        ? `${totalUsers} user${totalUsers !== 1 ? 's' : ''}`
        : `${filteredCount} of ${totalUsers} users`;

    if (currentFilteredUsers.length === 0) {
        list.innerHTML = '<p class="text-muted" style="text-align: center; font-size: 0.75rem; padding: 20px;">No users found</p>';
        return;
    }

    const startIndex = displayedCount;
    const endIndex = Math.min(displayedCount + BATCH_SIZE, currentFilteredUsers.length);
    const batch = currentFilteredUsers.slice(startIndex, endIndex);

    const batchHTML = batch.map(user => {
        const email = user.email || '';
        const firstName = user.firstName || '';
        const lastName = user.lastName || '';
        const isAllowed = email ? allowedParticipantEmails.includes(email.toLowerCase()) : false;

        return `
        <div class="user-select-item ${isAllowed ? 'selected' : ''}">
            <div class="user-info-compact">
                <span class="user-name-compact">${firstName} ${lastName}</span>
                <span class="user-email-compact">${email || 'No email'}</span>
            </div>
            <label class="toggle-switch-participant ${!email ? 'disabled' : ''}">
                <input type="checkbox"
                       value="${email}"
                       data-email="${email}"
                       ${isAllowed ? 'checked' : ''}
                       ${!email ? 'disabled' : ''}
                       onchange="handleParticipantToggle(this)">
                <span class="toggle-slider-participant"></span>
            </label>
        </div>
    `;
    }).join('');

    if (append) {
        list.insertAdjacentHTML('beforeend', batchHTML);
    } else {
        list.innerHTML = batchHTML;
    }

    displayedCount = endIndex;

    if (displayedCount < currentFilteredUsers.length) {
        const loadingHTML = '<div id="loading-indicator" class="text-muted" style="text-align: center; padding: 12px; font-size: 0.75rem;">Scroll for more...</div>';
        list.insertAdjacentHTML('beforeend', loadingHTML);
    }
}

function setupInfiniteScroll() {
    const list = document.getElementById('registeredUsersList');

    list.addEventListener('scroll', () => {
        if (isLoadingMore) return;

        const scrollTop = list.scrollTop;
        const scrollHeight = list.scrollHeight;
        const clientHeight = list.clientHeight;

        if (scrollTop + clientHeight >= scrollHeight - 50) {
            loadMoreUsers();
        }
    });
}

function loadMoreUsers() {
    if (isLoadingMore || displayedCount >= currentFilteredUsers.length) return;

    isLoadingMore = true;

    const loadingIndicator = document.getElementById('loading-indicator');
    if (loadingIndicator) {
        loadingIndicator.remove();
    }

    setTimeout(() => {
        displayRegisteredUsers(currentFilteredUsers, true);
        isLoadingMore = false;
    }, 100);
}

document.addEventListener('DOMContentLoaded', () => {
    setupInfiniteScroll();
});

document.getElementById('userSearchBox')?.addEventListener('input', (e) => {
    const searchTerm = e.target.value.toLowerCase();
    const clearBtn = document.getElementById('clearSearchBtn');

    clearBtn.style.display = searchTerm ? 'flex' : 'none';
    applyFilters();
});

function applyFilters() {
    const searchTerm = document.getElementById('userSearchBox').value.toLowerCase();

    let filteredUsers = allRegisteredUsers.filter(user => {
        const firstName = (user.firstName || '').toLowerCase();
        const lastName = (user.lastName || '').toLowerCase();
        const email = (user.email || '').toLowerCase();

        return firstName.includes(searchTerm) ||
               lastName.includes(searchTerm) ||
               email.includes(searchTerm);
    });

    if (currentFilter === 'selected') {
        filteredUsers = filteredUsers.filter(user =>
            allowedParticipantEmails.includes((user.email || '').toLowerCase())
        );
    } else if (currentFilter === 'unselected') {
        filteredUsers = filteredUsers.filter(user =>
            !allowedParticipantEmails.includes((user.email || '').toLowerCase())
        );
    }

    displayRegisteredUsers(filteredUsers);
}

function clearSearch() {
    document.getElementById('userSearchBox').value = '';
    document.getElementById('clearSearchBtn').style.display = 'none';
    applyFilters();
}

function filterUsers(filter) {
    currentFilter = filter;

    document.querySelectorAll('.filter-btn').forEach(btn => btn.classList.remove('active'));
    event.target.classList.add('active');

    applyFilters();
}

async function loadAllowedParticipants(meetingId) {
    try {
        const participants = await api.getAllowedParticipants(meetingId);
        allowedParticipantEmails = participants.map(p => p.user_email.toLowerCase());

        const badge = document.getElementById('participant-badge-' + meetingId);
        if (badge) {
            const count = participants.length;
            badge.textContent = `${count} participant${count !== 1 ? 's' : ''}`;
        }
    } catch (error) {
        console.error('Error loading participants:', error);
    }
}

async function handleParticipantToggle(checkbox) {
    const userEmail = checkbox.dataset.email;
    const isChecked = checkbox.checked;

    if (!userEmail) {
        Toast.error('Invalid user email');
        checkbox.checked = !isChecked;
        return;
    }

    checkbox.disabled = true;

    try {
        if (isChecked) {
            await api.addAllowedParticipant(currentMeetingId, userEmail);
            if (!allowedParticipantEmails.includes(userEmail.toLowerCase())) {
                allowedParticipantEmails.push(userEmail.toLowerCase());
            }
        } else {
            await api.removeAllowedParticipant(currentMeetingId, userEmail);
            const index = allowedParticipantEmails.indexOf(userEmail.toLowerCase());
            if (index > -1) {
                allowedParticipantEmails.splice(index, 1);
            }
        }

        await loadAllowedParticipants(currentMeetingId);
        checkbox.disabled = false;
        applyFilters();
    } catch (error) {
        checkbox.checked = !isChecked;
        checkbox.disabled = false;
        Toast.error(`Failed to ${isChecked ? 'add' : 'remove'} participant: ${error.message}`);
    }
}

// ============================================
// MODAL FUNCTIONS
// ============================================

function openModal(modalId) {
    const el = document.getElementById(modalId);
    if (!el) return;
    el.classList.add('gm-animating');
    requestAnimationFrame(() => {
        requestAnimationFrame(() => el.classList.add('active'));
    });
}

function closeModal(modalId) {
    const el = document.getElementById(modalId);
    if (!el) return;
    el.classList.remove('active');
    setTimeout(() => el.classList.remove('gm-animating'), 200);
}

window.onclick = function(event) {
    if (event.target.classList.contains('modal')) {
        const dialog = event.target.querySelector('.modal-dialog');
        dialog.style.animation = 'none';
        setTimeout(() => {
            dialog.style.animation = 'modalShake 0.5s';
        }, 10);
        setTimeout(() => {
            dialog.style.animation = '';
        }, 510);
    }
}

// ============================================
// RECORDING PLAYER
// ============================================

let currentRecordingMeetingId = null;

async function playRecording(meetingId) {
    try {
        currentRecordingMeetingId = meetingId;

        // Show panel with loading state
        const panel = document.getElementById('recordingSlidePanel');
        const overlay = document.getElementById('recordingPanelOverlay');
        const panelBody = document.getElementById('recordingPanelBody');

        panelBody.innerHTML = '<div class="panel-loading"><div class="spinner"></div></div>';
        panel.classList.add('active');
        overlay.classList.add('active');
        document.body.style.overflow = 'hidden';

        const recordings = await api.getMeetingRecordings(meetingId);

        if (!recordings || recordings.length === 0) {
            Toast.info('No recordings found for this meeting');
            closeRecordingPlayer();
            return;
        }

        const firstRecording = recordings[0];

        // Build the panel content
        let videoPlayerHtml = '';
        if (firstRecording.recording_url) {
            videoPlayerHtml = `
                <div class="panel-section recording-player-section">
                    <video controls class="recording-video-player" id="recordingPlayer">
                        <source src="${firstRecording.recording_url}" type="video/mp4">
                        Your browser does not support the video tag.
                    </video>
                    <div class="recording-actions">
                        <button class="btn-copy-url" onclick="copyRecordingUrl('${firstRecording.recording_url}')" title="Copy recording URL">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                            </svg>
                            Copy URL
                        </button>
                        <button class="btn-download" onclick="downloadRecording('${firstRecording.recording_url}')" title="Download recording">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                                <polyline points="7 10 12 15 17 10"/>
                                <line x1="12" y1="15" x2="12" y2="3"/>
                            </svg>
                            Download
                        </button>
                    </div>
                </div>
            `;
        } else {
            videoPlayerHtml = `
                <div class="panel-section">
                    <p class="recording-unavailable">Recording URL not available</p>
                </div>
            `;
        }

        const recordingsListHtml = `
            <div class="panel-section recordings-list-section">
                <div class="recordings-compact-list">
                    <div class="recordings-compact-header">
                        <span>${recordings.length} RECORDING${recordings.length > 1 ? 'S' : ''}</span>
                        <button class="btn-delete-all-recordings" onclick="confirmDeleteAllRecordings('${meetingId}')" title="Delete all recordings">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <polyline points="3 6 5 6 21 6"/>
                                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                            </svg>
                            Delete All
                        </button>
                    </div>
                    <div class="recordings-scroll-container">
                        ${recordings.map((rec, index) => {
                            const date = rec.started_at ? new Date(rec.started_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : 'No date';
                            const time = rec.started_at ? new Date(rec.started_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }) : '--:--';
                            const duration = rec.duration_seconds ? `${Math.floor(rec.duration_seconds / 60)}:${String(rec.duration_seconds % 60).padStart(2, '0')}` : '--:--';
                            return `
                            <div class="rec-item ${index === 0 ? 'playing' : ''}" data-recording-id="${rec.id}" onclick="loadRecording('${rec.recording_url}', ${index})">
                                <span class="rec-num">${index + 1}</span>
                                <div class="rec-details">
                                    <span class="rec-date">${date} ${time}</span>
                                    <span class="rec-dur">${duration}</span>
                                </div>
                                <button class="rec-copy" onclick="event.stopPropagation(); copyRecordingUrl('${rec.recording_url}')" title="Copy URL">
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                        <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                                        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                                    </svg>
                                </button>
                                <button class="rec-delete" onclick="event.stopPropagation(); confirmDeleteRecording('${rec.id}')" title="Delete recording">
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                        <polyline points="3 6 5 6 21 6"/>
                                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                                    </svg>
                                </button>
                                <button class="rec-play" onclick="event.stopPropagation(); loadRecording('${rec.recording_url}', ${index})">▶</button>
                            </div>
                        `;
                        }).join('')}
                    </div>
                </div>
            </div>
        `;

        panelBody.innerHTML = videoPlayerHtml + recordingsListHtml;

    } catch (error) {
        console.error('Error loading recordings:', error);
        Toast.error('Failed to load recordings: ' + error.message);
        closeRecordingPlayer();
    }
}

function loadRecording(url, index) {
    const player = document.getElementById('recordingPlayer');
    if (player && url) {
        player.src = url;
        player.load();
        player.play();

        document.querySelectorAll('.rec-item').forEach((item, i) => {
            item.classList.toggle('playing', i === index);
        });

        const copyBtn = document.querySelector('.btn-copy-url');
        const downloadBtn = document.querySelector('.btn-download');
        if (copyBtn) {
            copyBtn.onclick = () => copyRecordingUrl(url);
        }
        if (downloadBtn) {
            downloadBtn.onclick = () => downloadRecording(url);
        }
    }
}

function copyRecordingUrl(url) {
    navigator.clipboard.writeText(url).then(() => {
        const btn = event?.target?.closest('button');
        if (btn) {
            const originalHTML = btn.innerHTML;
            btn.innerHTML = btn.classList.contains('rec-copy') ? '✓' : `
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="20 6 9 17 4 12"/>
                </svg>
                Copied!
            `;
            btn.style.color = 'var(--color-success)';
            setTimeout(() => {
                btn.innerHTML = originalHTML;
                btn.style.color = '';
            }, 2000);
        }
    }).catch(err => {
        console.error('Failed to copy URL:', err);
        Toast.error('Failed to copy URL. Please copy manually: ' + url);
    });
}

async function downloadRecording(url) {
    const btn = event?.target?.closest('button');
    const originalHTML = btn?.innerHTML;

    try {
        // Show loading state
        if (btn) {
            btn.innerHTML = `
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="spin">
                    <circle cx="12" cy="12" r="10" stroke-dasharray="32" stroke-dashoffset="12"/>
                </svg>
                Downloading...
            `;
            btn.disabled = true;
        }

        // Fetch the video as blob
        const response = await fetch(url);
        if (!response.ok) throw new Error('Download failed');

        const blob = await response.blob();
        const blobUrl = window.URL.createObjectURL(blob);

        // Extract filename from URL or use default
        const urlParts = url.split('/');
        const filename = urlParts[urlParts.length - 1].split('?')[0] || 'recording.mp4';

        // Create temporary link and click it
        const link = document.createElement('a');
        link.href = blobUrl;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        // Clean up blob URL
        window.URL.revokeObjectURL(blobUrl);

        // Show success
        if (btn) {
            btn.innerHTML = `
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="20 6 9 17 4 12"/>
                </svg>
                Downloaded!
            `;
            setTimeout(() => {
                btn.innerHTML = originalHTML;
                btn.disabled = false;
            }, 2000);
        }
    } catch (err) {
        console.error('Download failed:', err);
        Toast.error('Download failed. Opening in new tab instead.');
        window.open(url, '_blank');

        if (btn) {
            btn.innerHTML = originalHTML;
            btn.disabled = false;
        }
    }
}

function closeRecordingPlayer() {
    const panel = document.getElementById('recordingSlidePanel');
    const overlay = document.getElementById('recordingPanelOverlay');
    const player = document.getElementById('recordingPlayer');

    if (player) {
        player.pause();
    }

    panel.classList.remove('active');
    overlay.classList.remove('active');
    document.body.style.overflow = '';
    currentRecordingMeetingId = null;
}

// Close recording panel on Escape key
document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
        const panel = document.getElementById('recordingSlidePanel');
        if (panel && panel.classList.contains('active')) {
            closeRecordingPlayer();
        }
    }
});

async function confirmDeleteRecording(recordingId) {
    await Confirm.show({
        title: 'Delete Recording',
        message: 'Are you sure you want to delete this recording? This action cannot be undone.',
        type: 'danger',
        confirmText: 'Delete',
        cancelText: 'Cancel',
        onConfirm: async () => {
            await deleteRecording(recordingId);
        }
    });
}

async function deleteRecording(recordingId) {
    try {
        const result = await api.deleteRecording(recordingId);
        if (result.success) {
            Toast.success('Recording deleted successfully');
            // Refresh the recordings list
            if (currentRecordingMeetingId) {
                const recordings = await api.getMeetingRecordings(currentRecordingMeetingId);
                if (recordings.length === 0) {
                    // No more recordings, close the modal and refresh page
                    closeRecordingPlayer();
                    await loadAllProjects();
                } else {
                    // Reload the modal with remaining recordings
                    await playRecording(currentRecordingMeetingId);
                }
            }
        } else {
            Toast.error(result.message || 'Failed to delete recording');
        }
    } catch (error) {
        console.error('Error deleting recording:', error);
        Toast.error('Failed to delete recording: ' + error.message);
    }
}

async function confirmDeleteAllRecordings(meetingId) {
    await Confirm.show({
        title: 'Delete All Recordings',
        message: 'Are you sure you want to delete ALL recordings for this meeting? This action cannot be undone.',
        type: 'danger',
        confirmText: 'Delete All',
        cancelText: 'Cancel',
        onConfirm: async () => {
            await deleteAllRecordings(meetingId);
        }
    });
}

async function deleteAllRecordings(meetingId) {
    try {
        const result = await api.deleteAllMeetingRecordings(meetingId);
        if (result.success) {
            Toast.success(result.message || 'All recordings deleted successfully');
            closeRecordingPlayer();
            await loadAllProjects();
        } else {
            Toast.error(result.message || 'Failed to delete recordings');
        }
    } catch (error) {
        console.error('Error deleting all recordings:', error);
        Toast.error('Failed to delete recordings: ' + error.message);
    }
}

// ============================================
// TRANSCRIPTS PANEL
// ============================================

let currentTranscriptsMeetingId = null;
let currentSessionId = null;

async function showTranscriptsPanel(meetingId) {
    try {
        currentTranscriptsMeetingId = meetingId;

        // Show panel with loading state
        const panel = document.getElementById('transcriptsSlidePanel');
        const overlay = document.getElementById('transcriptsPanelOverlay');
        const panelBody = document.getElementById('transcriptsPanelBody');
        const panelTitle = document.getElementById('transcriptsPanelTitle');

        panelTitle.textContent = 'Meeting Transcripts';
        panelBody.innerHTML = '<div class="panel-loading"><div class="spinner"></div></div>';
        panel.classList.add('active');
        overlay.classList.add('active');
        document.body.style.overflow = 'hidden';

        const sessions = await api.getMeetingSessions(meetingId);

        if (!sessions || sessions.length === 0) {
            panelBody.innerHTML = `
                <div class="panel-empty-state">
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="opacity: 0.5;">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                        <polyline points="14 2 14 8 20 8"/>
                        <line x1="16" y1="13" x2="8" y2="13"/>
                        <line x1="16" y1="17" x2="8" y2="17"/>
                    </svg>
                    <p>No transcripts available</p>
                    <small>Transcripts will appear here after meetings with transcription enabled</small>
                </div>
            `;
            return;
        }

        // Build sessions list
        const meetingName = sessions[0].meetingName || 'Meeting';
        panelTitle.textContent = `Transcripts - ${meetingName}`;

        let sessionsHtml = `
            <div class="panel-section">
                <div class="sessions-list">
        `;

        sessions.forEach((session, index) => {
            const startDate = new Date(session.startedAt);
            const dateStr = startDate.toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            });
            const isActive = !session.endedAt;

            sessionsHtml += `
                <div class="session-item ${isActive ? 'session-active' : ''}" data-session-id="${session.id}">
                    <div class="session-info" onclick="showSessionTranscript('${session.id}')">
                        <div class="session-header">
                            <span class="session-number">Session #${session.sessionNumber}</span>
                            ${isActive ? '<span class="badge badge-live">LIVE</span>' : ''}
                            ${session.hasSummary ? '<span class="badge badge-summary" title="Has summary/minutes">SUMMARY</span>' : ''}
                        </div>
                        <div class="session-meta">
                            <span class="session-date">${dateStr}</span>
                            <span class="session-duration">${session.durationFormatted || '--:--:--'}</span>
                        </div>
                        <div class="session-stats">
                            <span class="stat-item">
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                                    <polyline points="14 2 14 8 20 8"/>
                                </svg>
                                ${session.transcriptCount} segments
                            </span>
                            <span class="stat-item">
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                                    <circle cx="12" cy="7" r="4"/>
                                </svg>
                                ${session.participantCount || '?'} speakers
                            </span>
                        </div>
                    </div>
                    <div class="session-actions">
                        <button class="btn-icon btn-secondary btn-sm" onclick="event.stopPropagation(); showSessionTranscript('${session.id}')" title="View Transcript">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <polyline points="9 18 15 12 9 6"/>
                            </svg>
                        </button>
                        <button class="btn-icon btn-danger btn-sm" onclick="event.stopPropagation(); confirmDeleteSession('${session.id}', ${session.sessionNumber})" title="Delete Session">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <polyline points="3 6 5 6 21 6"/>
                                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                            </svg>
                        </button>
                    </div>
                </div>
            `;
        });

        sessionsHtml += `
                </div>
            </div>
        `;

        panelBody.innerHTML = sessionsHtml;

    } catch (error) {
        console.error('Error loading transcripts:', error);
        Toast.error('Failed to load transcripts: ' + error.message);
        closeTranscriptsPanel();
    }
}

async function showSessionTranscript(sessionId) {
    try {
        currentSessionId = sessionId;

        const panelBody = document.getElementById('transcriptsPanelBody');
        const panelTitle = document.getElementById('transcriptsPanelTitle');

        panelBody.innerHTML = '<div class="panel-loading"><div class="spinner"></div></div>';

        const transcript = await api.getSessionTranscript(sessionId);

        if (!transcript || !transcript.timeline || transcript.timeline.length === 0) {
            panelBody.innerHTML = `
                <div class="panel-empty-state">
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="opacity: 0.5;">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                        <polyline points="14 2 14 8 20 8"/>
                    </svg>
                    <p>No transcript content</p>
                    <button class="btn btn-secondary btn-sm" onclick="showTranscriptsPanel('${currentTranscriptsMeetingId}')">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="15 18 9 12 15 6"/>
                        </svg>
                        Back to Sessions
                    </button>
                </div>
            `;
            return;
        }

        panelTitle.textContent = `${transcript.meetingName || 'Meeting'} - Transcript`;

        // Deduplicate consecutive identical segments from same speaker (fixes repeated native transcription chunks)
        const deduplicatedTimeline = [];
        let prevSegment = null;
        for (const segment of transcript.timeline) {
            // Skip if this is an exact duplicate of previous segment (same speaker, same text, same timestamp)
            if (prevSegment &&
                segment.speakerName === prevSegment.speakerName &&
                segment.text === prevSegment.text &&
                segment.startMs === prevSegment.startMs) {
                continue; // Skip duplicate
            }
            deduplicatedTimeline.push(segment);
            prevSegment = segment;
        }
        const displayedSegmentCount = deduplicatedTimeline.length;

        // Build transcript view
        let transcriptHtml = `
            <div class="transcript-header">
                <button class="btn btn-secondary btn-sm" onclick="showTranscriptsPanel('${currentTranscriptsMeetingId}')">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="15 18 9 12 15 6"/>
                    </svg>
                    Back
                </button>
                <div class="transcript-actions">
                    <button class="btn btn-secondary btn-sm" onclick="showSpeakerRolesPanel('${currentSessionId}', '${currentTranscriptsMeetingId}')" title="Manage Speaker Roles">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                            <circle cx="9" cy="7" r="4"/>
                            <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
                            <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
                        </svg>
                        Roles
                    </button>
                    <button class="btn btn-secondary btn-sm" onclick="exportTranscript('${sessionId}', 'text')" title="Export as Text">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                            <polyline points="7 10 12 15 17 10"/>
                            <line x1="12" y1="15" x2="12" y2="3"/>
                        </svg>
                        TXT
                    </button>
                    <button class="btn btn-secondary btn-sm" onclick="exportTranscript('${sessionId}', 'json')" title="Export as JSON">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                            <polyline points="7 10 12 15 17 10"/>
                            <line x1="12" y1="15" x2="12" y2="3"/>
                        </svg>
                        JSON
                    </button>
                </div>
            </div>
            <div class="transcript-summary">
                <div class="summary-stat">
                    <span class="stat-value">${displayedSegmentCount}</span>
                    <span class="stat-label">Segments</span>
                </div>
                <div class="summary-stat">
                    <span class="stat-value">${transcript.totalSpeakers}</span>
                    <span class="stat-label">Speakers</span>
                </div>
                <div class="summary-stat">
                    <span class="stat-value">${formatDuration(transcript.totalDurationMs)}</span>
                    <span class="stat-label">Duration</span>
                </div>
            </div>
            <div class="transcript-section summary-section">
                <div class="section-header" onclick="toggleSummarySection()">
                    <h4>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                            <polyline points="14 2 14 8 20 8"/>
                            <line x1="16" y1="13" x2="8" y2="13"/>
                            <line x1="16" y1="17" x2="8" y2="17"/>
                        </svg>
                        Summary / Minutes
                    </h4>
                    <svg class="section-toggle" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="6 9 12 15 18 9"/>
                    </svg>
                </div>
                <div class="section-content" id="sessionSummaryContainer">
                    <div class="spinner-small"></div>
                </div>
            </div>
            <div class="transcript-timeline">
        `;

        // Group consecutive segments by speaker for better readability
        let currentSpeaker = null;
        deduplicatedTimeline.forEach((segment, index) => {
            const timestamp = formatTimestamp(segment.startMs);
            const isNewSpeaker = segment.speakerName !== currentSpeaker;

            if (isNewSpeaker) {
                if (currentSpeaker !== null) {
                    transcriptHtml += `</div>`; // Close previous speaker group
                }
                const roleClass = segment.speakerRole ? `badge-role-${segment.speakerRole.toLowerCase().replace(/[^a-z]/g, '')}` : '';
                const roleBadge = segment.speakerRole
                    ? `<span class="speaker-role badge badge-role ${roleClass}">${capitalizeFirst(segment.speakerRole)}</span>`
                    : '';
                transcriptHtml += `
                    <div class="speaker-group">
                        <div class="speaker-header">
                            <span class="speaker-name">${segment.speakerName || 'Unknown'}</span>
                            <div class="speaker-badges">
                                ${roleBadge}
                                <span class="speaker-source badge badge-${segment.source === 'whisper' ? 'whisper' : 'native'}">${segment.source}</span>
                            </div>
                        </div>
                `;
                currentSpeaker = segment.speakerName;
            }

            transcriptHtml += `
                <div class="transcript-segment">
                    <span class="segment-time">${timestamp}</span>
                    <span class="segment-text">${segment.text}</span>
                </div>
            `;
        });

        if (currentSpeaker !== null) {
            transcriptHtml += `</div>`; // Close last speaker group
        }

        transcriptHtml += `
            </div>
        `;

        panelBody.innerHTML = transcriptHtml;

        // Load summary section
        loadSessionSummary(sessionId);

    } catch (error) {
        console.error('Error loading session transcript:', error);
        Toast.error('Failed to load transcript: ' + error.message);
    }
}

function toggleSummarySection() {
    const section = document.querySelector('.summary-section');
    if (section) {
        section.classList.toggle('collapsed');
    }
}

function formatTimestamp(ms) {
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    if (hours > 0) {
        return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    }
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function formatDuration(ms) {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}m ${seconds}s`;
}

async function exportTranscript(sessionId, format) {
    try {
        Toast.info(`Exporting transcript as ${format.toUpperCase()}...`);

        const response = format === 'json'
            ? await fetch(`${CONFIG.visionApiBaseUrl}/transcripts/sessions/${sessionId}/export/json`, {
                headers: { 'Authorization': `Bearer ${localStorage.getItem('ragenaizer_authToken')}` }
              })
            : await fetch(`${CONFIG.visionApiBaseUrl}/transcripts/sessions/${sessionId}/export/text`, {
                headers: { 'Authorization': `Bearer ${localStorage.getItem('ragenaizer_authToken')}` }
              });

        if (!response.ok) {
            throw new Error('Export failed');
        }

        const blob = await response.blob();
        const contentDisposition = response.headers.get('Content-Disposition');
        let filename = `transcript.${format === 'json' ? 'json' : 'txt'}`;

        if (contentDisposition) {
            const match = contentDisposition.match(/filename="?([^"]+)"?/);
            if (match) filename = match[1];
        }

        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);

        Toast.success('Transcript exported successfully');
    } catch (error) {
        console.error('Error exporting transcript:', error);
        Toast.error('Failed to export transcript');
    }
}

function closeTranscriptsPanel() {
    const panel = document.getElementById('transcriptsSlidePanel');
    const overlay = document.getElementById('transcriptsPanelOverlay');

    panel.classList.remove('active');
    overlay.classList.remove('active');
    document.body.style.overflow = '';
    currentTranscriptsMeetingId = null;
    currentSessionId = null;
}

// Close transcripts panel on Escape key
document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
        const panel = document.getElementById('transcriptsSlidePanel');
        if (panel && panel.classList.contains('active')) {
            closeTranscriptsPanel();
        }
    }
});

// ============================================
// SESSION MANAGEMENT
// ============================================

async function confirmDeleteSession(sessionId, sessionNumber) {
    const confirmed = await Confirm.show({
        title: `Delete Session #${sessionNumber}?`,
        message: 'This will permanently delete:\n• All transcript segments\n• The session summary/minutes (if any)\n\nThis action cannot be undone.',
        type: 'danger',
        confirmText: 'Delete',
        cancelText: 'Cancel'
    });

    if (!confirmed) {
        return;
    }

    // Find the session item and add loading state
    const sessionItem = document.querySelector(`.session-item[data-session-id="${sessionId}"]`);
    if (sessionItem) {
        sessionItem.classList.add('loading');
    }

    try {
        await api.deleteSession(sessionId);
        Toast.success(`Session #${sessionNumber} deleted`);

        // Remove the session item from the DOM
        if (sessionItem) {
            sessionItem.remove();
        }

        // Check if no sessions left
        const remainingSessions = document.querySelectorAll('.session-item');
        if (remainingSessions.length === 0) {
            const panelBody = document.getElementById('transcriptsPanelBody');
            panelBody.innerHTML = `
                <div class="panel-empty-state">
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="opacity: 0.5;">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                        <polyline points="14 2 14 8 20 8"/>
                    </svg>
                    <p>No transcripts available</p>
                    <small>Transcripts will appear here after meetings with transcription enabled</small>
                </div>
            `;
        }
    } catch (error) {
        console.error('Error deleting session:', error);
        Toast.error('Failed to delete session: ' + error.message);
        // Remove loading state on error
        if (sessionItem) {
            sessionItem.classList.remove('loading');
        }
    }
}

async function loadSessionSummary(sessionId) {
    try {
        const summaryContainer = document.getElementById('sessionSummaryContainer');
        if (!summaryContainer) return;

        summaryContainer.innerHTML = '<div class="spinner-small"></div>';

        const response = await api.getSessionSummary(sessionId);
        const hasSummary = response.hasSummary && response.summaryText;

        // Store the full summary text for the modal
        if (hasSummary) {
            window.currentSummaryText = response.summaryText;
            window.currentSummaryUpdatedAt = response.uploadedAt;
        }

        summaryContainer.innerHTML = `
            <div class="summary-content">
                ${hasSummary ? `
                    <div class="summary-text-display" id="summaryTextDisplay">
                        <pre>${escapeHtml(response.summaryText)}</pre>
                    </div>
                    <div class="summary-meta">
                        <small>Last updated: ${response.uploadedAt ? new Date(response.uploadedAt).toLocaleString() : 'N/A'}</small>
                    </div>
                ` : `
                    <div class="summary-empty">
                        <p>No summary/minutes for this session yet.</p>
                    </div>
                `}
                <div class="summary-actions">
                    ${hasSummary ? `
                    <button class="btn btn-secondary btn-sm" onclick="openSummaryModal()">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M15 3h6v6"/>
                            <path d="M10 14L21 3"/>
                            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                        </svg>
                        View Full
                    </button>
                    ` : ''}
                    <button class="btn btn-secondary btn-sm" onclick="showSummaryEditor('${sessionId}')">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                        </svg>
                        ${hasSummary ? 'Edit Summary' : 'Add Summary'}
                    </button>
                    <label class="btn btn-secondary btn-sm">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                            <polyline points="17 8 12 3 7 8"/>
                            <line x1="12" y1="3" x2="12" y2="15"/>
                        </svg>
                        Upload File
                        <input type="file" accept=".txt,.md,.text" style="display: none;" onchange="uploadSummaryFile('${sessionId}', this)">
                    </label>
                </div>
            </div>
        `;
    } catch (error) {
        console.error('Error loading session summary:', error);
        const summaryContainer = document.getElementById('sessionSummaryContainer');
        if (summaryContainer) {
            summaryContainer.innerHTML = '<p class="text-error">Failed to load summary</p>';
        }
    }
}

function showSummaryEditor(sessionId) {
    const summaryContainer = document.getElementById('sessionSummaryContainer');
    if (!summaryContainer) return;

    const existingText = document.querySelector('#summaryTextDisplay pre')?.textContent || '';

    summaryContainer.innerHTML = `
        <div class="summary-editor">
            <textarea id="summaryTextarea" rows="10" placeholder="Enter meeting summary or minutes...">${escapeHtml(existingText)}</textarea>
            <div class="summary-editor-actions">
                <button class="btn btn-primary btn-sm" onclick="saveSummary('${sessionId}')">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
                        <polyline points="17 21 17 13 7 13 7 21"/>
                        <polyline points="7 3 7 8 15 8"/>
                    </svg>
                    Save
                </button>
                <button class="btn btn-secondary btn-sm" onclick="loadSessionSummary('${sessionId}')">
                    Cancel
                </button>
            </div>
        </div>
    `;

    // Focus the textarea
    document.getElementById('summaryTextarea')?.focus();
}

async function saveSummary(sessionId) {
    try {
        const textarea = document.getElementById('summaryTextarea');
        if (!textarea) return;

        const summaryText = textarea.value.trim();
        Toast.info('Saving summary...');

        await api.updateSessionSummary(sessionId, summaryText);
        Toast.success('Summary saved successfully');

        // Reload the summary section
        await loadSessionSummary(sessionId);
    } catch (error) {
        console.error('Error saving summary:', error);
        Toast.error('Failed to save summary: ' + error.message);
    }
}

async function uploadSummaryFile(sessionId, input) {
    if (!input.files || input.files.length === 0) return;

    const file = input.files[0];

    // Validate file type
    const allowedTypes = ['.txt', '.md', '.text'];
    const extension = '.' + file.name.split('.').pop().toLowerCase();
    if (!allowedTypes.includes(extension)) {
        Toast.error('Only text files (.txt, .md) are allowed');
        input.value = '';
        return;
    }

    // Validate file size (1MB max)
    if (file.size > 1024 * 1024) {
        Toast.error('File size must be less than 1MB');
        input.value = '';
        return;
    }

    try {
        Toast.info('Uploading summary...');
        await api.uploadSessionSummary(sessionId, file);
        Toast.success('Summary uploaded successfully');

        // Reload the summary section
        await loadSessionSummary(sessionId);
    } catch (error) {
        console.error('Error uploading summary:', error);
        Toast.error('Failed to upload summary: ' + error.message);
    } finally {
        input.value = '';
    }
}

// ============================================
// SUMMARY MODAL - Using same pattern as speaker-roles-modal
// ============================================

// Inject styles once (same pattern as speaker-roles-modal)
(function injectSummaryModalStyles() {
    if (document.getElementById('summary-modal-styles')) return;
    const style = document.createElement('style');
    style.id = 'summary-modal-styles';
    style.textContent = `
        .summary-modal-overlay {
            position: fixed !important;
            top: 0 !important;
            left: 0 !important;
            right: 0 !important;
            bottom: 0 !important;
            background: var(--overlay-dark, rgba(0, 0, 0, 0.5)) !important;
            display: flex !important;
            align-items: flex-start !important;
            justify-content: center !important;
            z-index: 2147483647 !important;
            opacity: 0;
            transition: opacity 200ms ease;
            padding-top: 80px;
            box-sizing: border-box;
        }
        .summary-modal-overlay.active {
            opacity: 1;
        }
        .summary-modal {
            background: rgba(15, 23, 42, 0.6) !important;
            border-radius: 16px !important;
            max-width: 1400px;
            width: calc(100% - 48px);
            height: calc(100vh - 120px);
            max-height: calc(100vh - 120px);
            display: flex;
            flex-direction: column;
            transform: scale(0.95);
            transition: transform 200ms ease, box-shadow 300ms ease, border-color 300ms ease;
            overflow: hidden;
            border: 1px solid rgba(255, 255, 255, 0.08) !important;
            box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2) !important;
            backdrop-filter: blur(24px) saturate(150%);
            -webkit-backdrop-filter: blur(24px) saturate(150%);
        }
        .summary-modal-overlay.active .summary-modal {
            transform: scale(1);
        }
        .summary-modal:hover {
            border-color: rgba(var(--brand-primary-rgb, 99, 102, 241), 0.5) !important;
            box-shadow:
                0 0 20px rgba(var(--brand-primary-rgb, 99, 102, 241), 0.25),
                0 0 40px rgba(var(--brand-primary-rgb, 99, 102, 241), 0.1),
                0 8px 24px rgba(0, 0, 0, 0.2) !important;
        }
        [data-theme="light"] .summary-modal {
            background: rgba(255, 255, 255, 0.7) !important;
            border: 1px solid rgba(0, 0, 0, 0.06) !important;
            box-shadow: 0 8px 24px rgba(0, 0, 0, 0.08) !important;
        }
        [data-theme="light"] .summary-modal:hover {
            border-color: rgba(var(--brand-primary-rgb, 99, 102, 241), 0.4) !important;
            box-shadow:
                0 0 20px rgba(var(--brand-primary-rgb, 99, 102, 241), 0.15),
                0 0 40px rgba(var(--brand-primary-rgb, 99, 102, 241), 0.08),
                0 8px 24px rgba(0, 0, 0, 0.08) !important;
        }
        .summary-modal-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 16px 20px;
            border-bottom: 1px solid rgba(255, 255, 255, 0.06);
            position: relative;
            background: transparent;
        }
        .summary-modal-header::before {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            height: 80px;
            background: linear-gradient(180deg, rgba(var(--brand-primary-rgb, 99, 102, 241), 0.06) 0%, transparent 100%);
            pointer-events: none;
            border-radius: 14px 14px 0 0;
        }
        [data-theme="light"] .summary-modal-header {
            border-bottom: 1px solid rgba(0, 0, 0, 0.06);
        }
        .summary-modal-header h3 {
            margin: 0;
            font-size: 16px;
            font-weight: 600;
            color: var(--text-primary);
            position: relative;
            z-index: 1;
            display: flex;
            align-items: center;
            gap: 10px;
        }
        .summary-modal-header h3 svg {
            color: var(--brand-primary);
        }
        .summary-modal-close {
            background: var(--brand-primary);
            border: none;
            width: 28px;
            height: 28px;
            padding: 0;
            cursor: pointer;
            color: white;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: opacity 0.15s ease;
            position: relative;
            z-index: 1;
        }
        .summary-modal-close:hover {
            opacity: 0.9;
        }
        .summary-modal-body {
            padding: 20px;
            overflow-y: auto;
            flex: 1;
        }
        .summary-modal-body pre {
            margin: 0;
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
            font-size: 0.95rem;
            line-height: 1.7;
            color: var(--text-primary);
            white-space: pre-wrap;
            word-wrap: break-word;
        }
        .summary-modal-footer {
            padding: 14px 20px;
            background: rgba(0, 0, 0, 0.15);
            border-top: 1px solid rgba(255, 255, 255, 0.06);
        }
        [data-theme="light"] .summary-modal-footer {
            background: rgba(0, 0, 0, 0.03);
            border-top: 1px solid rgba(0, 0, 0, 0.06);
        }
        .summary-modal-footer small {
            color: var(--text-tertiary);
            font-size: 12px;
        }
        /* Mobile responsive */
        @media (max-width: 768px) {
            .summary-modal {
                width: calc(100% - 24px);
                height: calc(100vh - 48px);
                max-height: calc(100vh - 48px);
                border-radius: 12px !important;
            }
            .summary-modal-header {
                padding: 14px 16px;
            }
            .summary-modal-header h3 {
                font-size: 15px;
            }
            .summary-modal-body {
                padding: 16px;
                font-size: 14px;
            }
            .summary-modal-footer {
                padding: 12px 16px;
            }
        }
        @media (max-width: 480px) {
            .summary-modal {
                width: calc(100% - 16px);
                height: calc(100vh - 32px);
                max-height: calc(100vh - 32px);
                border-radius: 10px !important;
            }
            .summary-modal-header {
                padding: 12px 14px;
            }
            .summary-modal-header h3 {
                font-size: 14px;
            }
            .summary-modal-body {
                padding: 14px;
                font-size: 13px;
                line-height: 1.5;
            }
            .summary-modal-footer {
                padding: 10px 14px;
            }
            .summary-modal-footer small {
                font-size: 11px;
            }
        }
    `;
    document.head.appendChild(style);
})();

function openSummaryModal() {
    const summaryText = window.currentSummaryText || '';
    const updatedAt = window.currentSummaryUpdatedAt;

    if (!summaryText) {
        Toast.error('No summary to display');
        return;
    }

    // Remove existing overlay if any
    const existingOverlay = document.getElementById('summaryModalOverlay');
    if (existingOverlay) existingOverlay.remove();

    // Create overlay
    const overlay = document.createElement('div');
    overlay.id = 'summaryModalOverlay';
    overlay.className = 'summary-modal-overlay';

    overlay.innerHTML = `
        <div class="summary-modal">
            <div class="summary-modal-header">
                <h3>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                        <polyline points="14 2 14 8 20 8"/>
                        <line x1="16" y1="13" x2="8" y2="13"/>
                        <line x1="16" y1="17" x2="8" y2="17"/>
                        <polyline points="10 9 9 9 8 9"/>
                    </svg>
                    Summary / Minutes
                </h3>
                <button class="summary-modal-close" onclick="closeSummaryModal()">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <line x1="18" y1="6" x2="6" y2="18"/>
                        <line x1="6" y1="6" x2="18" y2="18"/>
                    </svg>
                </button>
            </div>
            <div class="summary-modal-body">
                <pre>${escapeHtml(summaryText)}</pre>
            </div>
            <div class="summary-modal-footer">
                <small>Last updated: ${updatedAt ? new Date(updatedAt).toLocaleString() : 'N/A'}</small>
            </div>
        </div>
    `;

    document.body.appendChild(overlay);
    document.body.style.overflow = 'hidden';

    // Animate in
    requestAnimationFrame(() => {
        overlay.classList.add('active');
    });

    // Close on backdrop click
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) closeSummaryModal();
    });

    // Close on escape
    const escHandler = (e) => {
        if (e.key === 'Escape') {
            closeSummaryModal();
            document.removeEventListener('keydown', escHandler);
        }
    };
    document.addEventListener('keydown', escHandler);
}

function closeSummaryModal() {
    const overlay = document.getElementById('summaryModalOverlay');
    if (overlay) {
        overlay.classList.remove('active');
        document.body.style.overflow = '';
        setTimeout(() => overlay.remove(), 200);
    }
}

// Helper to escape HTML
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ============================================
// MEETING SETTINGS MODAL
// ============================================

let currentSettingsMeeting = null;
let settingsSelectedParticipants = [];
let settingsAllUsers = [];

async function showMeetingSettingsModal(meetingId, type) {
    const modal = document.getElementById('meetingSettingsModal');
    document.getElementById('settingsMeetingId').value = meetingId;
    document.getElementById('settingsMeetingType').value = type;

    const saveBtn = modal.querySelector('.btn-primary');
    if (saveBtn) saveBtn.disabled = true;

    try {
        let meeting = null;

        const projects = await api.getProjects();
        for (const project of projects) {
            const meetings = await api.getProjectMeetings(project.id);
            meeting = meetings.find(m => m.id === meetingId);
            if (meeting) break;
        }

        if (!meeting) {
            try {
                const hostedMeetings = await api.getHostedMeetings();
                meeting = hostedMeetings.find(m => m.id === meetingId);
            } catch (err) {
                console.log('Error fetching hosted meetings:', err);
            }
        }

        if (!meeting) {
            Toast.error('Meeting not found');
            return;
        }

        currentSettingsMeeting = meeting;

        // Update meeting type display
        const typeDisplay = document.getElementById('settingsMeetingTypeDisplay');
        typeDisplay.innerHTML = getTypeBadgeHTML(type);

        await populateSettingsHostDropdown(meeting.host_user_id, type);

        document.getElementById('settingsNotes').value = meeting.notes || '';
        document.getElementById('settingsAllowGuests').checked = meeting.allow_guests || false;
        document.getElementById('settingsAutoRecording').checked = meeting.auto_recording || false;
        document.getElementById('settingsAutoTranscription').checked = meeting.auto_transcription || false;
        document.getElementById('settingsAiCopilot').checked = meeting.ai_support || false;
        if (meeting.meeting_mode) {
            document.getElementById('settingsMeetingMode').value = meeting.meeting_mode;
        }

        // Show/hide fields based on meeting type
        const allowGuestsGroup = document.getElementById('allowGuestsSettingGroup');
        const hostGroup = document.getElementById('hostSettingGroup');
        const hostHelp = document.getElementById('hostSettingHelp');
        const participantsGroup = document.getElementById('settingsParticipantsGroup');
        const aiCopilotGroup = document.getElementById('aiCopilotSettingGroup');
        const meetingModeGroup = document.getElementById('meetingModeSettingGroup');

        if (type === 'participant-controlled') {
            allowGuestsGroup.style.display = 'none';
            hostGroup.style.display = 'block';
            hostHelp.textContent = 'If set, the host must start the meeting before allowed participants can join';
            participantsGroup.style.display = 'block';
            aiCopilotGroup.style.setProperty('display', 'none', 'important');
            meetingModeGroup.style.setProperty('display', 'none', 'important');
            await loadSettingsParticipantsList(meetingId);
        } else if (type === 'hosted') {
            allowGuestsGroup.style.display = 'block';
            hostGroup.style.display = 'block';
            hostHelp.textContent = 'Required - the host must start the meeting before others can join';
            participantsGroup.style.display = 'none';
            aiCopilotGroup.style.setProperty('display', tenantHasLlmKey ? 'block' : 'none', 'important');
            meetingModeGroup.style.setProperty('display', (tenantHasLlmKey && meeting.ai_support) ? 'block' : 'none', 'important');
        } else {
            allowGuestsGroup.style.display = 'block';
            hostGroup.style.display = 'none';
            participantsGroup.style.display = 'none';
            aiCopilotGroup.style.setProperty('display', 'none', 'important');
            meetingModeGroup.style.setProperty('display', 'none', 'important');
        }

        // If AI Copilot is on, disable guest access and transcription toggles
        if (meeting.ai_support) {
            document.getElementById('settingsAllowGuests').disabled = true;
            document.getElementById('settingsAutoTranscription').disabled = true;
        }

        const warningDiv = document.getElementById('settingsInProgressWarning');
        const isStarted = meeting.is_started || false;

        if (isStarted) {
            warningDiv.style.display = 'flex';
            document.getElementById('settingsNotes').disabled = true;
            document.getElementById('settingsAllowGuests').disabled = true;
            setHostDropdownDisabled(true);
            document.getElementById('settingsAutoRecording').disabled = true;
            document.getElementById('settingsAutoTranscription').disabled = true;
            document.getElementById('settingsAiCopilot').disabled = true;
            document.getElementById('settingsMeetingMode').disabled = true;
            if (saveBtn) saveBtn.disabled = true;
        } else {
            warningDiv.style.display = 'none';
            document.getElementById('settingsNotes').disabled = false;
            document.getElementById('settingsAllowGuests').disabled = false;
            setHostDropdownDisabled(false);
            document.getElementById('settingsAutoRecording').disabled = false;
            document.getElementById('settingsAutoTranscription').disabled = false;
            document.getElementById('settingsAiCopilot').disabled = false;
            document.getElementById('settingsMeetingMode').disabled = false;
            if (saveBtn) saveBtn.disabled = false;
            // Re-apply AI Copilot lock if active (after clearing in-progress overrides)
            if (meeting.ai_support) {
                document.getElementById('settingsAllowGuests').disabled = true;
                document.getElementById('settingsAutoTranscription').disabled = true;
            }
        }

        modal.classList.add('gm-animating');
        requestAnimationFrame(() => {
            requestAnimationFrame(() => modal.classList.add('active'));
        });

    } catch (error) {
        console.error('Error loading meeting settings:', error);
        Toast.error('Failed to load meeting settings: ' + error.message);
    }
}

// ============================================
// Settings Participants Multi-Select Dropdown
// ============================================
let settingsParticipantsDropdownOpen = false;
let settingsParticipantsFiltered = [];

async function loadSettingsParticipantsList(meetingId) {
    const container = document.getElementById('settingsParticipantsOptions');
    container.innerHTML = '<div class="dropdown-no-results">Loading users...</div>';

    try {
        // Load allowed participants first
        const participants = await api.getAllowedParticipants(meetingId);
        settingsSelectedParticipants = participants.map(p => p.user_email.toLowerCase());

        // Load all users
        settingsAllUsers = await api.getAllUsers();
        settingsParticipantsFiltered = [...settingsAllUsers];
        renderSettingsParticipantsOptions();
        updateSettingsParticipantsCount();
    } catch (error) {
        console.error('Error loading users:', error);
        container.innerHTML = '<div class="dropdown-no-results">Failed to load users</div>';
    }
}

function toggleSettingsParticipantsDropdown() {
    const selectedDiv = document.getElementById('settingsParticipantsSelected');
    const menu = document.getElementById('settingsParticipantsMenu');
    const searchInput = document.getElementById('settingsParticipantsSearch');

    settingsParticipantsDropdownOpen = !settingsParticipantsDropdownOpen;

    if (settingsParticipantsDropdownOpen) {
        selectedDiv.classList.add('open');
        menu.classList.add('open');
        searchInput.value = '';
        settingsParticipantsFiltered = [...settingsAllUsers];
        renderSettingsParticipantsOptions();
        setTimeout(() => searchInput.focus(), 50);
    } else {
        closeSettingsParticipantsDropdown();
    }
}

function closeSettingsParticipantsDropdown() {
    const selectedDiv = document.getElementById('settingsParticipantsSelected');
    const menu = document.getElementById('settingsParticipantsMenu');

    settingsParticipantsDropdownOpen = false;
    if (selectedDiv) selectedDiv.classList.remove('open');
    if (menu) menu.classList.remove('open');
}

function filterSettingsParticipantsOptions() {
    const searchInput = document.getElementById('settingsParticipantsSearch');
    const query = searchInput.value.toLowerCase().trim();

    if (!query) {
        settingsParticipantsFiltered = [...settingsAllUsers];
    } else {
        settingsParticipantsFiltered = settingsAllUsers.filter(user => {
            const fullName = `${user.firstName || ''} ${user.lastName || ''}`.toLowerCase();
            const email = (user.email || '').toLowerCase();
            return fullName.includes(query) || email.includes(query);
        });
    }

    renderSettingsParticipantsOptions();
}

function renderSettingsParticipantsOptions() {
    const container = document.getElementById('settingsParticipantsOptions');

    if (settingsParticipantsFiltered.length === 0) {
        container.innerHTML = '<div class="dropdown-no-results">No users found</div>';
        return;
    }

    // Sort: selected participants first, then alphabetically by name
    const sortedUsers = [...settingsParticipantsFiltered].sort((a, b) => {
        const aSelected = settingsSelectedParticipants.includes((a.email || '').toLowerCase());
        const bSelected = settingsSelectedParticipants.includes((b.email || '').toLowerCase());

        if (aSelected && !bSelected) return -1;
        if (!aSelected && bSelected) return 1;

        // If same selection status, sort by name
        const aName = `${a.firstName || ''} ${a.lastName || ''}`.toLowerCase();
        const bName = `${b.firstName || ''} ${b.lastName || ''}`.toLowerCase();
        return aName.localeCompare(bName);
    });

    container.innerHTML = sortedUsers.map(user => {
        const email = user.email || '';
        const firstName = user.firstName || '';
        const lastName = user.lastName || '';
        const isSelected = settingsSelectedParticipants.includes(email.toLowerCase());

        return `
            <div class="dropdown-option ${isSelected ? 'selected' : ''}" onclick="toggleSettingsParticipantSelection(event, '${escapeHtml(email)}')">
                <div class="option-info">
                    <div class="option-name">${escapeHtml(firstName)} ${escapeHtml(lastName)}</div>
                    <div class="option-email">${escapeHtml(email)}</div>
                </div>
                <div class="option-toggle">
                    <div class="mini-toggle ${isSelected ? 'active' : ''}"></div>
                </div>
            </div>
        `;
    }).join('');
}

async function toggleSettingsParticipantSelection(event, email) {
    event.stopPropagation(); // Prevent dropdown from closing
    if (!email) return;

    const lowerEmail = email.toLowerCase();
    const meetingId = document.getElementById('settingsMeetingId').value;
    const isCurrentlySelected = settingsSelectedParticipants.includes(lowerEmail);

    try {
        if (isCurrentlySelected) {
            await api.removeAllowedParticipant(meetingId, email);
            const index = settingsSelectedParticipants.indexOf(lowerEmail);
            if (index > -1) {
                settingsSelectedParticipants.splice(index, 1);
            }
        } else {
            await api.addAllowedParticipant(meetingId, email);
            settingsSelectedParticipants.push(lowerEmail);
        }

        updateSettingsParticipantsCount();
        renderSettingsParticipantsOptions();
    } catch (error) {
        Toast.error(`Failed to ${isCurrentlySelected ? 'remove' : 'add'} participant: ${error.message}`);
    }
}

function updateSettingsParticipantsCount() {
    const countDisplay = document.getElementById('settingsParticipantsCount');
    if (countDisplay) {
        countDisplay.textContent = settingsSelectedParticipants.length;
    }
}

// Host dropdown state
let hostDropdownUsers = [];
let hostDropdownFiltered = [];
let hostDropdownSelectedId = '';
let hostDropdownOpen = false;
const HOST_ITEM_HEIGHT = 36; // Height of each option in pixels (smaller)
const HOST_VISIBLE_ITEMS = 5; // Number of visible items

async function populateSettingsHostDropdown(currentHostId = null, meetingType = 'regular') {
    const hiddenInput = document.getElementById('settingsHost');
    const selectedDiv = document.getElementById('settingsHostSelected');
    const optionsContainer = document.getElementById('settingsHostOptions');

    hostDropdownSelectedId = currentHostId || '';

    try {
        const users = await api.getAllUsers();
        // Only add "No host" option for regular meetings (not for hosted or participant-controlled)
        if (meetingType === 'regular') {
            hostDropdownUsers = [
                { userId: '', firstName: 'No host', lastName: '(open meeting)', email: '' },
                ...users
            ];
        } else {
            // Hosted and participant-controlled meetings require a host
            hostDropdownUsers = [...users];
            // If no host is currently set, select the first user
            if (!currentHostId && users.length > 0) {
                hostDropdownSelectedId = users[0].userId;
            }
        }
        hostDropdownFiltered = [...hostDropdownUsers];

        // Set initial selection
        updateHostDropdownSelection();
        renderHostDropdownOptions();

    } catch (error) {
        console.error('Error fetching users for host selection:', error);
        hostDropdownUsers = [];
        hostDropdownFiltered = [];
        renderHostDropdownOptions();
    }
}

function updateHostDropdownSelection() {
    const hiddenInput = document.getElementById('settingsHost');
    const selectedDiv = document.getElementById('settingsHostSelected');
    const selectedText = selectedDiv.querySelector('.selected-text');

    hiddenInput.value = hostDropdownSelectedId;

    const selectedUser = hostDropdownUsers.find(u => u.userId === hostDropdownSelectedId);
    if (selectedUser) {
        if (selectedUser.userId === '') {
            selectedText.textContent = 'No host (open meeting)';
        } else {
            selectedText.textContent = `${selectedUser.firstName} ${selectedUser.lastName} (${selectedUser.email})`;
        }
    } else {
        selectedText.textContent = 'No host (open meeting)';
    }
}

function toggleHostDropdown() {
    const selectedDiv = document.getElementById('settingsHostSelected');
    const menu = document.getElementById('settingsHostMenu');
    const searchInput = document.getElementById('settingsHostSearch');

    // Check if disabled
    if (selectedDiv.classList.contains('disabled')) return;

    hostDropdownOpen = !hostDropdownOpen;

    if (hostDropdownOpen) {
        selectedDiv.classList.add('open');
        menu.classList.add('open');
        searchInput.value = '';
        hostDropdownFiltered = [...hostDropdownUsers];
        renderHostDropdownOptions();
        setTimeout(() => searchInput.focus(), 50);
    } else {
        closeHostDropdown();
    }
}

function closeHostDropdown() {
    const selectedDiv = document.getElementById('settingsHostSelected');
    const menu = document.getElementById('settingsHostMenu');

    hostDropdownOpen = false;
    selectedDiv.classList.remove('open');
    menu.classList.remove('open');
}

function filterHostOptions() {
    const searchInput = document.getElementById('settingsHostSearch');
    const query = searchInput.value.toLowerCase().trim();

    if (!query) {
        hostDropdownFiltered = [...hostDropdownUsers];
    } else {
        hostDropdownFiltered = hostDropdownUsers.filter(user => {
            const fullName = `${user.firstName} ${user.lastName}`.toLowerCase();
            const email = user.email.toLowerCase();
            return fullName.includes(query) || email.includes(query);
        });
    }

    renderHostDropdownOptions();
}

function renderHostDropdownOptions() {
    const container = document.getElementById('settingsHostOptions');

    if (hostDropdownFiltered.length === 0) {
        container.innerHTML = '<div class="dropdown-no-results">No users found</div>';
        return;
    }

    // Virtual scrolling: only render visible items + buffer
    const totalHeight = hostDropdownFiltered.length * HOST_ITEM_HEIGHT;

    // Create virtual scroll content
    let html = `<div class="virtual-scroll-content" style="height: ${totalHeight}px;">`;

    // For simplicity with reasonable user counts, render all but with efficient HTML
    // True virtual scrolling would require scroll event handling
    hostDropdownFiltered.forEach((user, index) => {
        const isSelected = user.userId === hostDropdownSelectedId;
        const displayName = user.userId === ''
            ? 'No host (open meeting)'
            : `${user.firstName} ${user.lastName}`;
        const displayEmail = user.email || '';

        html += `
            <div class="dropdown-option ${isSelected ? 'selected' : ''}"
                 onclick="selectHostOption('${user.userId}')"
                 style="position: absolute; top: ${index * HOST_ITEM_HEIGHT}px; left: 0; right: 0; height: ${HOST_ITEM_HEIGHT}px;">
                <div class="option-name">${escapeHtml(displayName)}</div>
                ${displayEmail ? `<div class="option-email">${escapeHtml(displayEmail)}</div>` : ''}
            </div>
        `;
    });

    html += '</div>';
    container.innerHTML = html;
}

function selectHostOption(userId) {
    hostDropdownSelectedId = userId;
    updateHostDropdownSelection();
    closeHostDropdown();
}

function setHostDropdownDisabled(disabled) {
    const selectedDiv = document.getElementById('settingsHostSelected');
    if (disabled) {
        selectedDiv.classList.add('disabled');
    } else {
        selectedDiv.classList.remove('disabled');
    }
}

// Helper function to escape HTML
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Close dropdowns when clicking outside
document.addEventListener('click', function(e) {
    // Settings Host Dropdown
    const settingsDropdown = document.getElementById('settingsHostDropdown');
    if (settingsDropdown && !settingsDropdown.contains(e.target) && hostDropdownOpen) {
        closeHostDropdown();
    }
    // Create Host Dropdown
    const createDropdown = document.getElementById('createHostDropdown');
    if (createDropdown && !createDropdown.contains(e.target) && createHostDropdownOpen) {
        closeCreateHostDropdown();
    }
    // Create Participants Multi-Select Dropdown
    const createParticipantsDropdown = document.getElementById('createParticipantsDropdown');
    if (createParticipantsDropdown && !createParticipantsDropdown.contains(e.target) && createParticipantsDropdownOpen) {
        closeCreateParticipantsDropdown();
    }
    // Settings Participants Multi-Select Dropdown
    const settingsParticipantsDropdown = document.getElementById('settingsParticipantsDropdown');
    if (settingsParticipantsDropdown && !settingsParticipantsDropdown.contains(e.target) && settingsParticipantsDropdownOpen) {
        closeSettingsParticipantsDropdown();
    }
});

// ============================================
// Create Meeting Host Dropdown (searchable)
// ============================================
let createHostDropdownUsers = [];
let createHostDropdownFiltered = [];
let createHostDropdownSelectedId = '';
let createHostDropdownOpen = false;

async function populateCreateHostDropdown(meetingType = 'regular') {
    const hiddenInput = document.getElementById('meetingHost');
    const selectedDiv = document.getElementById('createHostSelected');
    const optionsContainer = document.getElementById('createHostOptions');

    createHostDropdownSelectedId = '';

    try {
        const users = await api.getAllUsers();
        // Only add "No host" option for regular meetings
        if (meetingType === 'regular') {
            createHostDropdownUsers = [
                { userId: '', firstName: 'No host', lastName: '(open meeting)', email: '' },
                ...users
            ];
        } else {
            // Hosted and participant-controlled meetings require a host
            createHostDropdownUsers = [...users];
            // Auto-select first user for hosted meetings
            if (users.length > 0) {
                createHostDropdownSelectedId = users[0].userId;
            }
        }
        createHostDropdownFiltered = [...createHostDropdownUsers];

        updateCreateHostDropdownSelection();
        renderCreateHostDropdownOptions();

    } catch (error) {
        console.error('Error fetching users for host selection:', error);
        createHostDropdownUsers = [];
        createHostDropdownFiltered = [];
        renderCreateHostDropdownOptions();
    }
}

function updateCreateHostDropdownSelection() {
    const hiddenInput = document.getElementById('meetingHost');
    const selectedDiv = document.getElementById('createHostSelected');
    const selectedText = selectedDiv.querySelector('.selected-text');

    hiddenInput.value = createHostDropdownSelectedId;

    const selectedUser = createHostDropdownUsers.find(u => u.userId === createHostDropdownSelectedId);
    if (selectedUser) {
        if (selectedUser.userId === '') {
            selectedText.textContent = 'No host (open meeting)';
        } else {
            selectedText.textContent = `${selectedUser.firstName} ${selectedUser.lastName} (${selectedUser.email})`;
        }
    } else {
        selectedText.textContent = 'Select Host';
    }
}

function toggleCreateHostDropdown() {
    const selectedDiv = document.getElementById('createHostSelected');
    const menu = document.getElementById('createHostMenu');
    const searchInput = document.getElementById('createHostSearch');

    createHostDropdownOpen = !createHostDropdownOpen;

    if (createHostDropdownOpen) {
        selectedDiv.classList.add('open');
        menu.classList.add('open');
        searchInput.value = '';
        createHostDropdownFiltered = [...createHostDropdownUsers];
        renderCreateHostDropdownOptions();
        setTimeout(() => searchInput.focus(), 50);
    } else {
        closeCreateHostDropdown();
    }
}

function closeCreateHostDropdown() {
    const selectedDiv = document.getElementById('createHostSelected');
    const menu = document.getElementById('createHostMenu');

    createHostDropdownOpen = false;
    if (selectedDiv) selectedDiv.classList.remove('open');
    if (menu) menu.classList.remove('open');
}

function filterCreateHostOptions() {
    const searchInput = document.getElementById('createHostSearch');
    const query = searchInput.value.toLowerCase().trim();

    if (!query) {
        createHostDropdownFiltered = [...createHostDropdownUsers];
    } else {
        createHostDropdownFiltered = createHostDropdownUsers.filter(user => {
            const fullName = `${user.firstName} ${user.lastName}`.toLowerCase();
            const email = user.email.toLowerCase();
            return fullName.includes(query) || email.includes(query);
        });
    }

    renderCreateHostDropdownOptions();
}

function renderCreateHostDropdownOptions() {
    const container = document.getElementById('createHostOptions');
    if (!container) return;

    if (createHostDropdownFiltered.length === 0) {
        container.innerHTML = '<div class="dropdown-no-results">No users found</div>';
        return;
    }

    const totalHeight = createHostDropdownFiltered.length * HOST_ITEM_HEIGHT;
    let html = `<div class="virtual-scroll-content" style="height: ${totalHeight}px;">`;

    createHostDropdownFiltered.forEach((user, index) => {
        const isSelected = user.userId === createHostDropdownSelectedId;
        const displayName = user.userId === ''
            ? 'No host (open meeting)'
            : `${user.firstName} ${user.lastName}`;
        const displayEmail = user.email || '';

        html += `
            <div class="dropdown-option ${isSelected ? 'selected' : ''}"
                 onclick="selectCreateHostOption('${user.userId}')"
                 style="position: absolute; top: ${index * HOST_ITEM_HEIGHT}px; left: 0; right: 0; height: ${HOST_ITEM_HEIGHT}px;">
                <div class="option-name">${escapeHtml(displayName)}</div>
                ${displayEmail ? `<div class="option-email">${escapeHtml(displayEmail)}</div>` : ''}
            </div>
        `;
    });

    html += '</div>';
    container.innerHTML = html;
}

function selectCreateHostOption(userId) {
    createHostDropdownSelectedId = userId;
    updateCreateHostDropdownSelection();
    closeCreateHostDropdown();
}

async function saveMeetingSettings() {
    const meetingId = document.getElementById('settingsMeetingId').value;
    const type = document.getElementById('settingsMeetingType').value;
    const notes = document.getElementById('settingsNotes').value;
    const allowGuests = document.getElementById('settingsAllowGuests').checked;
    const hostUserId = document.getElementById('settingsHost').value || null;
    const autoRecording = document.getElementById('settingsAutoRecording').checked;
    const autoTranscription = document.getElementById('settingsAutoTranscription').checked;
    const aiSupport = document.getElementById('settingsAiCopilot').checked;
    const meetingMode = aiSupport ? document.getElementById('settingsMeetingMode').value : null;

    if (type === 'hosted' && !hostUserId) {
        Toast.warning('Host is required for hosted meetings');
        return;
    }

    const saveBtn = document.querySelector('#meetingSettingsModal .btn-primary');
    const originalText = saveBtn.textContent;
    saveBtn.textContent = 'Saving...';
    saveBtn.disabled = true;

    try {
        // Save notes and meeting_mode if changed
        const notesChanged = currentSettingsMeeting && (currentSettingsMeeting.notes || '') !== notes;
        const modeChanged = currentSettingsMeeting && (currentSettingsMeeting.meeting_mode || null) !== meetingMode;
        if (notesChanged || modeChanged) {
            await api.updateMeetingNotes(meetingId, currentSettingsMeeting.meeting_name, notes, meetingMode);
        }

        if (currentSettingsMeeting && currentSettingsMeeting.allow_guests !== allowGuests) {
            await api.toggleAllowGuests(meetingId, allowGuests);
        }

        if (currentSettingsMeeting && currentSettingsMeeting.auto_recording !== autoRecording) {
            await api.toggleAutoRecording(meetingId, autoRecording);
        }

        if (currentSettingsMeeting && currentSettingsMeeting.auto_transcription !== autoTranscription) {
            await api.toggleAutoTranscription(meetingId, autoTranscription);
        }

        // Save AI Copilot if changed — runs after guest/transcription toggles above
        if (currentSettingsMeeting && (currentSettingsMeeting.ai_support || false) !== aiSupport) {
            await api.toggleAiSupport(meetingId, aiSupport);
        }

        if (currentSettingsMeeting && currentSettingsMeeting.host_user_id !== hostUserId) {
            await api.updateMeetingHost(meetingId, hostUserId);
        }

        closeModal('meetingSettingsModal');
        loadAllProjects();

    } catch (error) {
        console.error('Error saving meeting settings:', error);
        Toast.error('Failed to save settings: ' + error.message);
    } finally {
        saveBtn.textContent = originalText;
        saveBtn.disabled = false;
    }
}

// ============================================
// REAL-TIME MEETING STATUS UPDATES
// ============================================

/**
 * Update a specific meeting card's status without full page reload.
 * This is called when receiving MeetingStatusChanged SignalR event.
 */
function updateMeetingCardStatus(meetingId, isStarted, isRecording) {
    // Find the meeting card
    const meetingItem = document.querySelector(`[data-meeting-id="${meetingId}"]`);
    if (!meetingItem) {
        console.log(`Meeting card not found for ${meetingId}, might be in hosted section`);
        // Try hosted meetings section
        const hostedItem = document.querySelector(`[data-hosted-meeting-id="${meetingId}"]`);
        if (hostedItem) {
            updateMeetingCardStatusElement(hostedItem, meetingId, isStarted, isRecording);
        }
        return;
    }
    updateMeetingCardStatusElement(meetingItem, meetingId, isStarted, isRecording);
}

function updateMeetingCardStatusElement(meetingItem, meetingId, isStarted, isRecording) {
    // Update or add LIVE indicator
    let liveIndicator = meetingItem.querySelector('.meeting-live-indicator');
    if (isStarted) {
        if (!liveIndicator) {
            liveIndicator = document.createElement('span');
            liveIndicator.className = 'meeting-live-indicator';
            liveIndicator.innerHTML = '<span class="live-dot"></span>LIVE';
            // Insert after meeting name
            const meetingName = meetingItem.querySelector('.meeting-name');
            if (meetingName) {
                meetingName.parentNode.insertBefore(liveIndicator, meetingName.nextSibling);
            }
        }
        liveIndicator.style.display = 'inline-flex';
    } else if (liveIndicator) {
        liveIndicator.style.display = 'none';
    }

    // Update auto-recording toggle state
    const autoRecToggle = meetingItem.querySelector('.meeting-auto-rec-toggle');
    if (autoRecToggle) {
        autoRecToggle.disabled = isStarted;
        autoRecToggle.title = isStarted ? 'Cannot change while meeting is in progress' : 'Auto Recording';

        // Add/remove visual disabled state
        const toggleContainer = autoRecToggle.closest('.auto-rec-container');
        if (toggleContainer) {
            if (isStarted) {
                toggleContainer.classList.add('toggle-disabled');
            } else {
                toggleContainer.classList.remove('toggle-disabled');
            }
        }
    }

    // Store current status on the element for reference
    meetingItem.dataset.isStarted = isStarted;
    meetingItem.dataset.isRecording = isRecording;

    console.log(`Updated meeting ${meetingId}: started=${isStarted}, recording=${isRecording}`);
}

// ============================================
// SIGNALR FOR REAL-TIME HOST CHANGE NOTIFICATIONS
// ============================================

let dashboardConnection = null;

async function initDashboardSignalR() {
    const currentUser = api.getUser();
    if (!currentUser || !currentUser.userId) {
        console.log('No user logged in, skipping SignalR connection');
        return;
    }

    try {
        dashboardConnection = new signalR.HubConnectionBuilder()
            .withUrl(CONFIG.signalRHubUrl, {
                accessTokenFactory: () => getAuthToken()
            })
            .withAutomaticReconnect()
            .build();

        dashboardConnection.on('HostRemovedFromMeeting', (data) => {
            console.log('Host removed from meeting:', data);
            loadAllProjects();
        });

        dashboardConnection.on('HostAddedToMeeting', (data) => {
            console.log('Host added to meeting:', data);
            loadAllProjects();
        });

        // Real-time meeting status updates (non-intrusive)
        dashboardConnection.on('MeetingStatusChanged', (data) => {
            console.log('Meeting status changed:', data);
            const currentUser = api.getUser();
            if (!currentUser) return;

            // Role-based filtering: only update if user is project owner or host
            const isProjectOwner = data.projectOwnerId === currentUser.userId;
            const isHost = data.hostUserId === currentUser.userId;

            if (isProjectOwner || isHost) {
                updateMeetingCardStatus(data.meetingId, data.isStarted, data.isRecording);
            }
        });

        await dashboardConnection.start();
        console.log('Dashboard SignalR connected');

        await dashboardConnection.invoke('JoinDashboard', currentUser.userId);
        console.log('Joined dashboard notification group for user:', currentUser.userId);

    } catch (error) {
        console.error('Failed to connect to dashboard SignalR:', error);
    }
}

// ============================================
// PARTICIPANT ROLE MANAGEMENT
// ============================================

let currentRolesMeetingId = null;
let currentRolesSessionId = null;
let speakerRolesData = null;
let speakerRoleDropdowns = new Map();

// Inject glassy modal styles
(function injectSpeakerRolesModalStyles() {
    if (document.getElementById('speaker-roles-modal-styles')) return;
    const style = document.createElement('style');
    style.id = 'speaker-roles-modal-styles';
    style.textContent = `
        .speaker-roles-overlay {
            position: fixed !important;
            top: 0 !important;
            left: 0 !important;
            right: 0 !important;
            bottom: 0 !important;
            background: var(--overlay-dark, rgba(0, 0, 0, 0.5)) !important;
            display: flex !important;
            align-items: center !important;
            justify-content: center !important;
            z-index: 2147483647 !important;
            opacity: 0;
            transition: opacity 200ms ease;
        }
        .speaker-roles-overlay.active {
            opacity: 1;
        }
        .speaker-roles-modal {
            background: rgba(15, 23, 42, 0.6) !important;
            border-radius: 16px !important;
            max-width: 520px;
            width: 90%;
            display: flex;
            flex-direction: column;
            transform: scale(0.95);
            transition: transform 200ms ease, box-shadow 300ms ease, border-color 300ms ease;
            overflow: visible;
            border: 1px solid rgba(255, 255, 255, 0.08) !important;
            box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2) !important;
            backdrop-filter: blur(24px) saturate(150%);
            -webkit-backdrop-filter: blur(24px) saturate(150%);
        }
        .speaker-roles-overlay.active .speaker-roles-modal {
            transform: scale(1);
        }
        .speaker-roles-modal:hover {
            border-color: rgba(var(--brand-primary-rgb, 99, 102, 241), 0.5) !important;
            box-shadow:
                0 0 20px rgba(var(--brand-primary-rgb, 99, 102, 241), 0.25),
                0 0 40px rgba(var(--brand-primary-rgb, 99, 102, 241), 0.1),
                0 8px 24px rgba(0, 0, 0, 0.2) !important;
        }
        [data-theme="light"] .speaker-roles-modal {
            background: rgba(255, 255, 255, 0.7) !important;
            border: 1px solid rgba(0, 0, 0, 0.06) !important;
            box-shadow: 0 8px 24px rgba(0, 0, 0, 0.08) !important;
        }
        [data-theme="light"] .speaker-roles-modal:hover {
            border-color: rgba(var(--brand-primary-rgb, 99, 102, 241), 0.4) !important;
            box-shadow:
                0 0 20px rgba(var(--brand-primary-rgb, 99, 102, 241), 0.15),
                0 0 40px rgba(var(--brand-primary-rgb, 99, 102, 241), 0.08),
                0 8px 24px rgba(0, 0, 0, 0.08) !important;
        }
        .speaker-roles-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 16px 20px;
            border-bottom: 1px solid rgba(255, 255, 255, 0.06);
            position: relative;
            background: transparent;
        }
        .speaker-roles-header::before {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            height: 80px;
            background: linear-gradient(180deg, rgba(var(--brand-primary-rgb, 99, 102, 241), 0.06) 0%, transparent 100%);
            pointer-events: none;
            border-radius: 14px 14px 0 0;
        }
        [data-theme="light"] .speaker-roles-header {
            border-bottom: 1px solid rgba(0, 0, 0, 0.06);
        }
        .speaker-roles-header h3 {
            margin: 0;
            font-size: 16px;
            font-weight: 600;
            color: var(--text-primary);
            position: relative;
            z-index: 1;
        }
        .speaker-roles-close {
            background: var(--brand-primary);
            border: none;
            width: 28px;
            height: 28px;
            padding: 0;
            cursor: pointer;
            color: white;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: opacity 0.15s ease;
            position: relative;
            z-index: 1;
        }
        .speaker-roles-close:hover {
            opacity: 0.9;
        }
        .speaker-roles-body {
            padding: 16px 20px;
            overflow: visible;
        }
        .speaker-roles-info {
            font-size: 13px;
            color: var(--text-secondary);
            margin-bottom: 16px;
            line-height: 1.5;
        }
        .speakers-list {
            display: flex;
            flex-direction: column;
            gap: 12px;
        }
        .speaker-role-item {
            display: flex;
            align-items: center;
            gap: 12px;
            padding: 12px;
            background: rgba(var(--brand-primary-rgb, 99, 102, 241), 0.05);
            border-radius: 10px;
            border: 1px solid rgba(255, 255, 255, 0.06);
            transition: background 0.15s ease, border-color 0.15s ease;
        }
        [data-theme="light"] .speaker-role-item {
            background: rgba(0, 0, 0, 0.02);
            border: 1px solid rgba(0, 0, 0, 0.06);
        }
        .speaker-role-item:hover {
            background: rgba(var(--brand-primary-rgb, 99, 102, 241), 0.08);
            border-color: rgba(var(--brand-primary-rgb, 99, 102, 241), 0.2);
        }
        .speaker-avatar {
            width: 40px;
            height: 40px;
            border-radius: 50%;
            background: linear-gradient(135deg, var(--brand-primary), var(--brand-secondary, #8b5cf6));
            color: white;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 14px;
            font-weight: 600;
            flex-shrink: 0;
        }
        .speaker-info {
            flex: 1;
            min-width: 0;
        }
        .speaker-name {
            font-size: 14px;
            font-weight: 500;
            color: var(--text-primary);
            display: block;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }
        .speaker-email {
            font-size: 12px;
            color: var(--text-tertiary);
            display: block;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }
        .speaker-role-dropdown-container {
            width: 180px;
            flex-shrink: 0;
        }
        .speaker-role-dropdown-container .searchable-dropdown-trigger {
            min-width: unset !important;
        }
        .speaker-role-dropdown-container .searchable-dropdown-menu {
            z-index: 2147483647 !important;
            max-height: none !important;
            overflow: visible !important;
        }
        .speaker-role-dropdown-container .searchable-dropdown-options {
            max-height: 200px;
            overflow-y: auto;
        }
        .speaker-roles-footer {
            display: flex;
            justify-content: flex-end;
            gap: 10px;
            padding: 14px 20px;
            background: rgba(0, 0, 0, 0.15);
            border-top: 1px solid rgba(255, 255, 255, 0.06);
        }
        [data-theme="light"] .speaker-roles-footer {
            background: rgba(0, 0, 0, 0.03);
            border-top: 1px solid rgba(0, 0, 0, 0.06);
        }
        .speaker-roles-btn {
            padding: 9px 18px;
            font-size: 13px;
            font-weight: 500;
            border-radius: 10px;
            cursor: pointer;
            transition: all 0.2s ease;
        }
        .speaker-roles-btn-cancel {
            border: 1px solid var(--border-color-light, rgba(255,255,255,0.15));
            background: rgba(var(--brand-primary-rgb, 99, 102, 241), 0.08);
            color: var(--text-primary);
        }
        .speaker-roles-btn-cancel:hover {
            background: rgba(var(--brand-primary-rgb, 99, 102, 241), 0.15);
            border-color: rgba(var(--brand-primary-rgb, 99, 102, 241), 0.3);
            transform: translateY(-1px);
        }
        .speaker-roles-btn-save {
            border: none;
            background: linear-gradient(135deg, var(--brand-primary, #6366f1), var(--brand-secondary, #8b5cf6));
            color: white;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
        }
        .speaker-roles-btn-save:hover {
            transform: translateY(-1px);
            box-shadow: 0 6px 16px rgba(var(--brand-primary-rgb, 99, 102, 241), 0.4);
        }
        .speaker-roles-empty {
            text-align: center;
            padding: 32px 16px;
            color: var(--text-secondary);
        }
        .speaker-roles-empty svg {
            opacity: 0.5;
            margin-bottom: 12px;
        }
        .speaker-roles-loading {
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 40px;
            color: var(--text-secondary);
        }
        .speaker-roles-loading .spinner {
            width: 24px;
            height: 24px;
            border: 2px solid rgba(var(--brand-primary-rgb, 99, 102, 241), 0.2);
            border-top-color: var(--brand-primary);
            border-radius: 50%;
            animation: spin 0.8s linear infinite;
            margin-right: 12px;
        }
        @keyframes spin {
            to { transform: rotate(360deg); }
        }
    `;
    document.head.appendChild(style);
})();

async function showSpeakerRolesPanel(sessionId, meetingId) {
    try {
        currentRolesSessionId = sessionId;
        currentRolesMeetingId = meetingId;

        // Remove existing modal if any
        let existingModal = document.getElementById('speakerRolesOverlay');
        if (existingModal) existingModal.remove();

        // Create glassy modal
        const overlay = document.createElement('div');
        overlay.id = 'speakerRolesOverlay';
        overlay.className = 'speaker-roles-overlay';
        overlay.innerHTML = `
            <div class="speaker-roles-modal">
                <div class="speaker-roles-header">
                    <h3>Manage Speaker Roles</h3>
                    <button class="speaker-roles-close" onclick="closeSpeakerRolesModal()">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <line x1="18" y1="6" x2="6" y2="18"></line>
                            <line x1="6" y1="6" x2="18" y2="18"></line>
                        </svg>
                    </button>
                </div>
                <div class="speaker-roles-body" id="speakerRolesBody">
                    <div class="speaker-roles-loading">
                        <div class="spinner"></div>
                        <span>Loading speakers...</span>
                    </div>
                </div>
                <div class="speaker-roles-footer">
                    <button class="speaker-roles-btn speaker-roles-btn-cancel" onclick="closeSpeakerRolesModal()">Cancel</button>
                    <button class="speaker-roles-btn speaker-roles-btn-save" onclick="saveSpeakerRoles()">Save Changes</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);

        // Close on overlay click
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) closeSpeakerRolesModal();
        });

        // Close on Escape
        const handleEscape = (e) => {
            if (e.key === 'Escape') {
                closeSpeakerRolesModal();
                document.removeEventListener('keydown', handleEscape);
            }
        };
        document.addEventListener('keydown', handleEscape);

        // Animate in
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                overlay.classList.add('active');
            });
        });

        // Load speakers from session
        const response = await api.getSessionSpeakersWithRoles(sessionId);

        if (!response.success) {
            throw new Error(response.message || 'Failed to load speakers');
        }

        speakerRolesData = {
            speakers: response.speakers,
            suggestedRoles: response.suggestedRoles
        };

        renderSpeakerRolesList();

    } catch (error) {
        console.error('Error loading speaker roles:', error);
        Toast.error('Failed to load speakers: ' + error.message);
        closeSpeakerRolesModal();
    }
}

function renderSpeakerRolesList() {
    const body = document.getElementById('speakerRolesBody');
    if (!body || !speakerRolesData) return;

    const { speakers, suggestedRoles } = speakerRolesData;

    if (!speakers || speakers.length === 0) {
        body.innerHTML = `
            <div class="speaker-roles-empty">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                    <circle cx="9" cy="7" r="4"/>
                </svg>
                <p>No speakers found for this session.</p>
            </div>
        `;
        return;
    }

    // Build role options for SearchableDropdown
    const roleOptions = [
        { value: '', label: 'Participant (Default)', description: 'No specific role assigned' },
        ...suggestedRoles.map(role => ({
            value: role,
            label: capitalizeFirst(role),
            description: ''
        }))
    ];

    let html = `
        <div class="speaker-roles-info">
            Assign roles to speakers for better transcript analysis. Roles help the AI understand context like interviews, sales calls, or training sessions.
        </div>
        <div class="speakers-list">
    `;

    speakers.forEach((speaker, index) => {
        const displayName = speaker.display_name || speaker.guest_name || speaker.user_id || 'Unknown';
        const containerId = `speaker-role-dropdown-${index}`;

        html += `
            <div class="speaker-role-item"
                 data-speaker-name="${escapeHtml(speaker.display_name || speaker.guest_name || '')}"
                 data-speaker-id="${speaker.user_id || ''}"
                 data-original-role="${speaker.participant_role || ''}">
                <div class="speaker-avatar">${getInitials(displayName)}</div>
                <div class="speaker-info">
                    <span class="speaker-name">${escapeHtml(displayName)}</span>
                    ${speaker.email ? `<span class="speaker-email">${escapeHtml(speaker.email)}</span>` : ''}
                </div>
                <div class="speaker-role-dropdown-container" id="${containerId}"></div>
            </div>
        `;
    });

    html += `</div>`;
    body.innerHTML = html;

    // Initialize SearchableDropdowns
    speakerRoleDropdowns.clear();
    speakers.forEach((speaker, index) => {
        const containerId = `speaker-role-dropdown-${index}`;
        const container = document.getElementById(containerId);
        if (!container) return;

        // Add custom role if not in suggested list
        const currentRole = speaker.participant_role || '';
        let options = [...roleOptions];
        if (currentRole && !suggestedRoles.includes(currentRole)) {
            options.splice(1, 0, {
                value: currentRole,
                label: capitalizeFirst(currentRole),
                description: 'Custom role'
            });
        }

        const dropdown = new SearchableDropdown(container, {
            options: options,
            value: currentRole,
            placeholder: 'Select role',
            searchPlaceholder: 'Search roles...',
            compact: true,
            onChange: (value) => {
                // Store the new value
                const item = container.closest('.speaker-role-item');
                if (item) {
                    item.dataset.currentRole = value || '';
                }
            }
        });

        speakerRoleDropdowns.set(index, dropdown);
    });
}

async function saveSpeakerRoles() {
    try {
        const items = document.querySelectorAll('.speaker-role-item');
        const updates = [];

        items.forEach((item, index) => {
            const speakerName = item.dataset.speakerName;
            const speakerId = item.dataset.speakerId || null;
            const originalRole = item.dataset.originalRole || null;

            // Get current role from dropdown
            const dropdown = speakerRoleDropdowns.get(index);
            const currentRole = dropdown ? (dropdown.getValue() || null) : null;

            // Only include if changed
            if (currentRole !== originalRole) {
                updates.push({
                    speaker_name: speakerName,
                    speaker_id: speakerId,
                    participant_role: currentRole
                });
            }
        });

        if (updates.length === 0) {
            Toast.info('No changes to save');
            closeSpeakerRolesModal();
            return;
        }

        Toast.info('Saving roles...');

        const response = await api.bulkUpdateSpeakerRoles(currentRolesSessionId, updates);

        if (response.success) {
            Toast.success(`Updated ${response.affectedRows} transcript segment(s)`);
            const sessionId = currentRolesSessionId;
            closeSpeakerRolesModal();
            // Reload transcript to show updated role badges
            if (sessionId) {
                await showSessionTranscript(sessionId);
            }
        } else {
            throw new Error(response.message || 'Failed to save roles');
        }

    } catch (error) {
        console.error('Error saving speaker roles:', error);
        Toast.error('Failed to save roles: ' + error.message);
    }
}

function closeSpeakerRolesModal() {
    const overlay = document.getElementById('speakerRolesOverlay');
    if (overlay) {
        overlay.classList.remove('active');
        setTimeout(() => overlay.remove(), 200);
    }
    currentRolesMeetingId = null;
    currentRolesSessionId = null;
    speakerRolesData = null;
    speakerRoleDropdowns.clear();
}

// Keep old function as alias for backwards compatibility
async function showParticipantRolesPanel(meetingId) {
    // For backwards compatibility, try to use the current session if available
    if (currentSessionId) {
        return showSpeakerRolesPanel(currentSessionId, meetingId);
    }
    Toast.error('Please open a session transcript first');
}

function closeParticipantRolesModal() {
    closeSpeakerRolesModal();
}

function getInitials(name) {
    if (!name) return '?';
    const parts = name.split(/[\s@]+/);
    if (parts.length >= 2) {
        return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return name.substring(0, 2).toUpperCase();
}

function capitalizeFirst(str) {
    if (!str) return '';
    return str.charAt(0).toUpperCase() + str.slice(1);
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ============================================
// INITIALIZE DASHBOARD
// ============================================

if (document.querySelector('.dashboard')) {
    document.addEventListener('DOMContentLoaded', () => {
        initDashboardDropdowns();
        loadProjectFilterDropdown();
        loadDashboard(true);
        initDashboardSignalR();
        // Check if tenant has active LLM API key (for AI Copilot visibility)
        api.hasActiveLlmKey().then(has => { tenantHasLlmKey = has; });
    });

    window.addEventListener('beforeunload', async () => {
        if (dashboardConnection) {
            const currentUser = api.getUser();
            if (currentUser && currentUser.userId) {
                try {
                    await dashboardConnection.invoke('LeaveDashboard', currentUser.userId);
                } catch (e) {
                    // Ignore errors during page unload
                }
            }
            await dashboardConnection.stop();
        }
    });
}
