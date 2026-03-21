/**
 * KIP Single Article Page
 * Standalone article view with engagement (like, comment, share, impressions, reading time)
 */

const NEWS_API = CONFIG.newsApiBaseUrl;
let _article = null;
let _viewId = null;
let _readingStart = null;
let _readingAccumulated = 0;
let _readingInterval = null;

// ── Visitor ID ──
function getVisitorId() {
    let id = localStorage.getItem('kip_visitor_id');
    if (!id) { id = crypto.randomUUID(); localStorage.setItem('kip_visitor_id', id); }
    return id;
}

function getCommenterName() { return localStorage.getItem('kip_commenter_name') || ''; }
function setCommenterName(name) { localStorage.setItem('kip_commenter_name', name); }

function esc(s) {
    if (!s) return '';
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
}

function formatDate(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    const now = new Date();
    const diffMin = Math.floor((now - d) / 60000);
    if (diffMin < 1) return 'just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr}h ago`;
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

// ── Theme ──
function toggleArticleTheme() {
    const body = document.body;
    const btn = document.getElementById('themeToggle');
    if (body.classList.contains('nw-dark')) {
        body.classList.remove('nw-dark');
        body.classList.add('nw-light');
        if (btn) btn.textContent = 'Dark';
        localStorage.setItem('nw_theme', 'light');
    } else {
        body.classList.remove('nw-light');
        body.classList.add('nw-dark');
        if (btn) btn.textContent = 'Light';
        localStorage.setItem('nw_theme', 'dark');
    }
}

function applySavedTheme() {
    const saved = localStorage.getItem('nw_theme');
    if (saved === 'light') {
        document.body.classList.remove('nw-dark');
        document.body.classList.add('nw-light');
        const btn = document.getElementById('themeToggle');
        if (btn) btn.textContent = 'Dark';
    }
}

// ── Load Article ──
document.addEventListener('DOMContentLoaded', async () => {
    applySavedTheme();

    const params = new URLSearchParams(window.location.search);
    const slug = params.get('slug');
    const id = params.get('id');

    if (!slug && !id) { showError(); return; }

    try {
        const url = slug
            ? `${NEWS_API}/news/guest-articles/slug/${encodeURIComponent(slug)}`
            : `${NEWS_API}/news/guest-articles/${id}`;

        const res = await fetch(url);
        if (!res.ok) { showError(); return; }

        _article = await res.json();
        renderArticle(_article);
        recordView(_article.id);
        loadStats(_article.id);
        loadComments(_article.id);
        startReadingTimer();
    } catch (e) {
        console.error('[KIP Article]', e);
        showError();
    }
});

function showError() {
    document.getElementById('loadingState').style.display = 'none';
    document.getElementById('errorState').style.display = 'flex';
}

function renderArticle(a) {
    document.getElementById('loadingState').style.display = 'none';
    document.getElementById('articleContainer').style.display = 'block';

    // Update page title and OG tags
    document.title = `${a.title} — ${a.author?.name || 'KIP'}`;
    const ogTitle = document.getElementById('og-title');
    const ogDesc = document.getElementById('og-desc');
    if (ogTitle) ogTitle.content = a.title;
    if (ogDesc) ogDesc.content = a.excerpt || 'Read on KIP';

    // Author header
    const author = a.author;
    const avatar = author?.photoUrl
        ? `<img class="nw-post-avatar" src="${esc(author.photoUrl)}" alt="${esc(author.name)}">`
        : `<div class="nw-post-avatar-initials">${esc((author?.name || '?').split(' ').map(n=>n[0]).join('').substring(0,2).toUpperCase())}</div>`;
    const role = author ? [author.designation, author.company].filter(Boolean).join(' · ') : '';

    document.getElementById('articleAuthor').innerHTML = `
        ${avatar}
        <div class="nw-post-author-info">
            <div class="nw-post-author-name">${esc(author?.name || 'Unknown')}</div>
            <div class="nw-post-author-role">${esc(role)}</div>
            <div class="nw-post-meta"><span>${formatDate(a.publishedAt || a.createdAt)}</span></div>
        </div>`;

    // Category
    document.getElementById('articleCategory').innerHTML = a.category
        ? `<span class="nw-post-category">${esc(a.category)}</span>`
        : '';

    // Title
    document.getElementById('articleTitle').textContent = a.title;

    // Excerpt
    const excerptEl = document.getElementById('articleExcerpt');
    if (a.excerpt) { excerptEl.textContent = a.excerpt; excerptEl.style.display = ''; }
    else { excerptEl.style.display = 'none'; }

    // Content with author photo
    const photoHtml = author?.photoUrl
        ? `<img class="nw-post-author-photo" src="${esc(author.photoUrl)}" alt="${esc(author.name)}">`
        : '';
    document.getElementById('articleContent').innerHTML = photoHtml + (a.content || '');

    // Comment identity
    updateCommentIdentity();
}

function updateCommentIdentity() {
    const name = getCommenterName();
    const el = document.getElementById('commentIdentity');
    if (name) {
        el.innerHTML = `<div class="nw-post-comment-identity">Commenting as <strong class="nw-commenter-display-name">${esc(name)}</strong> <button class="nw-post-comment-change" onclick="changeName()">change</button></div>`;
    } else {
        el.innerHTML = '';
    }
}

// ── Engagement: View / Impression ──
async function recordView(articleId) {
    try {
        const res = await fetch(`${NEWS_API}/news/engagement/${articleId}/view`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ visitorId: getVisitorId() })
        });
        if (res.ok) {
            const data = await res.json();
            _viewId = data.viewId;
        }
    } catch {}
}

// ── Reading Time ──
function startReadingTimer() {
    _readingStart = Date.now();
    _readingInterval = setInterval(() => {
        if (_readingStart) {
            _readingAccumulated += Math.round((Date.now() - _readingStart) / 1000);
            _readingStart = Date.now();
            sendReadingTime();
        }
    }, 10000);
}

async function sendReadingTime() {
    if (!_viewId || _readingAccumulated < 1) return;
    try {
        await fetch(`${NEWS_API}/news/engagement/view/${_viewId}/reading-time`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ readingTimeSeconds: _readingAccumulated })
        });
    } catch {}
}

function flushReadingTime() {
    if (_readingStart) {
        _readingAccumulated += Math.round((Date.now() - _readingStart) / 1000);
        _readingStart = null;
    }
    if (_readingInterval) { clearInterval(_readingInterval); _readingInterval = null; }
    if (_viewId && _readingAccumulated > 0) {
        const url = `${NEWS_API}/news/engagement/view/${_viewId}/reading-time`;
        const body = JSON.stringify({ readingTimeSeconds: _readingAccumulated });
        if (navigator.sendBeacon) {
            navigator.sendBeacon(url, new Blob([body], { type: 'application/json' }));
        }
    }
}

document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushReadingTime(); });
window.addEventListener('beforeunload', flushReadingTime);

// ── Engagement: Stats ──
async function loadStats(articleId) {
    try {
        const res = await fetch(`${NEWS_API}/news/engagement/${articleId}/stats?visitorId=${getVisitorId()}`);
        if (!res.ok) return;
        const s = await res.json();

        const parts = [];
        if (s.viewCount > 0) parts.push(`${s.viewCount} view${s.viewCount > 1 ? 's' : ''}`);
        if (s.likeCount > 0) parts.push(`${s.likeCount} like${s.likeCount > 1 ? 's' : ''}`);
        if (s.commentCount > 0) parts.push(`${s.commentCount} comment${s.commentCount > 1 ? 's' : ''}`);
        if (s.shareCount > 0) parts.push(`${s.shareCount} share${s.shareCount > 1 ? 's' : ''}`);
        document.getElementById('articleStats').textContent = parts.join('  ·  ');

        const likeBtn = document.getElementById('articleLikeBtn');
        if (likeBtn && s.isLikedByVisitor) likeBtn.classList.add('liked');
        document.getElementById('articleLikeCount').textContent = s.likeCount > 0 ? `Like (${s.likeCount})` : 'Like';
        document.getElementById('articleCommentCount').textContent = s.commentCount > 0 ? `Comment (${s.commentCount})` : 'Comment';
    } catch {}
}

// ── Engagement: Like ──
async function likeArticle() {
    if (!_article) return;
    try {
        const res = await fetch(`${NEWS_API}/news/engagement/${_article.id}/like`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ visitorId: getVisitorId() })
        });
        if (!res.ok) return;
        const data = await res.json();
        const btn = document.getElementById('articleLikeBtn');
        if (btn) btn.classList.toggle('liked', data.liked);
        document.getElementById('articleLikeCount').textContent = data.likeCount > 0 ? `Like (${data.likeCount})` : 'Like';
        loadStats(_article.id);
    } catch {}
}

// ── Engagement: Share ──
async function shareArticle() {
    if (!_article) return;
    const url = `${window.location.origin}/pages/kip-article.html?id=${_article.id}`;
    if (navigator.share) {
        try {
            await navigator.share({ title: _article.title, url });
            fetch(`${NEWS_API}/news/engagement/${_article.id}/share`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ platform: 'copy_link' })
            });
        } catch {}
    } else {
        await navigator.clipboard.writeText(url).catch(() => {});
        fetch(`${NEWS_API}/news/engagement/${_article.id}/share`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ platform: 'copy_link' })
        });
        // Visual feedback
        const btns = document.querySelectorAll('.nw-post-action-btn');
        const shareBtn = btns[btns.length - 1];
        if (shareBtn) { shareBtn.style.color = 'var(--nw-brand)'; setTimeout(() => shareBtn.style.color = '', 1500); }
    }
    loadStats(_article.id);
}

// ── Engagement: Comments ──
function scrollToComments() {
    document.getElementById('articleComments').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function loadComments(articleId) {
    const list = document.getElementById('commentList');
    try {
        const res = await fetch(`${NEWS_API}/news/engagement/${articleId}/comments?limit=50`);
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

async function changeName() {
    const name = await Prompt.show({
        title: 'What should we call you?',
        message: 'Enter your name to comment on articles',
        defaultValue: getCommenterName(),
        placeholder: 'Your name',
        confirmText: 'Continue'
    });
    if (name && name.trim()) {
        setCommenterName(name.trim());
        updateCommentIdentity();
    }
}

async function postComment() {
    if (!_article) return;
    const input = document.getElementById('commentInput');
    if (!input || !input.value.trim()) return;

    let name = getCommenterName();
    if (!name) {
        name = await Prompt.show({
            title: 'What should we call you?',
            message: 'Enter your name to comment on articles',
            placeholder: 'Your name',
            confirmText: 'Continue'
        });
        if (!name || !name.trim()) return;
        setCommenterName(name.trim());
        name = name.trim();
        updateCommentIdentity();
    }

    try {
        const res = await fetch(`${NEWS_API}/news/engagement/${_article.id}/comment`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, content: input.value.trim() })
        });
        if (res.ok) {
            input.value = '';
            loadComments(_article.id);
            loadStats(_article.id);
        }
    } catch {}
}

applySavedTheme();
