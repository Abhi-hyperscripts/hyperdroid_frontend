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
    'sources': 'Sources'
};

let articleOffset = 0;
let deleteArticleId = null;
let searchDebounceTimer = null;
let tabDataLoaded = {};

// ── Authenticated fetch helper ──
async function newsRequest(path, options = {}) {
    const token = getAuthToken();
    if (!token) { window.location.href = '/index.html'; return null; }
    try {
        const res = await fetch(`${NEWS_API}${path}`, {
            ...options,
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
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
    const container = document.querySelector('.news-admin-container');
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
    document.querySelector('.news-admin-container')?.classList.remove('sidebar-open');
    document.getElementById('sidebarOverlay')?.classList.remove('active');
}

function switchTab(tabName) {
    document.querySelectorAll('#settingsSidebar .sidebar-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tabName);
    });
    document.querySelectorAll('.news-tab-content').forEach(el => {
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
}

// ═══════════════════════════════════════════════════════════════════════════
//  DASHBOARD
// ═══════════════════════════════════════════════════════════════════════════

async function loadDashboard() {
    const [catRes, srcRes, crawlRes, articlesRes] = await Promise.all([
        newsRequest('/news/categories'),
        newsRequest('/news/sources'),
        newsRequest('/news/crawl/status?limit=5'),
        newsRequest('/news?limit=1&offset=0')
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
        document.getElementById('statArticles').textContent = data.total ?? data.length ?? '—';
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
        el.innerHTML = '<span class="news-badge news-badge-success">Completed</span>';
    } else if (status === 'failed' || status === 'error') {
        el.innerHTML = '<span class="news-badge news-badge-error">Failed</span>';
    } else if (status === 'running' || status === 'in_progress') {
        el.innerHTML = '<span class="news-badge news-badge-pending">Running</span>';
    } else {
        el.innerHTML = `<span class="news-badge news-badge-info">${esc(last.status)}</span>`;
    }
    if (last.started_at || last.created_at) {
        timeEl.textContent = formatTimeAgo(last.started_at || last.created_at);
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

function renderCrawlTable(jobs, targetId) {
    const tbody = document.getElementById(targetId);
    if (!tbody) return;
    if (!jobs || jobs.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="news-empty">No crawl jobs yet</td></tr>';
        return;
    }
    const cols = targetId === 'dashCrawlHistory' ? 4 : 5;
    tbody.innerHTML = jobs.map(j => {
        const status = (j.status || '').toLowerCase();
        let badge = 'news-badge-info';
        if (status === 'completed') badge = 'news-badge-success';
        else if (status === 'failed' || status === 'error') badge = 'news-badge-error';
        else if (status === 'running' || status === 'in_progress') badge = 'news-badge-pending';

        const started = formatDate(j.started_at || j.created_at);
        const articles = j.articles_count ?? j.new_articles ?? '—';
        const duration = j.completed_at && j.started_at
            ? formatDuration(new Date(j.completed_at) - new Date(j.started_at))
            : '—';

        if (cols === 4) {
            return `<tr>
                <td><span class="news-badge ${badge}">${esc(j.status)}</span></td>
                <td class="td-meta">${started}</td>
                <td>${articles}</td>
                <td class="td-meta">${duration}</td>
            </tr>`;
        }
        const completed = j.completed_at ? formatDate(j.completed_at) : '—';
        const errors = j.error_message ? `<span style="color:var(--color-error);font-size:0.78rem;">${esc(j.error_message).substring(0, 60)}</span>` : '—';
        return `<tr>
            <td><span class="news-badge ${badge}">${esc(j.status)}</span></td>
            <td class="td-meta">${started}</td>
            <td class="td-meta">${completed}</td>
            <td>${articles}</td>
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
    const total = data.total ?? articles.length;

    // Client-side search filter (if backend doesn't support search param)
    if (search) {
        const q = search.toLowerCase();
        articles = articles.filter(a =>
            (a.title || '').toLowerCase().includes(q) ||
            (a.source || '').toLowerCase().includes(q)
        );
    }

    document.getElementById('articleCountLabel').textContent = `${total} articles`;

    const tbody = document.getElementById('articlesTable');
    if (articles.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="news-empty">No articles found</td></tr>';
        document.getElementById('articlesPagination').innerHTML = '';
        return;
    }

    tbody.innerHTML = articles.map(a => `<tr>
        <td class="td-title">${esc(a.title || a.headline)}</td>
        <td class="td-meta">${esc(a.source || a.source_name || '—')}</td>
        <td><span class="news-badge news-badge-info">${esc(a.category || '—')}</span></td>
        <td class="td-meta">${formatTimeAgo(a.published_at || a.created_at)}</td>
        <td class="td-actions"><button class="news-btn news-btn-danger" onclick="showDeleteModal('${a.id}', '${esc(a.title || a.headline)}')">Delete</button></td>
    </tr>`).join('');

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
    document.getElementById('deleteModal').style.display = 'flex';
}

function closeDeleteModal() {
    deleteArticleId = null;
    document.getElementById('deleteModal').style.display = 'none';
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
    if (!res?.ok) { grid.innerHTML = '<div class="news-empty">Failed to load</div>'; return; }

    const cats = await res.json();
    if (!cats || cats.length === 0) { grid.innerHTML = '<div class="news-empty">No categories</div>'; return; }

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
    if (!res?.ok) { grid.innerHTML = '<div class="news-empty">Failed to load</div>'; return; }

    const sources = await res.json();
    if (!sources || sources.length === 0) { grid.innerHTML = '<div class="news-empty">No sources</div>'; return; }

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
