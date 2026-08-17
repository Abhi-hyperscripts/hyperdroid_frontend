// LMS My Learning JavaScript

let allEnrollments = [];
let activeTab = 'in_progress';

document.addEventListener('DOMContentLoaded', async () => {
    Navigation.init('lms', '../');
    if (!api.isAuthenticated()) {
        window.location.href = '../login.html';
        return;
    }
    await loadPageData();
});

async function loadPageData() {
    try {
        const data = await api.request('/lms/enrollments/my');
        allEnrollments = Array.isArray(data) ? data : [];

        // Stats
        const inProgress = allEnrollments.filter(e => e.status === 'active').length;
        const completed = allEnrollments.filter(e => e.status === 'completed').length;
        document.getElementById('statInProgress').textContent = inProgress;
        document.getElementById('statCompleted').textContent = completed;
        document.getElementById('statCertificates').textContent = completed;

        filterByTab(activeTab);
    } catch (error) {
        console.error('Error loading enrollments:', error);
        showToast('Error loading enrollments', 'error');
    }
}

function filterByTab(tab) {
    activeTab = tab;
    const select = document.getElementById('filterTab');
    if (select) select.value = tab;

    let filtered;
    if (tab === 'all') {
        filtered = allEnrollments;
    } else if (tab === 'completed') {
        filtered = allEnrollments.filter(e => e.status === 'completed');
    } else {
        filtered = allEnrollments.filter(e => e.status === 'active' || e.status === 'in_progress');
    }

    renderTable(filtered);
}

function handleSearch() {
    const query = (document.getElementById('filterSearch')?.value || '').toLowerCase();
    let filtered;
    if (activeTab === 'all') {
        filtered = allEnrollments;
    } else if (activeTab === 'completed') {
        filtered = allEnrollments.filter(e => e.status === 'completed');
    } else {
        filtered = allEnrollments.filter(e => e.status === 'active' || e.status === 'in_progress');
    }

    if (query) {
        filtered = filtered.filter(e => (e.courseTitle || '').toLowerCase().includes(query));
    }
    renderTable(filtered);
}

function renderTable(enrollments) {
    const tbody = document.getElementById('enrollmentsTableBody');
    if (!tbody) return;

    if (enrollments.length === 0) {
        const msg = activeTab === 'in_progress'
            ? 'No courses in progress. <a href="catalog.html" style="color:var(--brand-primary)">Browse the catalog</a> to start learning!'
            : activeTab === 'completed'
            ? 'No completed courses yet.'
            : 'No enrollments found.';
        tbody.innerHTML = `<tr><td colspan="5" class="crm-empty-state"><div class="crm-empty-content">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/>
                <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>
            </svg>
            <p>${msg}</p>
        </div></td></tr>`;
        return;
    }

    tbody.innerHTML = enrollments.map(e => {
        const title = e.courseTitle || 'Untitled Course';
        const progress = e.progressPct ?? 0;
        const isCompleted = e.status === 'completed';
        const courseId = e.courseId;
        const statusBadge = isCompleted
            ? '<span class="lms-badge completed">Completed</span>'
            : '<span class="lms-badge active">In Progress</span>';

        return `
            <tr onclick="window.location.href='course-detail.html?id=${courseId}'" style="cursor:pointer">
                <td>
                    <div style="display:flex;align-items:center;gap:10px">
                        <div style="width:32px;height:32px;border-radius:8px;background:linear-gradient(135deg,rgba(var(--brand-primary-rgb),0.15),rgba(139,92,246,0.1));display:flex;align-items:center;justify-content:center;flex-shrink:0">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--brand-primary)" stroke-width="1.5">
                                <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/>
                                <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>
                            </svg>
                        </div>
                        <span style="font-weight:500;color:var(--brand-primary)">${escapeHtml(title)}</span>
                    </div>
                </td>
                <td>
                    <div style="display:flex;align-items:center;gap:8px;min-width:120px">
                        <div class="lms-progress-bar" style="flex:1"><div class="lms-progress-fill${isCompleted ? ' success' : ''}" style="width:${isCompleted ? 100 : progress}%"></div></div>
                        <span style="font-size:0.75rem;font-weight:600;color:${isCompleted ? 'var(--color-success)' : 'var(--brand-primary)'}">${isCompleted ? '100' : Math.round(progress)}%</span>
                    </div>
                </td>
                <td class="hide-mobile">${statusBadge}</td>
                <td class="hide-mobile">${formatDate(e.createdAt)}</td>
                <td>
                    <button class="btn btn-sm btn-primary" onclick="event.stopPropagation(); window.location.href='course-detail.html?id=${courseId}'" style="font-size:0.72rem;padding:4px 12px">
                        ${isCompleted ? 'Review' : 'Continue'}
                    </button>
                </td>
            </tr>
        `;
    }).join('');
}

function formatDate(dateStr) {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    // Quote-safe. Serialising a TEXT node to innerHTML escapes & < > and
    // nothing else, so a value containing a double quote used to break
    // straight out of any quoted HTML attribute it was interpolated into
    // — and lead names, company names and WhatsApp display names all
    // arrive from outside. Over-escaping is free in text context, where
    // &quot; renders as a plain quote.
    return div.innerHTML.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
