/**
 * News Admin Page — KIP Management
 * Crawl settings, articles, categories, sources
 */

const NEWS_API = CONFIG.newsApiBaseUrl;
const PAGE_SIZE = 20;
const TAB_NAMES = {
    'dashboard': 'Dashboard',
    'crawl-settings': 'Crawl Settings',
    'articles': 'Articles',
    'categories': 'Categories',
    'sources': 'Sources',
    'authors': 'Authors',
    'guest-articles': 'Guest Articles',
    'ads': 'Ad Slots',
    'analytics': 'Analytics'
};

let articleOffset = 0;
let deleteArticleId = null;
let searchDebounceTimer = null;
let tabDataLoaded = {};

// ── Authenticated fetch helper (with token refresh) ──
async function newsRequest(path, options = {}) {
    // Ensure token is fresh by triggering api.js refresh if needed
    if (typeof api !== 'undefined' && typeof api.ensureValidToken === 'function') {
        await api.ensureValidToken();
    } else if (typeof isAccessTokenExpired === 'function' && isAccessTokenExpired()) {
        // Trigger a lightweight api call to force token refresh
        try { await api.request('/auth/validate'); } catch(e) {}
    }

    const token = getAuthToken();
    if (!token) { window.location.href = '/index.html'; return null; }
    try {
        const res = await fetch(`${NEWS_API}${path}`, {
            ...options,
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
                'Cache-Control': 'no-cache',
                ...(options.headers || {})
            }
        });
        if (res.status === 401 || res.status === 403) {
            Toast.error('Access denied. SUPERADMIN required.');
            return null;
        }
        return res;
    } catch (err) {
        console.error('[NewsAdmin]', err);
        Toast.error('Network error');
        return null;
    }
}

// ── Init ──
document.addEventListener('DOMContentLoaded', async () => {
    if (!api.isAuthenticated()) {
        window.location.href = '/index.html';
        return;
    }

    Navigation.init('news', '../');
    setupSidebar();
    await loadDashboard();
});

// ═══════════════════════════════════════════════════════════════════════════
//  SIDEBAR & TABS
// ═══════════════════════════════════════════════════════════════════════════

function setupSidebar() {
    const toggle = document.getElementById('sidebarToggle');
    const sidebar = document.getElementById('settingsSidebar');
    const container = document.querySelector('.crm-settings-container');
    const overlay = document.getElementById('sidebarOverlay');

    if (!toggle || !sidebar) return;

    if (window.innerWidth > 1024) {
        toggle.classList.add('active');
        sidebar.classList.add('open');
        container?.classList.add('sidebar-open');
    }

    toggle.addEventListener('click', () => {
        toggle.classList.toggle('active');
        sidebar.classList.toggle('open');
        container?.classList.toggle('sidebar-open');
        if (window.innerWidth <= 1024) {
            overlay?.classList.toggle('active');
        }
    });

    overlay?.addEventListener('click', () => closeSidebar());
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && sidebar.classList.contains('open')) closeSidebar();
    });

    let resizeTimer;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
            if (window.innerWidth > 1024) {
                toggle.classList.add('active');
                sidebar.classList.add('open');
                container?.classList.add('sidebar-open');
                overlay?.classList.remove('active');
            } else {
                toggle.classList.remove('active');
                sidebar.classList.remove('open');
                container?.classList.remove('sidebar-open');
                overlay?.classList.remove('active');
            }
        }, 150);
    });
}

function closeSidebar() {
    document.getElementById('sidebarToggle')?.classList.remove('active');
    document.getElementById('settingsSidebar')?.classList.remove('open');
    document.querySelector('.crm-settings-container')?.classList.remove('sidebar-open');
    document.getElementById('sidebarOverlay')?.classList.remove('active');
}

function switchTab(tabName) {
    document.querySelectorAll('#settingsSidebar .sidebar-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tabName);
    });
    document.querySelectorAll('.crm-tab-content').forEach(el => {
        el.classList.toggle('active', el.id === `tab-${tabName}`);
    });
    const label = document.getElementById('activeTabName');
    if (label && TAB_NAMES[tabName]) label.textContent = TAB_NAMES[tabName];

    if (window.innerWidth <= 1024) closeSidebar();

    // Lazy load tab data
    if (tabName === 'dashboard') loadDashboard();
    else if (tabName === 'crawl-settings') loadCrawlSettings();
    else if (tabName === 'articles') loadArticles();
    else if (tabName === 'categories') loadCategories();
    else if (tabName === 'sources') loadSources();
    else if (tabName === 'authors') loadAuthors();
    else if (tabName === 'guest-articles') loadGuestArticles();
    else if (tabName === 'ads') loadAds();
    else if (tabName === 'analytics') loadAnalytics();
}

// ═══════════════════════════════════════════════════════════════════════════
//  DASHBOARD
// ═══════════════════════════════════════════════════════════════════════════

async function loadDashboard() {
    const [catRes, srcRes, crawlRes, articlesRes] = await Promise.all([
        newsRequest('/news/categories'),
        newsRequest('/news/sources'),
        newsRequest('/news/crawl/status?limit=5'),
        newsRequest('/news?limit=10000&offset=0')
    ]);

    if (catRes?.ok) {
        const cats = await catRes.json();
        document.getElementById('statCategories').textContent = Array.isArray(cats) ? cats.length : '—';
    }
    if (srcRes?.ok) {
        const srcs = await srcRes.json();
        document.getElementById('statSources').textContent = Array.isArray(srcs) ? srcs.length : '—';
    }
    if (articlesRes?.ok) {
        const data = await articlesRes.json();
        const artArr = data.articles || data.data || (Array.isArray(data) ? data : []);
        document.getElementById('statArticles').textContent = artArr.length || data.count || '—';
    }
    if (crawlRes?.ok) {
        const jobs = await crawlRes.json();
        renderCrawlStatus(jobs);
        renderCrawlTable(jobs, 'dashCrawlHistory');
    }
}

function renderCrawlStatus(jobs) {
    const el = document.getElementById('statCrawl');
    const timeEl = document.getElementById('statCrawlTime');
    if (!jobs || jobs.length === 0) {
        el.textContent = 'No runs';
        return;
    }
    const last = jobs[0];
    const status = (last.status || '').toLowerCase();
    if (status === 'completed') {
        el.innerHTML = '<span class="status-badge status-badge active">Completed</span>';
    } else if (status === 'failed' || status === 'error') {
        el.innerHTML = '<span class="status-badge status-badge rejected">Failed</span>';
    } else if (status === 'running' || status === 'in_progress') {
        el.innerHTML = '<span class="status-badge status-badge pending">Running</span>';
    } else {
        el.innerHTML = `<span class="status-badge status-badge neutral">${esc(last.status)}</span>`;
    }
    const lastTime = last.startedAt || last.started_at || last.createdAt || last.created_at;
    if (lastTime) {
        timeEl.textContent = formatTimeAgo(lastTime);
    }
}

// ═══════════════════════════════════════════════════════════════════════════
//  CRAWL SETTINGS
// ═══════════════════════════════════════════════════════════════════════════

async function loadCrawlSettings() {
    const [settingsRes, historyRes] = await Promise.all([
        newsRequest('/news/crawl/settings'),
        newsRequest('/news/crawl/status?limit=20')
    ]);

    if (settingsRes?.ok) {
        const settings = await settingsRes.json();
        document.getElementById('crawlEnabled').checked = settings.crawlEnabled ?? false;
        document.getElementById('crawlInterval').value = settings.crawlIntervalHours ?? 5;
    }
    if (historyRes?.ok) {
        const jobs = await historyRes.json();
        renderCrawlTable(jobs, 'crawlHistory');
    }
}

async function saveCrawlSettings() {
    const body = JSON.stringify({
        crawlEnabled: document.getElementById('crawlEnabled').checked,
        crawlIntervalHours: parseFloat(document.getElementById('crawlInterval').value)
    });
    const res = await newsRequest('/news/crawl/settings', { method: 'PUT', body });
    if (res?.ok) Toast.success('Crawl settings saved');
    else Toast.error('Failed to save settings');
}

async function triggerCrawl() {
    Toast.info('Triggering crawl...');
    const res = await newsRequest('/news/crawl', { method: 'POST' });
    if (res?.ok) {
        Toast.success('Crawl triggered successfully');
        setTimeout(() => loadDashboard(), 2000);
    } else {
        Toast.error('Failed to trigger crawl');
    }
}

function formatTokens(inTok, outTok) {
    const total = (inTok || 0) + (outTok || 0);
    if (total === 0) return '—';
    const fmt = n => n >= 1000 ? (n / 1000).toFixed(1) + 'k' : n.toString();
    return `<span style="font-size:0.75rem;">${fmt(inTok)} / ${fmt(outTok)}</span><br><span style="font-size:0.65rem;color:var(--text-tertiary);">${fmt(total)} total</span>`;
}

function renderCrawlTable(jobs, targetId) {
    const tbody = document.getElementById(targetId);
    if (!tbody) return;
    if (!jobs || jobs.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="empty-state" style="text-align:center;padding:24px;">No crawl jobs yet</td></tr>';
        return;
    }
    const isDash = targetId === 'dashCrawlHistory';
    tbody.innerHTML = jobs.map(j => {
        const status = (j.status || '').toLowerCase();
        let badge = 'status-badge neutral';
        if (status === 'completed') badge = 'status-badge active';
        else if (status === 'failed' || status === 'error') badge = 'status-badge rejected';
        else if (status === 'running' || status === 'in_progress') badge = 'status-badge pending';

        const startedAt = j.startedAt || j.started_at || j.createdAt || j.created_at;
        const completedAt = j.completedAt || j.completed_at;
        const started = formatDate(startedAt);
        const artCount = j.totalInserted ?? j.total_inserted ?? j.articlesCount ?? j.articles_count ?? '—';
        const inTok = j.totalInputTokens ?? j.total_input_tokens ?? 0;
        const outTok = j.totalOutputTokens ?? j.total_output_tokens ?? 0;
        const tokens = formatTokens(inTok, outTok);
        const duration = completedAt && startedAt
            ? formatDuration(new Date(completedAt) - new Date(startedAt))
            : '—';

        if (isDash) {
            return `<tr>
                <td><span class="status-badge ${badge}">${esc(j.status)}</span></td>
                <td>${started}</td>
                <td>${artCount}</td>
                <td>${tokens}</td>
                <td>${duration}</td>
            </tr>`;
        }
        const completed = completedAt ? formatDate(completedAt) : '—';
        const errMsg = j.errorMessage || j.error_message || '';
        const errors = errMsg ? `<span style="color:var(--color-error);font-size:0.78rem;">${esc(errMsg).substring(0, 60)}</span>` : '—';
        return `<tr>
            <td><span class="status-badge ${badge}">${esc(j.status)}</span></td>
            <td>${started}</td>
            <td>${completed}</td>
            <td>${artCount}</td>
            <td>${tokens}</td>
            <td>${errors}</td>
        </tr>`;
    }).join('');
}

// ═══════════════════════════════════════════════════════════════════════════
//  ARTICLES
// ═══════════════════════════════════════════════════════════════════════════

async function loadArticles() {
    // Populate category filter if empty
    const catFilter = document.getElementById('articleCatFilter');
    if (catFilter && catFilter.options.length <= 1) {
        const catRes = await newsRequest('/news/categories');
        if (catRes?.ok) {
            const cats = await catRes.json();
            cats.forEach(c => {
                const opt = document.createElement('option');
                opt.value = c.name;
                opt.textContent = c.name;
                catFilter.appendChild(opt);
            });
        }
    }

    const search = document.getElementById('articleSearch')?.value || '';
    const category = document.getElementById('articleCatFilter')?.value || '';
    const params = new URLSearchParams({ limit: PAGE_SIZE, offset: articleOffset });
    if (category) params.set('category', category);

    let url = `/news?${params}`;
    const res = await newsRequest(url);
    if (!res?.ok) return;

    const data = await res.json();
    let articles = Array.isArray(data) ? data : (data.articles || data.data || []);
    const total = data.count ?? data.total ?? articles.length;

    // Client-side search filter (if backend doesn't support search param)
    if (search) {
        const q = search.toLowerCase();
        articles = articles.filter(a =>
            (a.headline || a.title || '').toLowerCase().includes(q) ||
            (a.sourceName || a.source_name || '').toLowerCase().includes(q)
        );
    }

    document.getElementById('articleCountLabel').textContent = `${total} articles`;

    const tbody = document.getElementById('articlesTable');
    if (articles.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="empty-state" style="text-align:center;padding:24px;">No articles found</td></tr>';
        document.getElementById('articlesPagination').innerHTML = '';
        return;
    }

    tbody.innerHTML = articles.map(a => {
        const title = a.headline || a.title || '';
        const source = a.sourceName || a.source_name || a.source || '';
        const published = a.publishedAt || a.published_at || a.createdAt || a.created_at || '';
        const escapedTitle = esc(title).replace(/'/g, '&#39;');
        return `<tr>
        <td><span style="font-weight: 500;">${esc(title)}</span></td>
        <td>${esc(source) || '<span style="color: var(--text-muted);">-</span>'}</td>
        <td><span class="status-badge neutral">${esc(a.category || '-')}</span></td>
        <td style="white-space: nowrap;">${formatTimeAgo(published)}</td>
        <td class="actions-cell">
            <button class="action-btn delete" title="Delete" onclick="event.stopPropagation(); showDeleteModal('${a.id}', '${escapedTitle}')">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
            </button>
        </td>
    </tr>`;
    }).join('');

    // Pagination
    renderPagination(total);
}

function renderPagination(total) {
    const el = document.getElementById('articlesPagination');
    const totalPages = Math.ceil(total / PAGE_SIZE);
    const currentPage = Math.floor(articleOffset / PAGE_SIZE) + 1;
    if (totalPages <= 1) { el.innerHTML = ''; return; }

    let html = '';
    if (currentPage > 1) html += `<button class="news-btn news-btn-ghost" onclick="goToPage(${currentPage - 1})">Prev</button>`;
    html += `<span style="font-size:0.82rem;color:var(--text-secondary);">Page ${currentPage} of ${totalPages}</span>`;
    if (currentPage < totalPages) html += `<button class="news-btn news-btn-ghost" onclick="goToPage(${currentPage + 1})">Next</button>`;
    el.innerHTML = html;
}

function goToPage(page) {
    articleOffset = (page - 1) * PAGE_SIZE;
    loadArticles();
}

function debounceArticleSearch() {
    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(() => {
        articleOffset = 0;
        loadArticles();
    }, 400);
}

// ── Delete Article ──
function showDeleteModal(id, title) {
    deleteArticleId = id;
    document.getElementById('deleteArticleTitle').textContent = title;
    document.getElementById('deleteModal').classList.add('active');
}

function closeDeleteModal() {
    deleteArticleId = null;
    document.getElementById('deleteModal').classList.remove('active');
}

async function confirmDeleteArticle() {
    if (!deleteArticleId) return;
    const res = await newsRequest(`/news/${deleteArticleId}`, { method: 'DELETE' });
    closeDeleteModal();
    if (res?.ok) {
        Toast.success('Article deleted');
        loadArticles();
    } else {
        Toast.error('Failed to delete article');
    }
}

// ═══════════════════════════════════════════════════════════════════════════
//  CATEGORIES
// ═══════════════════════════════════════════════════════════════════════════

async function loadCategories() {
    const res = await newsRequest('/news/categories');
    const grid = document.getElementById('categoriesGrid');
    if (!res?.ok) { grid.innerHTML = '<div class="empty-state" style="text-align:center;padding:24px;">Failed to load</div>'; return; }

    const cats = await res.json();
    if (!cats || cats.length === 0) { grid.innerHTML = '<div class="empty-state" style="text-align:center;padding:24px;">No categories</div>'; return; }

    grid.innerHTML = cats.map(c => `
        <div class="news-card-item">
            <div class="news-card-item-name">${esc(c.name)}</div>
            <div class="news-card-item-meta">${c.article_count ? c.article_count + ' articles' : ''}</div>
        </div>
    `).join('');
}

// ═══════════════════════════════════════════════════════════════════════════
//  SOURCES
// ═══════════════════════════════════════════════════════════════════════════

async function loadSources() {
    const res = await newsRequest('/news/sources');
    const grid = document.getElementById('sourcesGrid');
    if (!res?.ok) { grid.innerHTML = '<div class="empty-state" style="text-align:center;padding:24px;">Failed to load</div>'; return; }

    const sources = await res.json();
    if (!sources || sources.length === 0) { grid.innerHTML = '<div class="empty-state" style="text-align:center;padding:24px;">No sources</div>'; return; }

    grid.innerHTML = sources.map(s => `
        <div class="news-card-item">
            <div class="news-card-item-name">${esc(s.name || s.domain || s.source_name)}</div>
            <div class="news-card-item-meta">${s.domain ? s.domain : ''}</div>
        </div>
    `).join('');
}

// ═══════════════════════════════════════════════════════════════════════════
//  UTILITIES
// ═══════════════════════════════════════════════════════════════════════════

function esc(str) {
    if (str == null) return '';
    const div = document.createElement('div');
    div.textContent = String(str);
    return div.innerHTML;
}

function formatDate(dateStr) {
    if (!dateStr) return '—';
    const d = new Date(dateStr);
    return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function formatTimeAgo(dateStr) {
    if (!dateStr) return '—';
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    return `${days}d ago`;
}

function formatDuration(ms) {
    if (!ms || ms < 0) return '—';
    const secs = Math.floor(ms / 1000);
    if (secs < 60) return `${secs}s`;
    const mins = Math.floor(secs / 60);
    const rem = secs % 60;
    return `${mins}m ${rem}s`;
}

// ═══════════════════════════════════════════════════════════════════════════
//  AUTHORS
// ═══════════════════════════════════════════════════════════════════════════

let allAuthors = [];

async function loadAuthors() {
    const res = await newsRequest('/news/authors?limit=100');
    const tbody = document.getElementById('authorsTable');
    if (!res?.ok) { tbody.innerHTML = '<tr><td colspan="6" class="empty-state" style="text-align:center;padding:24px;">Failed to load</td></tr>'; return; }

    allAuthors = await res.json();
    if (!allAuthors || allAuthors.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="empty-state" style="text-align:center;padding:24px;">No authors yet. Click "+ Add Author" to create one.</td></tr>';
        return;
    }

    tbody.innerHTML = allAuthors.map(a => {
        const initials = a.name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
        const photoHtml = a.photoS3Key
            ? `<img class="employee-avatar-img" src="${esc(a.photoUrl || '')}" alt="${esc(a.name)}" style="width:36px;height:36px;border-radius:50%;object-fit:cover;">`
            : `<div class="employee-avatar" style="width:36px;height:36px;border-radius:50%;background:var(--brand-primary);color:var(--text-inverse);display:flex;align-items:center;justify-content:center;font-size:0.75rem;font-weight:600;flex-shrink:0;">${initials}</div>`;
        return `<tr>
        <td>
            <div class="employee-info" style="display:flex;align-items:center;gap:12px;">
                ${photoHtml}
                <div>
                    <div style="font-weight:500;">${esc(a.name)}</div>
                    ${a.designation ? `<div style="font-size:0.75rem;color:var(--text-secondary);">${esc(a.designation)}</div>` : ''}
                </div>
            </div>
        </td>
        <td>${esc(a.company) || '<span style="color:var(--text-muted);">-</span>'}</td>
        <td>${esc(a.email) || '<span style="color:var(--text-muted);">-</span>'}</td>
        <td><span class="status-badge ${a.isActive ? 'active' : 'neutral'}">${a.isActive ? 'Active' : 'Inactive'}</span></td>
        <td class="actions-cell">
            <button class="action-btn" title="Edit" onclick="event.stopPropagation(); editAuthor('${a.id}')">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            </button>
            <button class="action-btn delete" title="Delete" onclick="event.stopPropagation(); deleteAuthor('${a.id}', '${esc(a.name)}')">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
            </button>
        </td>
    </tr>`;
    }).join('');
}

function openAuthorModal(author = null) {
    document.getElementById('authorModalTitle').textContent = author ? 'Edit Author' : 'Add Author';
    document.getElementById('authorEditId').value = author?.id || '';
    document.getElementById('authorName').value = author?.name || '';
    document.getElementById('authorDesignation').value = author?.designation || '';
    document.getElementById('authorCompany').value = author?.company || '';
    document.getElementById('authorEmail').value = author?.email || '';
    document.getElementById('authorBio').value = author?.bio || '';
    // Reset photo
    document.getElementById('authorPhoto').value = '';
    document.getElementById('authorPhotoName').textContent = '';
    const photoPreview = document.getElementById('authorPhotoPreview');
    if (author?.photoS3Key || author?.photoUrl) {
        photoPreview.innerHTML = `<img src="${author.photoUrl || ''}" style="width:100%;height:100%;object-fit:cover;">`;
    } else {
        photoPreview.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--text-secondary)" stroke-width="1.5"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>';
    }
    document.getElementById('authorModal').classList.add('active');
}

function closeAuthorModal() {
    document.getElementById('authorModal').classList.remove('active');
}

function editAuthor(id) {
    const author = allAuthors.find(a => a.id === id);
    if (author) openAuthorModal(author);
}

async function saveAuthor() {
    const id = document.getElementById('authorEditId').value;
    const body = {
        name: document.getElementById('authorName').value.trim(),
        designation: document.getElementById('authorDesignation').value.trim() || null,
        company: document.getElementById('authorCompany').value.trim() || null,
        email: document.getElementById('authorEmail').value.trim() || null,
        bio: document.getElementById('authorBio').value.trim() || null
    };

    if (!body.name) { Toast.error('Name is required'); return; }

    let res;
    if (id) {
        res = await newsRequest(`/news/authors/${id}`, { method: 'PUT', body: JSON.stringify(body) });
    } else {
        res = await newsRequest('/news/authors', { method: 'POST', body: JSON.stringify(body) });
    }

    if (!res?.ok) { Toast.error('Failed to save author'); return; }

    // Get author ID (from existing or newly created)
    let authorId = id;
    if (!authorId) {
        try {
            const data = await res.json();
            authorId = data.id;
        } catch { Toast.error('Author saved but failed to get ID for photo upload'); return; }
    }

    // Upload photo if a file was selected
    const photoInput = document.getElementById('authorPhoto');
    if (photoInput.files && photoInput.files[0]) {
        const formData = new FormData();
        formData.append('file', photoInput.files[0]);

        if (typeof api !== 'undefined' && typeof api.ensureValidToken === 'function') {
            await api.ensureValidToken();
        }
        const token = getAuthToken();
        try {
            const photoRes = await fetch(`${NEWS_API}/news/authors/${authorId}/photo`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` },
                body: formData
            });
            if (!photoRes.ok) {
                const err = await photoRes.text().catch(() => '');
                Toast.error('Author saved but photo upload failed' + (err ? ': ' + err : ''));
                loadAuthors();
                closeAuthorModal();
                return;
            }
        } catch (err) {
            console.error('[NewsAdmin] Photo upload error:', err);
            Toast.error('Author saved but photo upload failed');
            loadAuthors();
            closeAuthorModal();
            return;
        }
    }

    Toast.success(id ? 'Author updated' : 'Author created');
    closeAuthorModal();
    loadAuthors();
}

function previewAuthorPhoto(input) {
    const preview = document.getElementById('authorPhotoPreview');
    const nameLabel = document.getElementById('authorPhotoName');
    if (input.files && input.files[0]) {
        const file = input.files[0];
        nameLabel.textContent = file.name;
        const reader = new FileReader();
        reader.onload = (e) => {
            preview.innerHTML = `<img src="${e.target.result}" style="width:100%;height:100%;object-fit:cover;">`;
        };
        reader.readAsDataURL(file);
    }
}

async function deleteAuthor(id, name) {
    if (!confirm(`Delete author "${name}"? This will also delete their articles.`)) return;
    const res = await newsRequest(`/news/authors/${id}`, { method: 'DELETE' });
    if (res?.ok) { Toast.success('Author deleted'); loadAuthors(); }
    else Toast.error('Failed to delete author');
}

// ═══════════════════════════════════════════════════════════════════════════
//  GUEST ARTICLES
// ═══════════════════════════════════════════════════════════════════════════

let quillEditor = null;
let allGuestArticles = [];

async function loadGuestArticles() {
    const res = await newsRequest('/news/guest-articles?limit=100');
    const tbody = document.getElementById('guestArticlesTable');
    if (!res?.ok) { tbody.innerHTML = '<tr><td colspan="6" class="empty-state" style="text-align:center;padding:24px;">Failed to load</td></tr>'; return; }

    const data = await res.json();
    allGuestArticles = data.articles || data || [];

    if (allGuestArticles.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="empty-state" style="text-align:center;padding:24px;">No guest articles yet. Click "+ New Article" to create one.</td></tr>';
        return;
    }

    tbody.innerHTML = allGuestArticles.map(a => {
        const authorName = a.author?.name || '—';
        const statusClass = a.status === 'published' ? 'active' : 'pending';
        return `<tr>
        <td><span style="font-weight:500;">${esc(a.title)}</span></td>
        <td>${esc(authorName)}</td>
        <td>${a.category ? `<span class="status-badge neutral">${esc(a.category)}</span>` : '<span style="color:var(--text-muted);">-</span>'}</td>
        <td><span class="status-badge ${statusClass}">${esc(a.status)}</span></td>
        <td style="white-space:nowrap;">${a.publishedAt ? formatTimeAgo(a.publishedAt) : '—'}</td>
        <td class="actions-cell">
            <button class="action-btn" title="Engagement Stats" data-article-id="${a.id}" data-article-title="${esc(a.title)}" onclick="event.stopPropagation(); showEngagementStats(this.dataset.articleId, this.dataset.articleTitle)">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 20V10"/><path d="M12 20V4"/><path d="M6 20v-6"/></svg>
            </button>
            <button class="action-btn" title="Edit" onclick="event.stopPropagation(); editGuestArticle('${a.id}')">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            </button>
            <button class="action-btn delete" title="Delete" data-article-id="${a.id}" data-article-title="${esc(a.title)}" onclick="event.stopPropagation(); deleteGuestArticle(this.dataset.articleId, this.dataset.articleTitle)">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
            </button>
        </td>
    </tr>`;
    }).join('');
}

function initQuillEditor() {
    if (quillEditor) return;
    quillEditor = new Quill('#quillEditor', {
        theme: 'snow',
        placeholder: 'Write your article content here...',
        modules: {
            toolbar: [
                [{ header: [1, 2, 3, false] }],
                ['bold', 'italic', 'underline', 'strike'],
                [{ list: 'ordered' }, { list: 'bullet' }],
                ['blockquote', 'code-block'],
                ['link', 'image'],
                [{ align: [] }],
                ['clean']
            ]
        }
    });
}

async function openArticleEditor(article = null) {
    // Populate author dropdown
    if (allAuthors.length === 0) {
        const res = await newsRequest('/news/authors?limit=100');
        if (res?.ok) allAuthors = await res.json();
    }
    const authorSelect = document.getElementById('articleAuthor');
    authorSelect.innerHTML = '<option value="">Select author...</option>' +
        allAuthors.map(a => `<option value="${a.id}">${esc(a.name)}${a.designation ? ' — ' + esc(a.designation) : ''}</option>`).join('');

    document.getElementById('articleEditorTitle').textContent = article ? 'Edit Article' : 'New Article';
    document.getElementById('articleEditId').value = article?.id || '';
    document.getElementById('articleTitle').value = article?.title || '';
    document.getElementById('articleAuthor').value = article?.authorId || '';
    document.getElementById('articleCategory').value = article?.category || '';
    document.getElementById('articleStatus').value = article?.status || 'draft';
    document.getElementById('articleExcerpt').value = article?.excerpt || '';

    document.getElementById('articleEditorModal').classList.add('active');

    // Init Quill after modal is visible
    setTimeout(() => {
        initQuillEditor();
        if (article?.content) {
            quillEditor.root.innerHTML = article.content;
        } else {
            quillEditor.root.innerHTML = '';
        }
        // Convert author select to searchable dropdown
        if (typeof convertSelectToSearchable === 'function') {
            convertSelectToSearchable('articleAuthor', {
                placeholder: 'Select author...',
                searchPlaceholder: 'Search authors...'
            });
        }
    }, 100);
}

function closeArticleEditor() {
    document.getElementById('articleEditorModal').classList.remove('active');
}

async function editGuestArticle(id) {
    const article = allGuestArticles.find(a => a.id === id);
    if (!article) return;

    // Fetch full content (list might not include it)
    const res = await newsRequest(`/news/guest-articles/${id}`);
    if (res?.ok) {
        const full = await res.json();
        openArticleEditor(full);
    }
}

async function saveGuestArticle() {
    const id = document.getElementById('articleEditId').value;
    const body = {
        authorId: document.getElementById('articleAuthor').value,
        title: document.getElementById('articleTitle').value.trim(),
        content: quillEditor ? quillEditor.root.innerHTML : '',
        excerpt: document.getElementById('articleExcerpt').value.trim() || null,
        category: document.getElementById('articleCategory').value.trim() || null,
        status: document.getElementById('articleStatus').value
    };

    if (!body.title) { Toast.error('Title is required'); return; }
    if (!body.authorId) { Toast.error('Author is required'); return; }
    if (!body.content || body.content === '<p><br></p>') { Toast.error('Content is required'); return; }

    let res;
    if (id) {
        res = await newsRequest(`/news/guest-articles/${id}`, { method: 'PUT', body: JSON.stringify(body) });
    } else {
        res = await newsRequest('/news/guest-articles', { method: 'POST', body: JSON.stringify(body) });
    }

    if (res?.ok) {
        Toast.success(id ? 'Article updated' : 'Article created');
        closeArticleEditor();
        loadGuestArticles();
    } else {
        const err = await res?.json().catch(() => null);
        Toast.error(err?.error || 'Failed to save article');
    }
}

async function deleteGuestArticle(id, title) {
    if (!confirm(`Delete article "${title}"?`)) return;
    const res = await newsRequest(`/news/guest-articles/${id}`, { method: 'DELETE' });
    if (res?.ok) { Toast.success('Article deleted'); loadGuestArticles(); }
    else Toast.error('Failed to delete article');
}

// ═══════════════════════════════════════════════════════════════════════════
//  ENGAGEMENT STATS
// ═══════════════════════════════════════════════════════════════════════════

async function showEngagementStats(articleId, title) {
    document.getElementById('engagementArticleTitle').textContent = title;
    document.getElementById('engViews').textContent = '...';
    document.getElementById('engLikes').textContent = '...';
    document.getElementById('engComments').textContent = '...';
    document.getElementById('engShares').textContent = '...';
    document.getElementById('engReadTime').textContent = '...';
    document.getElementById('engagementModal').classList.add('active');

    const res = await newsRequest(`/news/engagement/${articleId}/stats`);
    if (res?.ok) {
        const stats = await res.json();
        document.getElementById('engViews').textContent = stats.viewCount ?? 0;
        document.getElementById('engLikes').textContent = stats.likeCount ?? 0;
        document.getElementById('engComments').textContent = stats.commentCount ?? 0;
        document.getElementById('engShares').textContent = stats.shareCount ?? 0;
        const avgSecs = Math.round(stats.avgReadingTimeSeconds ?? 0);
        if (avgSecs === 0) {
            document.getElementById('engReadTime').textContent = 'No data';
        } else if (avgSecs < 60) {
            document.getElementById('engReadTime').textContent = `${avgSecs}s`;
        } else {
            document.getElementById('engReadTime').textContent = `${Math.floor(avgSecs / 60)}m ${avgSecs % 60}s`;
        }
    } else {
        document.getElementById('engViews').textContent = '—';
        document.getElementById('engLikes').textContent = '—';
        document.getElementById('engComments').textContent = '—';
        document.getElementById('engShares').textContent = '—';
        document.getElementById('engReadTime').textContent = '—';
    }

    // Load comments for moderation
    loadEngagementComments(articleId);
}

async function loadEngagementComments(articleId) {
    const list = document.getElementById('engCommentsList');
    if (!list) return;
    list.innerHTML = '<div style="text-align:center;color:var(--text-secondary);font-size:0.8rem;padding:8px;">Loading...</div>';

    const res = await newsRequest(`/news/engagement/${articleId}/comments?limit=100`);
    if (!res?.ok) { list.innerHTML = '<div style="text-align:center;color:var(--text-secondary);font-size:0.8rem;padding:8px;">Failed to load</div>'; return; }

    const data = await res.json();
    const comments = data.comments || [];

    if (!comments.length) {
        list.innerHTML = '<div style="text-align:center;color:var(--text-secondary);font-size:0.8rem;padding:12px;">No comments yet</div>';
        return;
    }

    list.innerHTML = comments.map(c => {
        const date = new Date(c.createdAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
        const statusBadge = c.isApproved
            ? '<span class="status-badge active" style="font-size:0.65rem;">Visible</span>'
            : '<span class="status-badge rejected" style="font-size:0.65rem;">Hidden</span>';
        const toggleLabel = c.isApproved ? 'Hide' : 'Show';
        const toggleClass = c.isApproved ? 'news-btn-ghost' : 'news-btn-primary';
        return `<div style="display:flex;align-items:flex-start;gap:10px;padding:10px 0;border-bottom:1px solid var(--border-color-light);">
            <div style="flex:1;min-width:0;">
                <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
                    <strong style="font-size:0.8rem;color:var(--text-primary);">${esc(c.visitorName || c.name)}</strong>
                    ${statusBadge}
                    <span style="font-size:0.68rem;color:var(--text-secondary);margin-left:auto;">${date}</span>
                </div>
                <div style="font-size:0.82rem;color:var(--text-secondary);line-height:1.4;">${esc(c.content)}</div>
            </div>
            <div style="display:flex;gap:4px;flex-shrink:0;">
                <button class="news-btn ${toggleClass}" style="font-size:0.7rem;padding:4px 10px;" onclick="toggleCommentApproval('${c.id}', ${!c.isApproved}, '${articleId}')">${toggleLabel}</button>
                <button class="news-btn news-btn-ghost" style="font-size:0.7rem;padding:4px 8px;color:var(--color-error);" onclick="deleteComment('${c.id}', '${articleId}')">Delete</button>
            </div>
        </div>`;
    }).join('');
}

async function toggleCommentApproval(commentId, approved, articleId) {
    const res = await newsRequest(`/news/engagement/comment/${commentId}/approve`, {
        method: 'PUT',
        body: JSON.stringify({ approved })
    });
    if (res?.ok) {
        Toast.success(approved ? 'Comment visible' : 'Comment hidden');
        loadEngagementComments(articleId);
        // Refresh stats
        const statsRes = await newsRequest(`/news/engagement/${articleId}/stats`);
        if (statsRes?.ok) {
            const stats = await statsRes.json();
            document.getElementById('engComments').textContent = stats.commentCount ?? 0;
        }
    } else {
        Toast.error('Failed to update comment');
    }
}

async function deleteComment(commentId, articleId) {
    const confirmed = await Confirm.show({
        title: 'Delete Comment',
        message: 'Are you sure? This cannot be undone.',
        type: 'danger',
        confirmText: 'Delete'
    });
    if (!confirmed) return;

    const res = await newsRequest(`/news/engagement/comment/${commentId}`, { method: 'DELETE' });
    if (res?.ok) {
        Toast.success('Comment deleted');
        loadEngagementComments(articleId);
        const statsRes = await newsRequest(`/news/engagement/${articleId}/stats`);
        if (statsRes?.ok) {
            const stats = await statsRes.json();
            document.getElementById('engComments').textContent = stats.commentCount ?? 0;
        }
    } else {
        Toast.error('Failed to delete comment');
    }
}

function closeEngagementModal() {
    document.getElementById('engagementModal').classList.remove('active');
}

function previewArticle() {
    const title = document.getElementById('articleTitle').value;
    const content = quillEditor ? quillEditor.root.innerHTML : '';
    const win = window.open('', '_blank');
    win.document.write(`<!DOCTYPE html><html><head><title>${esc(title)}</title>
        <style>body{font-family:Inter,-apple-system,sans-serif;max-width:800px;margin:40px auto;padding:0 20px;color:#1a1a2e;}
        h1{font-size:2rem;margin-bottom:16px;} img{max-width:100%;border-radius:8px;}</style></head>
        <body><h1>${esc(title)}</h1><hr>${content}</body></html>`);
    win.document.close();
}

// ═══════════════════════════════════════════════════════════════════════════
//  AD SLOTS MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════

async function loadAds() {
    const res = await newsRequest(`/news/page-analytics/ads/all?_t=${Date.now()}`);
    if (!res) return;
    const data = await res.json();
    const ads = data.ads || [];
    const tbody = document.getElementById('adsTableBody');
    if (!ads.length) {
        tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;color:var(--text-secondary);">No ads yet</td></tr>';
        return;
    }
    window._adSlotCache = {};
    tbody.innerHTML = ads.map(a => {
        window._adSlotCache[a.id] = a;
        return `<tr>
        <td><strong>${esc(a.title)}</strong></td>
        <td><span style="font-size:0.7rem;padding:2px 6px;border-radius:4px;background:var(--bg-tertiary);color:var(--text-secondary);">${esc(a.adType)}</span></td>
        <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:0.75rem;color:var(--text-secondary);" title="${esc(a.linkUrl)}">${esc(a.linkUrl)}</td>
        <td>${a.position}</td>
        <td>${a.isActive ? '<span style="color:var(--color-success);">Yes</span>' : '<span style="color:var(--color-error);">No</span>'}</td>
        <td>${(a.impressions || 0).toLocaleString()}</td>
        <td>${(a.clicks || 0).toLocaleString()}</td>
        <td>${a.ctr || 0}%</td>
        <td style="white-space:nowrap;">
            <button class="news-btn news-btn-ghost" style="padding:4px 8px;font-size:0.7rem;" onclick="editAdById('${a.id}')">Edit</button>
            <button class="news-btn news-btn-ghost" style="padding:4px 8px;font-size:0.7rem;color:var(--color-error);" onclick="deleteAd('${a.id}')">Delete</button>
        </td>
    </tr>`;
    }).join('');
}

function openAdEditor() {
    document.getElementById('adEditorTitle').textContent = 'New Ad';
    document.getElementById('adEditId').value = '';
    document.getElementById('adTitle').value = '';
    document.getElementById('adDescription').value = '';
    document.getElementById('adLinkUrl').value = '';
    document.getElementById('adImageUrl').value = '';
    document.getElementById('adPosition').value = '1';
    document.getElementById('adType').value = 'product';
    document.getElementById('adEditorModal').classList.add('active');
}

function editAdById(adId) {
    const ad = window._adSlotCache?.[adId];
    if (ad) editAd(ad);
}

function editAd(ad) {
    document.getElementById('adEditorTitle').textContent = 'Edit Ad';
    document.getElementById('adEditId').value = ad.id;
    document.getElementById('adTitle').value = ad.title || '';
    document.getElementById('adDescription').value = ad.description || '';
    document.getElementById('adLinkUrl').value = ad.linkUrl || '';
    document.getElementById('adImageUrl').value = ad.imageUrl || '';
    document.getElementById('adPosition').value = ad.position || 1;
    document.getElementById('adType').value = ad.adType || 'product';
    document.getElementById('adEditorModal').classList.add('active');
    if (ad.linkUrl) previewAdUrl();
}

function closeAdEditor() {
    document.getElementById('adEditorModal').classList.remove('active');
    const wrap = document.getElementById('adPreviewWrap');
    if (wrap) wrap.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--text-secondary);font-size:0.8rem;">Enter a URL to preview</div>';
}

function previewAdUrl() {
    const url = document.getElementById('adLinkUrl').value.trim();
    const title = document.getElementById('adTitle').value.trim() || 'Ad Title';
    const wrap = document.getElementById('adPreviewWrap');
    if (!url) {
        wrap.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--text-secondary);font-size:0.8rem;">Enter a URL to preview</div>';
        return;
    }
    // Render exactly like KIP ad card
    wrap.innerHTML = `
        <div style="display:flex;flex-direction:column;height:100%;background:var(--bg-secondary);border-radius:8px;overflow:hidden;">
            <div style="flex:1;position:relative;overflow:hidden;min-height:0;">
                <iframe src="${url}" style="width:250%;height:250%;transform:scale(0.4);transform-origin:top left;border:none;pointer-events:none;"></iframe>
                <div style="position:absolute;inset:0;z-index:2;"></div>
            </div>
            <div style="padding:10px 14px 14px;border-top:1px solid var(--border-color-light);">
                <div style="font-weight:600;font-size:0.85rem;color:var(--text-primary);margin-bottom:6px;">${title}</div>
                <div style="display:inline-block;padding:5px 14px;border:1px solid var(--brand-primary);border-radius:6px;font-size:0.72rem;font-weight:600;color:var(--brand-primary);">Explore &rarr;</div>
            </div>
        </div>`;
}

async function saveAd() {
    const id = document.getElementById('adEditId').value;
    const body = {
        title: document.getElementById('adTitle').value,
        description: document.getElementById('adDescription').value,
        linkUrl: document.getElementById('adLinkUrl').value,
        imageUrl: document.getElementById('adImageUrl').value,
        position: parseInt(document.getElementById('adPosition').value) || 1,
        adType: document.getElementById('adType').value,
        isActive: true
    };
    if (!body.title) { showToast('Title is required', 'error'); return; }

    const path = id ? `/news/page-analytics/ads/${id}` : '/news/page-analytics/ads';
    const method = id ? 'PUT' : 'POST';
    const res = await newsRequest(path, { method, body: JSON.stringify(body) });
    if (res && res.ok) {
        showToast(id ? 'Ad updated' : 'Ad created', 'success');
        closeAdEditor();
        await loadAds();
    } else {
        const errText = res ? await res.text().catch(() => '') : 'No response';
        console.error('[Ad Save] Failed:', res?.status, errText);
        showToast('Failed to save ad: ' + (res?.status || 'network error'), 'error');
    }
}

async function deleteAd(adId) {
    const ad = window._adSlotCache?.[adId];
    const confirmed = await Confirm.show({
        title: 'Delete Ad',
        message: `Are you sure you want to delete "${ad?.title || 'this ad'}"?`,
        type: 'danger',
        confirmText: 'Delete',
        cancelText: 'Cancel'
    });
    if (!confirmed) return;

    const res = await newsRequest(`/news/page-analytics/ads/${adId}`, { method: 'DELETE' });
    if (res && res.ok) {
        showToast('Ad deleted', 'success');
        loadAds();
    } else {
        showToast('Failed to delete ad', 'error');
    }
}

// ═══════════════════════════════════════════════════════════════════════════
//  ANALYTICS
// ═══════════════════════════════════════════════════════════════════════════

async function loadAnalytics() {
    // Page stats
    const statsRes = await newsRequest(`/news/page-analytics/visits?page=kip&days=7&_t=${Date.now()}`);
    if (statsRes && statsRes.ok) {
        const data = await statsRes.json();
        const s = data.stats;
        document.getElementById('anlActiveUsers').textContent = s.activeUsers;
        document.getElementById('anlTotalVisits').textContent = s.totalVisits.toLocaleString();
        document.getElementById('anlUniqueToday').textContent = s.uniqueVisitorsToday.toLocaleString();
        document.getElementById('anlUniqueAll').textContent = s.uniqueVisitorsAllTime.toLocaleString();

        // Daily table
        const daily = data.daily || [];
        const tbody = document.getElementById('dailyVisitsBody');
        if (daily.length) {
            tbody.innerHTML = daily.map(d => `<tr>
                <td>${d.date}</td>
                <td>${d.visits.toLocaleString()}</td>
                <td>${d.uniqueVisitors.toLocaleString()}</td>
            </tr>`).join('');
        } else {
            tbody.innerHTML = '<tr><td colspan="3" style="text-align:center;color:var(--text-secondary);">No data yet</td></tr>';
        }
    }

    // Ad performance
    const adsRes = await newsRequest(`/news/page-analytics/ads/all?_t=${Date.now()}`);
    if (adsRes && adsRes.ok) {
        const data = await adsRes.json();
        const ads = data.ads || [];
        const tbody = document.getElementById('adPerformanceBody');
        if (ads.length) {
            tbody.innerHTML = ads.map(a => `<tr>
                <td><strong>${esc(a.title)}</strong><br><span style="font-size:0.7rem;color:var(--text-secondary);">${esc(a.linkUrl)}</span></td>
                <td>${(a.impressions || 0).toLocaleString()}</td>
                <td>${(a.clicks || 0).toLocaleString()}</td>
                <td>${a.ctr || 0}%</td>
            </tr>`).join('');
        } else {
            tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:var(--text-secondary);">No ads yet</td></tr>';
        }
    }
}
