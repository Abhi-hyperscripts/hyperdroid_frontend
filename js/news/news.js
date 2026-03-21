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

// Apply saved theme on load
applySavedTheme();
