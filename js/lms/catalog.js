// LMS Course Catalog JavaScript

let enrolledCourseIds = new Set();
let searchTimeout = null;

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
        await Promise.all([
            loadCategories(),
            loadEnrolledCourses()
        ]);
        await loadCatalog();
    } catch (error) {
        console.error('Error loading catalog:', error);
        showToast('Error loading catalog', 'error');
    }
}

async function loadCategories() {
    try {
        const data = await api.request('/lms/categories');
        const categories = Array.isArray(data) ? data : [];
        const select = document.getElementById('filterCategory');
        if (!select) return;
        categories.forEach(cat => {
            const option = document.createElement('option');
            option.value = cat.id;
            option.textContent = cat.name;
            select.appendChild(option);
        });
    } catch (error) {
        console.error('Error loading categories:', error);
    }
}

async function loadEnrolledCourses() {
    try {
        const data = await api.request('/lms/enrollments/my');
        const enrollments = Array.isArray(data) ? data : [];
        enrolledCourseIds = new Set(enrollments.map(e => e.courseId));
    } catch (error) {
        console.error('Error loading enrolled courses:', error);
    }
}

function getFilterParams() {
    const params = new URLSearchParams();
    const search = document.getElementById('filterSearch')?.value?.trim();
    if (search) params.set('search', search);
    const category = document.getElementById('filterCategory')?.value;
    if (category) params.set('categoryId', category);
    const difficulty = document.getElementById('filterDifficulty')?.value;
    if (difficulty) params.set('difficulty', difficulty);
    return params.toString();
}

async function loadCatalog() {
    const grid = document.getElementById('courseGrid');
    if (!grid) return;

    try {
        const params = getFilterParams();
        const data = await api.request(`/lms/courses?${params}`);
        const courses = Array.isArray(data) ? data : [];

        if (!courses.length) {
            grid.innerHTML = `<div class="lms-empty-state" style="grid-column:1/-1">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                    <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
                </svg>
                <p>No courses found. Try adjusting your filters.</p>
            </div>`;
            return;
        }

        renderCourseCards(courses);
    } catch (error) {
        console.error('Error loading catalog:', error);
        grid.innerHTML = `<div class="lms-empty-state" style="grid-column:1/-1"><p>Unable to load courses</p></div>`;
    }
}

function renderCourseCards(courses) {
    const grid = document.getElementById('courseGrid');
    if (!grid) return;

    grid.innerHTML = courses.map(course => {
        const isEnrolled = enrolledCourseIds.has(course.id);
        const rating = course.averageRating ?? 0;
        const difficulty = (course.difficultyLevel || 'beginner').toLowerCase();
        const diffLabel = difficulty.charAt(0).toUpperCase() + difficulty.slice(1);

        return `
            <div class="lms-course-card" onclick="viewCourse('${course.id}')">
                <div class="card-thumbnail">
                    ${course.thumbnailUrl
                        ? `<img src="${escapeHtml(course.thumbnailUrl)}" alt="${escapeHtml(course.title)}">`
                        : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                                <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/>
                                <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>
                            </svg>`
                    }
                </div>
                <div class="card-body">
                    <span class="lms-badge ${difficulty}">${diffLabel}</span>
                    <h4 class="card-title">${escapeHtml(course.title || 'Untitled')}</h4>
                    <div class="card-rating">
                        ${renderStars(rating)}
                        <span style="margin-left:4px;color:var(--text-secondary);font-size:0.72rem">${rating > 0 ? rating.toFixed(1) : 'New'}</span>
                    </div>
                    <div class="card-meta">
                        <span>
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
                            </svg>
                            ${course.lessonCount ?? 0} lessons
                        </span>
                        <span>
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
                            </svg>
                            ${formatDuration(course.estimatedDurationMinutes)}
                        </span>
                    </div>
                    <div class="card-instructor">${escapeHtml(course.instructorName || '')}</div>
                    <div class="card-footer">
                        <div></div>
                        <button class="btn-enroll ${isEnrolled ? 'enrolled' : ''}"
                                onclick="event.stopPropagation(); ${isEnrolled ? '' : `handleEnroll('${course.id}')`}"
                                ${isEnrolled ? 'disabled' : ''}>
                            ${isEnrolled ? '&#10003; Enrolled' : 'Enroll'}
                        </button>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

function handleSearch() {
    if (searchTimeout) clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => loadCatalog(), 300);
}

function handleFilter() {
    loadCatalog();
}

async function handleEnroll(courseId) {
    try {
        await api.request('/lms/enrollments', {
            method: 'POST',
            body: JSON.stringify({ courseId: courseId })
        });
        enrolledCourseIds.add(courseId);
        showToast('Successfully enrolled!', 'success');
        loadCatalog();
    } catch (error) {
        console.error('Error enrolling:', error);
        showToast(error.message || 'Failed to enroll', 'error');
    }
}

function viewCourse(courseId) {
    window.location.href = `course-detail.html?id=${courseId}`;
}

function renderStars(rating) {
    let html = '';
    for (let i = 1; i <= 5; i++) {
        const color = i <= Math.round(rating) ? 'var(--color-warning)' : 'var(--text-tertiary, #555)';
        html += `<svg width="12" height="12" viewBox="0 0 24 24" fill="${color}" stroke="none"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`;
    }
    return html;
}

function formatDuration(minutes) {
    if (!minutes) return '--';
    if (minutes < 60) return `${minutes}m`;
    return `${Math.round(minutes / 60)}h`;
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
