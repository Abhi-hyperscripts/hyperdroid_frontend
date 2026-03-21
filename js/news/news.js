// ============================================
// Ragenaizer NewsWire — Public Digital Media Page
// Auto-refresh every 5 min, category/country/signal filters
// ============================================

const NEWS_API = CONFIG.newsApiBaseUrl;
const PAGE_SIZE = 20;
let currentCategory = '';
let currentCountry = '';
let currentSignal = '';
let currentOffset = 0;
let allArticles = [];
let autoRefreshTimer = null;
const AUTO_REFRESH_MS = 5 * 60 * 1000;

// ── Init ──
document.addEventListener('DOMContentLoaded', async () => {
    await loadCategories();
    await loadNews();
    startAutoRefresh();
    updateLiveTime();
    setInterval(updateLiveTime, 60000);
});

// ── Theme Toggle ──
function toggleTheme() {
    const body = document.body;
    const btn = document.getElementById('themeToggle');
    const mobileLabel = document.getElementById('mobileThemeLabel');
    const mobileIcon = document.getElementById('mobileThemeIcon');
    if (body.classList.contains('nw-dark')) {
        body.classList.remove('nw-dark');
        body.classList.add('nw-light');
        if (btn) btn.textContent = 'Dark';
        if (mobileLabel) mobileLabel.textContent = 'Dark Mode';
        if (mobileIcon) mobileIcon.innerHTML = '&#9728;';
        localStorage.setItem('nw_theme', 'light');
    } else {
        body.classList.remove('nw-light');
        body.classList.add('nw-dark');
        if (btn) btn.textContent = 'Light';
        if (mobileLabel) mobileLabel.textContent = 'Light Mode';
        if (mobileIcon) mobileIcon.innerHTML = '&#9790;';
        localStorage.setItem('nw_theme', 'dark');
    }
}

function applySavedTheme() {
    const saved = localStorage.getItem('nw_theme');
    const btn = document.getElementById('themeToggle');
    const mobileLabel = document.getElementById('mobileThemeLabel');
    const mobileIcon = document.getElementById('mobileThemeIcon');
    if (saved === 'light') {
        document.body.classList.remove('nw-dark');
        document.body.classList.add('nw-light');
        if (btn) btn.textContent = 'Dark';
        if (mobileLabel) mobileLabel.textContent = 'Dark Mode';
        if (mobileIcon) mobileIcon.innerHTML = '&#9728;';
    }
}

// ── Mobile Slide Menu ──
function toggleMobileMenu() {
    const menu = document.getElementById('slideMenu');
    const overlay = document.getElementById('menuOverlay');
    const isOpen = menu.classList.contains('active');
    if (isOpen) {
        menu.classList.remove('active');
        overlay.classList.remove('active');
        document.body.style.overflow = '';
    } else {
        menu.classList.add('active');
        overlay.classList.add('active');
        document.body.style.overflow = 'hidden';
        // Sync filter values from desktop to mobile
        const cf = document.getElementById('countryFilter');
        const cfm = document.getElementById('countryFilterMobile');
        if (cf && cfm) cfm.value = cf.value;
        const sf = document.getElementById('signalFilter');
        const sfm = document.getElementById('signalFilterMobile');
        if (sf && sfm) sfm.value = sf.value;
    }
}

function syncFilter(type, value) {
    if (type === 'country') {
        document.getElementById('countryFilter').value = value;
        currentCountry = value;
    } else if (type === 'signal') {
        document.getElementById('signalFilter').value = value;
        currentSignal = value;
    }
    loadNews();
}

function mobileCategoryClick(btn, cat) {
    currentCategory = cat;
    // Update both desktop and mobile category buttons
    document.querySelectorAll('.nw-cat').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.nw-cat').forEach(b => {
        if (b.dataset.cat === cat) b.classList.add('active');
    });
    loadNews();
    toggleMobileMenu();
}

// ── Live Clock ──
function updateLiveTime() {
    const el = document.getElementById('liveTime');
    if (!el) return;
    const now = new Date();
    const opts = { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' };
    el.textContent = now.toLocaleDateString('en-GB', opts);
}

// ── Auto Refresh ──
function startAutoRefresh() {
    if (autoRefreshTimer) clearInterval(autoRefreshTimer);
    autoRefreshTimer = setInterval(() => loadNews(true), AUTO_REFRESH_MS);
}

// ── Load Categories ──
async function loadCategories() {
    try {
        const res = await fetch(`${NEWS_API}/news/categories`);
        if (!res.ok) return;
        const cats = await res.json();
        const bar = document.getElementById('categoryBar');
        if (!bar || !Array.isArray(cats)) return;
        let html = '<button class="nw-cat active" data-cat="" onclick="filterCategory(this, \'\')">All</button>';
        cats.forEach(c => {
            html += `<button class="nw-cat" data-cat="${esc(c.name)}" onclick="filterCategory(this, '${esc(c.name)}')">${esc(c.name)}</button>`;
        });
        bar.innerHTML = html;

        // Populate mobile category bar
        const mobileBar = document.getElementById('mobileCategoryBar');
        if (mobileBar) {
            let mhtml = '<button class="nw-cat active" data-cat="" onclick="mobileCategoryClick(this, \'\')">All</button>';
            cats.forEach(c => {
                mhtml += `<button class="nw-cat" data-cat="${esc(c.name)}" onclick="mobileCategoryClick(this, '${esc(c.name)}')">${esc(c.name)}</button>`;
            });
            mobileBar.innerHTML = mhtml;
        }
    } catch (e) {
        console.warn('[NewsWire] Categories load failed:', e);
    }
}

// ── Load News ──
async function loadNews(silent = false) {
    if (!silent) showLoading(true);
    currentOffset = 0;

    try {
        let url = `${NEWS_API}/news?limit=${PAGE_SIZE}&offset=0`;
        if (currentCategory) url += `&category=${encodeURIComponent(currentCategory)}`;
        if (currentCountry) url += `&country=${encodeURIComponent(currentCountry)}`;
        if (currentSignal) url += `&signal_type=${encodeURIComponent(currentSignal)}`;

        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        allArticles = data.articles || [];

        renderArticles(allArticles);
        updateArticleCount(allArticles.length);
        showLoadMore(allArticles.length >= PAGE_SIZE);
    } catch (e) {
        console.error('[NewsWire] Load failed:', e);
        if (!silent) showEmpty();
    } finally {
        if (!silent) showLoading(false);
    }
}

// ── Load More ──
async function loadMore() {
    currentOffset += PAGE_SIZE;
    try {
        let url = `${NEWS_API}/news?limit=${PAGE_SIZE}&offset=${currentOffset}`;
        if (currentCategory) url += `&category=${encodeURIComponent(currentCategory)}`;
        if (currentCountry) url += `&country=${encodeURIComponent(currentCountry)}`;
        if (currentSignal) url += `&signal_type=${encodeURIComponent(currentSignal)}`;

        const res = await fetch(url);
        const data = await res.json();
        const newArticles = data.articles || [];
        allArticles = allArticles.concat(newArticles);

        renderArticles(allArticles);
        updateArticleCount(allArticles.length);
        showLoadMore(newArticles.length >= PAGE_SIZE);
    } catch (e) {
        console.error('[NewsWire] Load more failed:', e);
    }
}

// ── Render ──
function renderArticles(articles) {
    const grid = document.getElementById('newsGrid');
    const empty = document.getElementById('emptyState');
    const loading = document.getElementById('loadingState');

    if (loading) loading.style.display = 'none';

    if (!articles.length) {
        if (grid) grid.style.display = 'none';
        if (empty) empty.style.display = 'flex';
        return;
    }

    if (empty) empty.style.display = 'none';
    if (!grid) return;
    grid.style.display = '';

    // First 2 articles = featured (large), rest = standard cards
    let html = '';

    // Featured row (first 2)
    const featured = articles.slice(0, 2);
    if (featured.length) {
        html += '<div class="nw-featured-row">';
        featured.forEach(a => {
            html += renderFeaturedCard(a);
        });
        html += '</div>';
    }

    // Standard cards (rest)
    const standard = articles.slice(2);
    if (standard.length) {
        html += '<div class="nw-cards-grid">';
        standard.forEach(a => {
            html += renderStandardCard(a);
        });
        html += '</div>';
    }

    grid.innerHTML = html;
}

function renderFeaturedCard(a) {
    const img = a.imageUrl
        ? `<img class="nw-featured-img" src="${esc(a.imageUrl)}" alt="" onerror="this.style.display='none'">`
        : '';
    const source = a.sourceName || extractDomain(a.sourceUrl);
    const date = formatDate(a.createdAt);
    const signalTag = a.signalType
        ? `<span class="nw-stag">${esc(a.signalType.replace(/_/g, ' '))}</span>`
        : '';
    const whyLine = a.signalOpportunity
        ? `<p class="nw-why">${esc(a.signalOpportunity)}</p>`
        : '';

    return `
    <article class="nw-featured-card" onclick="window.open('${esc(a.sourceUrl)}','_blank')">
        ${img}
        <div class="nw-featured-body">
            ${signalTag}
            <h2 class="nw-featured-headline">${esc(a.headline)}</h2>
            ${whyLine}
            <p class="nw-featured-summary">${esc(a.aiSummary)}</p>
            <div class="nw-card-foot">
                <span class="nw-cat-label">${esc(a.category)}</span>
                <span class="nw-foot-right">${esc(source)} &middot; ${date}</span>
            </div>
        </div>
    </article>`;
}

function renderStandardCard(a) {
    const img = a.imageUrl
        ? `<div class="nw-card-img-wrap"><img class="nw-card-img" src="${esc(a.imageUrl)}" alt="" onerror="this.parentElement.style.display='none'"></div>`
        : '';
    const source = a.sourceName || extractDomain(a.sourceUrl);
    const date = formatDate(a.createdAt);
    const signalTag = a.signalType
        ? `<span class="nw-stag">${esc(a.signalType.replace(/_/g, ' '))}</span>`
        : '';
    const whyLine = a.signalOpportunity
        ? `<p class="nw-why">${esc(a.signalOpportunity)}</p>`
        : '';

    return `
    <article class="nw-card" onclick="window.open('${esc(a.sourceUrl)}','_blank')">
        ${img}
        <div class="nw-card-body">
            ${signalTag}
            <h3 class="nw-card-headline">${esc(a.headline)}</h3>
            ${whyLine}
            <p class="nw-card-summary">${esc(a.aiSummary)}</p>
            <div class="nw-card-foot">
                <span class="nw-cat-label">${esc(a.category)}</span>
                <span class="nw-foot-right">${esc(source)} &middot; ${date}</span>
            </div>
        </div>
    </article>`;
}

// ── Filters ──
function filterCategory(btn, cat) {
    currentCategory = cat;
    document.querySelectorAll('.nw-cat').forEach(b => b.classList.remove('active'));
    document.querySelectorAll(`.nw-cat[data-cat="${cat}"]`).forEach(b => b.classList.add('active'));
    loadNews();
}

function filterCountry() {
    currentCountry = document.getElementById('countryFilter').value;
    loadNews();
}

function filterSignal() {
    currentSignal = document.getElementById('signalFilter').value;
    loadNews();
}

function clearFilters() {
    currentCategory = '';
    currentCountry = '';
    currentSignal = '';
    document.getElementById('countryFilter').value = '';
    document.getElementById('signalFilter').value = '';
    const cfm = document.getElementById('countryFilterMobile');
    const sfm = document.getElementById('signalFilterMobile');
    if (cfm) cfm.value = '';
    if (sfm) sfm.value = '';
    document.querySelectorAll('.nw-cat').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.nw-cat[data-cat=""]').forEach(b => b.classList.add('active'));
    loadNews();
}

// ── UI Helpers ──
function showLoading(show) {
    const el = document.getElementById('loadingState');
    if (el) el.style.display = show ? 'flex' : 'none';
    const grid = document.getElementById('newsGrid');
    if (grid && show) grid.style.display = 'none';
}

function showEmpty() {
    const el = document.getElementById('emptyState');
    if (el) el.style.display = 'flex';
    const grid = document.getElementById('newsGrid');
    if (grid) grid.style.display = 'none';
}

function showLoadMore(show) {
    const el = document.getElementById('loadMoreWrap');
    if (el) el.style.display = show ? 'flex' : 'none';
}

function updateArticleCount(count) {
    const el = document.getElementById('articleCount');
    if (el) el.textContent = `${count} article${count !== 1 ? 's' : ''}`;
}

// (helpers removed — keeping it simple)

// ── Utilities ──
function esc(s) {
    if (!s) return '';
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
}

function extractDomain(url) {
    try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

function formatDate(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    const now = new Date();
    const diffMs = now - d;
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return 'just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr}h ago`;
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

// ── Mode Toggle (News / Articles) ──
let currentMode = 'news';
let guestArticles = [];
let guestOffset = 0;

function switchMode(mode) {
    if (mode === currentMode) return;
    currentMode = mode;

    // Update toggle buttons
    document.querySelectorAll('.nw-mode-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.mode === mode);
    });

    // Toggle filter bar visibility — hide filters for articles
    const filters = document.querySelector('.nw-filters');
    const categories = document.getElementById('categoryBar');
    if (filters) filters.style.display = mode === 'articles' ? 'none' : '';
    if (categories) categories.style.display = mode === 'articles' ? 'none' : '';

    if (mode === 'articles') {
        loadGuestArticles();
    } else {
        loadNews();
    }
}

// ── Visitor ID (for likes) ──
function getVisitorId() {
    let id = localStorage.getItem('kip_visitor_id');
    if (!id) { id = crypto.randomUUID(); localStorage.setItem('kip_visitor_id', id); }
    return id;
}

async function loadGuestArticles(silent = false) {
    if (!silent) showLoading(true);
    guestOffset = 0;

    try {
        const res = await fetch(`${NEWS_API}/news/guest-articles?limit=${PAGE_SIZE}&offset=0`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        guestArticles = data.articles || [];

        renderFeed(guestArticles);
        updateArticleCount(guestArticles.length);
        showLoadMore(guestArticles.length >= PAGE_SIZE);
    } catch (e) {
        console.error('[KIP] Guest articles load failed:', e);
        if (!silent) showEmpty();
    } finally {
        if (!silent) showLoading(false);
    }
}

async function loadMoreGuest() {
    guestOffset += PAGE_SIZE;
    try {
        const res = await fetch(`${NEWS_API}/news/guest-articles?limit=${PAGE_SIZE}&offset=${guestOffset}`);
        const data = await res.json();
        const newArticles = data.articles || [];
        guestArticles = guestArticles.concat(newArticles);

        renderFeed(guestArticles);
        updateArticleCount(guestArticles.length);
        showLoadMore(newArticles.length >= PAGE_SIZE);
    } catch (e) {
        console.error('[KIP] Load more guest articles failed:', e);
    }
}

// ── LinkedIn-Style Feed Rendering ──
function renderFeed(articles) {
    const grid = document.getElementById('newsGrid');
    const empty = document.getElementById('emptyState');
    const loading = document.getElementById('loadingState');

    if (loading) loading.style.display = 'none';
    if (!articles.length) {
        if (grid) grid.style.display = 'none';
        if (empty) empty.style.display = 'flex';
        return;
    }
    if (empty) empty.style.display = 'none';
    if (!grid) return;
    grid.style.display = '';

    let html = '<div class="nw-feed">';
    articles.forEach((a, i) => { html += renderPost(a, i === 0); });
    html += '</div>';
    grid.innerHTML = html;

    // Fetch engagement stats for all articles
    articles.forEach(a => fetchPostStats(a.id));

    // Start impression & reading time tracking
    initArticleTracking();
}

function renderCommentIdentity(articleId) {
    const name = getCommenterName();
    if (!name) return '';
    return `<div class="nw-post-comment-identity">Commenting as <strong class="nw-commenter-display-name">${esc(name)}</strong> <button class="nw-post-comment-change" onclick="changeCommenterName('${articleId}')">change</button></div>`;
}

function renderPost(a, isFirst = false) {
    const author = a.author;
    const avatar = author?.photoUrl
        ? `<img class="nw-post-avatar" src="${esc(author.photoUrl)}" alt="${esc(author.name)}">`
        : `<div class="nw-post-avatar-initials">${esc((author?.name || '?').split(' ').map(n=>n[0]).join('').substring(0,2).toUpperCase())}</div>`;
    const role = author ? [author.designation, author.company].filter(Boolean).join(' · ') : '';
    const catTag = a.category ? `<span class="nw-post-category">${esc(a.category)}</span>` : '';
    const timeAgo = formatDate(a.publishedAt || a.createdAt);
    const contentClass = isFirst ? 'nw-post-content' : 'nw-post-content collapsed';
    const moreStyle = isFirst ? ' style="display:none"' : '';

    return `
    <div class="nw-post" data-article-id="${a.id}">
        <div class="nw-post-header">
            ${avatar}
            <div class="nw-post-author-info">
                <div class="nw-post-author-name">${esc(author?.name || 'Unknown')}</div>
                <div class="nw-post-author-role">${esc(role)}</div>
                <div class="nw-post-meta"><span>${timeAgo}</span></div>
            </div>
        </div>
        <div class="nw-post-body">
            ${catTag}
            <h3 class="nw-post-title">${esc(a.title)}</h3>
            <div class="${contentClass}" id="content-${a.id}">${author?.photoUrl ? `<img class="nw-post-author-photo" src="${esc(author.photoUrl)}" alt="${esc(author.name)}">` : ''}${a.content || esc(a.excerpt || '')}</div>
        </div>
        <button class="nw-post-more" id="more-${a.id}" onclick="expandPost('${a.id}')"${moreStyle}>...more</button>
        <div class="nw-post-stats" id="stats-${a.id}"></div>
        <div class="nw-post-actions">
            <button class="nw-post-action-btn" id="like-btn-${a.id}" onclick="toggleLike('${a.id}')">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3H14z"/><path d="M7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/></svg>
                <span id="like-count-${a.id}">Like</span>
            </button>
            <button class="nw-post-action-btn" onclick="toggleComments('${a.id}')">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                <span id="comment-count-${a.id}">Comment</span>
            </button>
            <button class="nw-post-action-btn" onclick="sharePost('${a.id}', '${esc(a.title).replace(/'/g, '&#39;')}')">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
                Share
            </button>
        </div>
        <div class="nw-post-comments" id="comments-${a.id}">
            ${renderCommentIdentity(a.id)}
            <div class="nw-post-comment-form">
                <input class="nw-post-comment-input" id="comment-input-${a.id}" placeholder="Add a comment..." onkeydown="if(event.key==='Enter')submitComment('${a.id}')">
                <button class="nw-post-comment-submit" onclick="submitComment('${a.id}')">Post</button>
            </div>
            <div class="nw-post-comment-list" id="comment-list-${a.id}"></div>
        </div>
    </div>`;
}

// ── Expand / Collapse ──
function expandPost(id) {
    const el = document.getElementById(`content-${id}`);
    const btn = document.getElementById(`more-${id}`);
    if (!el) return;
    if (el.classList.contains('collapsed')) {
        el.classList.remove('collapsed');
        btn.textContent = '...less';
    } else {
        el.classList.add('collapsed');
        btn.textContent = '...more';
    }
}

// ── Engagement: Stats ──
async function fetchPostStats(id) {
    try {
        const res = await fetch(`${NEWS_API}/news/engagement/${id}/stats?visitorId=${getVisitorId()}`);
        if (!res.ok) return;
        const s = await res.json();

        const statsEl = document.getElementById(`stats-${id}`);
        const parts = [];
        if (s.likeCount > 0) parts.push(`${s.likeCount} like${s.likeCount > 1 ? 's' : ''}`);
        if (s.commentCount > 0) parts.push(`${s.commentCount} comment${s.commentCount > 1 ? 's' : ''}`);
        if (s.shareCount > 0) parts.push(`${s.shareCount} share${s.shareCount > 1 ? 's' : ''}`);
        if (statsEl) statsEl.textContent = parts.join('  ·  ');

        // Update like button state
        const likeBtn = document.getElementById(`like-btn-${id}`);
        if (likeBtn && s.viewerHasLiked) likeBtn.classList.add('liked');
        const likeCount = document.getElementById(`like-count-${id}`);
        if (likeCount) likeCount.textContent = s.likeCount > 0 ? `Like (${s.likeCount})` : 'Like';

        const commentCount = document.getElementById(`comment-count-${id}`);
        if (commentCount) commentCount.textContent = s.commentCount > 0 ? `Comment (${s.commentCount})` : 'Comment';
    } catch {}
}

// ── Engagement: Like ──
async function toggleLike(id) {
    try {
        const res = await fetch(`${NEWS_API}/news/engagement/${id}/like`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ visitorId: getVisitorId() })
        });
        if (!res.ok) return;
        const data = await res.json();

        const btn = document.getElementById(`like-btn-${id}`);
        if (btn) btn.classList.toggle('liked', data.liked);
        const count = document.getElementById(`like-count-${id}`);
        if (count) count.textContent = data.likeCount > 0 ? `Like (${data.likeCount})` : 'Like';

        fetchPostStats(id);
    } catch {}
}

// ── Engagement: Comments ──
function toggleComments(id) {
    const el = document.getElementById(`comments-${id}`);
    if (!el) return;
    const isOpen = el.classList.contains('open');
    el.classList.toggle('open');
    if (!isOpen) loadComments(id);
}

async function loadComments(id) {
    const list = document.getElementById(`comment-list-${id}`);
    if (!list) return;
    try {
        const res = await fetch(`${NEWS_API}/news/engagement/${id}/comments?limit=20`);
        if (!res.ok) return;
        const data = await res.json();
        const comments = data.comments || [];

        if (!comments.length) {
            list.innerHTML = '<div class="nw-post-no-comments">No comments yet. Be the first!</div>';
            return;
        }

        list.innerHTML = comments.map(c => {
            const name = c.visitorName || c.name || 'Anonymous';
            const initials = name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
            return `
            <div class="nw-post-comment-item">
                <div class="nw-post-comment-avatar">${esc(initials)}</div>
                <div>
                    <div class="nw-post-comment-bubble">
                        <div class="nw-post-comment-author">${esc(name)}</div>
                        <div class="nw-post-comment-text">${esc(c.content)}</div>
                    </div>
                    <div class="nw-post-comment-time">${formatDate(c.createdAt)}</div>
                </div>
            </div>`;
        }).join('');
    } catch {}
}

// ── Commenter Name (localStorage + Prompt modal) ──
function getCommenterName() {
    return localStorage.getItem('kip_commenter_name') || '';
}

function setCommenterName(name) {
    localStorage.setItem('kip_commenter_name', name);
}

async function askForName() {
    const saved = getCommenterName();
    const name = await Prompt.show({
        title: 'What should we call you?',
        message: 'Enter your name to comment on articles',
        defaultValue: saved,
        placeholder: 'Your name',
        confirmText: 'Continue'
    });
    if (name && name.trim()) {
        setCommenterName(name.trim());
        // Update all visible identity bars
        document.querySelectorAll('.nw-commenter-display-name').forEach(el => el.textContent = name.trim());
        return name.trim();
    }
    return null;
}

async function changeCommenterName(articleId) {
    const name = await askForName();
    if (name) {
        // Re-render identity bar for this post
        const commentsEl = document.getElementById(`comments-${articleId}`);
        if (commentsEl) {
            const identityEl = commentsEl.querySelector('.nw-post-comment-identity');
            if (identityEl) {
                identityEl.querySelector('.nw-commenter-display-name').textContent = name;
            }
        }
    }
}

async function submitComment(id) {
    const input = document.getElementById(`comment-input-${id}`);
    if (!input || !input.value.trim()) return;

    let name = getCommenterName();
    if (!name) {
        name = await askForName();
        if (!name) return;
        // Show identity bar now that we have a name
        const commentsEl = document.getElementById(`comments-${id}`);
        if (commentsEl && !commentsEl.querySelector('.nw-post-comment-identity')) {
            commentsEl.insertAdjacentHTML('afterbegin', renderCommentIdentity(id));
        }
    }

    try {
        const res = await fetch(`${NEWS_API}/news/engagement/${id}/comment`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, content: input.value.trim() })
        });
        if (res.ok) {
            input.value = '';
            loadComments(id);
            fetchPostStats(id);
        }
    } catch {}
}

// ── Engagement: Share ──
async function sharePost(id, title) {
    const articleUrl = `${window.location.origin}/pages/kip-article.html?id=${id}`;

    if (navigator.share) {
        try {
            await navigator.share({ title, url: articleUrl });
            fetch(`${NEWS_API}/news/engagement/${id}/share`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ platform: 'copy_link' })
            });
        } catch {}
    } else {
        await navigator.clipboard.writeText(articleUrl).catch(() => {});
        fetch(`${NEWS_API}/news/engagement/${id}/share`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ platform: 'copy_link' })
        });
        // Brief visual feedback
        const post = document.querySelector(`[data-article-id="${id}"]`);
        if (post) {
            const shareBtn = post.querySelectorAll('.nw-post-action-btn')[2];
            if (shareBtn) { shareBtn.style.color = 'var(--nw-brand)'; setTimeout(() => shareBtn.style.color = '', 1500); }
        }
    }
    fetchPostStats(id);
}

// Override loadMore to handle both modes
const _originalLoadMore = loadMore;
loadMore = function() {
    if (currentMode === 'articles') {
        loadMoreGuest();
    } else {
        _originalLoadMore();
    }
};

// ── Impression & Reading Time Tracking ──
const _viewedArticles = new Set();      // articleId → already sent /view
const _viewIds = {};                     // articleId → viewId from server
const _readingTimers = {};               // articleId → { start, accumulated }
let _trackingObserver = null;

function initArticleTracking() {
    // Disconnect old observer if exists (e.g. on re-render)
    if (_trackingObserver) _trackingObserver.disconnect();

    _trackingObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            const articleId = entry.target.dataset.articleId;
            if (!articleId) return;

            if (entry.isIntersecting) {
                // Article scrolled into view
                onArticleVisible(articleId);
            } else {
                // Article scrolled out of view
                onArticleHidden(articleId);
            }
        });
    }, { threshold: 0.5 }); // 50% of article must be visible

    document.querySelectorAll('.nw-post[data-article-id]').forEach(post => {
        _trackingObserver.observe(post);
    });
}

function onArticleVisible(articleId) {
    // Record impression (once per session)
    if (!_viewedArticles.has(articleId)) {
        _viewedArticles.add(articleId);
        // Delay 1 second to avoid accidental scroll-by
        setTimeout(() => {
            // Check if still visible after 1s
            const post = document.querySelector(`[data-article-id="${articleId}"]`);
            if (!post) return;
            const rect = post.getBoundingClientRect();
            const visible = rect.top < window.innerHeight && rect.bottom > 0;
            if (!visible) {
                _viewedArticles.delete(articleId); // wasn't a real view
                return;
            }
            recordImpression(articleId);
        }, 1000);
    }

    // Start reading timer
    if (!_readingTimers[articleId]) {
        _readingTimers[articleId] = { start: Date.now(), accumulated: 0, intervalId: null };
    } else {
        _readingTimers[articleId].start = Date.now();
    }

    // Send reading time every 10s while visible
    if (!_readingTimers[articleId].intervalId) {
        _readingTimers[articleId].intervalId = setInterval(() => {
            const t = _readingTimers[articleId];
            if (t && t.start) {
                t.accumulated += Math.round((Date.now() - t.start) / 1000);
                t.start = Date.now();
                sendReadingTime(articleId);
            }
        }, 10000);
    }
}

function onArticleHidden(articleId) {
    // Pause reading timer, clear interval, and send accumulated time
    const timer = _readingTimers[articleId];
    if (timer) {
        if (timer.start) {
            timer.accumulated += Math.round((Date.now() - timer.start) / 1000);
            timer.start = null;
        }
        if (timer.intervalId) {
            clearInterval(timer.intervalId);
            timer.intervalId = null;
        }
        sendReadingTime(articleId);
    }
}

async function recordImpression(articleId) {
    try {
        const res = await fetch(`${NEWS_API}/news/engagement/${articleId}/view`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ visitorId: getVisitorId() })
        });
        if (res.ok) {
            const data = await res.json();
            _viewIds[articleId] = data.viewId;
        }
    } catch {}
}

async function sendReadingTime(articleId) {
    const viewId = _viewIds[articleId];
    const timer = _readingTimers[articleId];
    if (!viewId || !timer || timer.accumulated < 1) return;

    try {
        await fetch(`${NEWS_API}/news/engagement/view/${viewId}/reading-time`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ readingTimeSeconds: timer.accumulated })
        });
    } catch {}
}

// Flush reading times on page unload
function flushReadingTimes() {
    Object.keys(_readingTimers).forEach(articleId => {
        const timer = _readingTimers[articleId];
        if (timer && timer.start) {
            timer.accumulated += Math.round((Date.now() - timer.start) / 1000);
            timer.start = null;
        }
        const viewId = _viewIds[articleId];
        if (viewId && timer && timer.accumulated > 0) {
            // Use sendBeacon for reliability on page unload
            const url = `${NEWS_API}/news/engagement/view/${viewId}/reading-time`;
            const body = JSON.stringify({ readingTimeSeconds: timer.accumulated });
            if (navigator.sendBeacon) {
                navigator.sendBeacon(url, new Blob([body], { type: 'application/json' }));
            }
        }
    });
}

document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushReadingTimes();
});
window.addEventListener('beforeunload', flushReadingTimes);

// Apply saved theme on load
applySavedTheme();
