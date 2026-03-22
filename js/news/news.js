// ============================================
// Ragenaizer NewsWire — Public Digital Media Page
// Auto-refresh every 5 min, category/country/signal filters
// ============================================

const NEWS_API = CONFIG.newsApiBaseUrl;
const PAGE_SIZE = 20;
let currentCategory = '';
let currentCountry = '';
let currentSignal = '';
let currentImpact = '';
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
        const impf = document.getElementById('impactFilter');
        const impfm = document.getElementById('impactFilterMobile');
        if (impf && impfm) impfm.value = impf.value;
    }
}

function syncFilter(type, value) {
    if (type === 'country') {
        document.getElementById('countryFilter').value = value;
        currentCountry = value;
    } else if (type === 'signal') {
        document.getElementById('signalFilter').value = value;
        currentSignal = value;
    } else if (type === 'impact') {
        document.getElementById('impactFilter').value = value;
        currentImpact = value;
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

    // Client-side impact filter (applied after server-side filters)
    let filtered = articles;
    if (currentImpact) {
        filtered = articles.filter(a => a.impactLevel === currentImpact);
    }

    // Sort: signal articles first (high > medium > low), non-signal last
    const impactOrder = { high: 0, medium: 1, low: 2, '': 3 };
    filtered = [...filtered].sort((a, b) => {
        const aHas = a.signalType ? 0 : 1;
        const bHas = b.signalType ? 0 : 1;
        if (aHas !== bHas) return aHas - bHas;
        if (aHas === 0) return (impactOrder[a.impactLevel || ''] || 3) - (impactOrder[b.impactLevel || ''] || 3);
        return 0; // preserve original order for non-signal
    });

    if (!filtered.length) {
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
    const featured = filtered.slice(0, 2);
    if (featured.length) {
        html += '<div class="nw-featured-row">';
        featured.forEach(a => {
            html += renderFeaturedCard(a);
        });
        html += '</div>';
    }

    // Standard cards (rest)
    const standard = filtered.slice(2);
    if (standard.length) {
        html += '<div class="nw-cards-grid">';
        standard.forEach(a => {
            html += renderStandardCard(a);
        });
        html += '</div>';
    }

    grid.innerHTML = html;
}

function renderSignalBadge(a) {
    if (!a.signalType) return '';
    const impact = a.impactLevel || '';
    const impactClass = impact ? ` nw-impact-${impact}` : '';
    const impactDot = impact ? `<span class="nw-impact-dot nw-impact-${impact}"></span>` : '';
    const freshness = renderFreshness(a.createdAt);
    const oppScore = impact === 'high' ? '9' : impact === 'medium' ? '6' : impact === 'low' ? '3' : '';
    return `<div class="nw-signal-header">
        <div class="nw-signal-badge${impactClass}">
            ${impactDot}
            <span class="nw-signal-label">${esc(a.signalType.replace(/_/g, ' '))} signal</span>
        </div>
        <div class="nw-signal-meta">
            ${oppScore ? `<div class="nw-opp-tag nw-impact-${impact}">Score: ${oppScore}/10 \u00B7 ${oppScore >= 7 ? 'High Priority' : oppScore >= 4 ? 'Medium Priority' : 'Low Priority'}</div>` : ''}
            ${freshness ? `<div class="nw-fresh-line">${freshness}</div>` : ''}
        </div>
    </div>`;
}

function renderFreshness(dateStr) {
    if (!dateStr) return '';
    const diffMin = Math.floor((Date.now() - new Date(dateStr).getTime()) / 60000);
    if (diffMin < 60) return `<span class="nw-fresh">\u{1F525} Fresh Signal \u00B7 ${diffMin}m ago</span>`;
    if (diffMin < 1440) return `<span class="nw-fresh nw-fresh-dim">\u{1F525} Fresh Signal \u00B7 ${Math.floor(diffMin / 60)}h ago</span>`;
    return '';
}

function renderImplication(a) {
    const line = a.signalImplication || a.signalOpportunity;
    if (!line) return '';
    return `<p class="nw-implication"><span class="nw-impl-arrow">&rarr;</span> ${esc(line)}</p>`;
}

function renderTarget(a) {
    const target = a.signalTarget;
    if (!target) return '';
    return `<p class="nw-target"><span class="nw-target-label">\u{1F3AF} Best for:</span> ${esc(target)}</p>`;
}

function renderGatedCTA(a) {
    if (!a.signalType) return '';
    return `<div class="nw-gated-cta">
        <a class="nw-pipeline-btn" href="/pages/crm.html?signal=${encodeURIComponent(a.signalType)}&company=${encodeURIComponent(a.signalCompany || '')}" onclick="event.stopPropagation();" target="_blank">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
            Capture Opportunity
        </a>
        <span class="nw-cta-hint">\u2192 Create lead + track in CRM</span>
    </div>`;
}

function showPipelineGate() {
    const existing = document.getElementById('pipelineGate');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'pipelineGate';
    modal.className = 'nw-gate-modal';
    modal.innerHTML = `
        <div class="nw-gate-overlay" onclick="closePipelineGate()"></div>
        <div class="nw-gate-body">
            <div class="nw-gate-header">
                <span class="nw-gate-title">Unlock Signal Pipeline</span>
                <button class="nw-gate-close" onclick="closePipelineGate()">&times;</button>
            </div>
            <p class="nw-gate-desc">Convert signals into actionable leads. Track companies, set alerts, and build your opportunity pipeline.</p>
            <div class="nw-gate-features">
                <div class="nw-gate-feat">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--nw-signal-text)" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
                    <span>Save signals to your pipeline</span>
                </div>
                <div class="nw-gate-feat">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--nw-signal-text)" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
                    <span>Get real-time alerts for new opportunities</span>
                </div>
                <div class="nw-gate-feat">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--nw-signal-text)" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
                    <span>Export leads to your CRM</span>
                </div>
            </div>
            <input class="nw-gate-input" id="gateEmail" type="email" placeholder="your@email.com" value="${esc(localStorage.getItem('kip_alert_email') || '')}" onkeydown="if(event.key==='Enter')submitPipelineGate()">
            <button class="nw-gate-submit" onclick="submitPipelineGate()">Get Early Access</button>
            <p class="nw-gate-note">Free during beta. No credit card required.</p>
        </div>
    `;
    document.body.appendChild(modal);
    requestAnimationFrame(() => modal.classList.add('open'));
    setTimeout(() => document.getElementById('gateEmail')?.focus(), 200);
}

function closePipelineGate() {
    const m = document.getElementById('pipelineGate');
    if (m) { m.classList.remove('open'); setTimeout(() => m.remove(), 200); }
}

function submitPipelineGate() {
    const emailEl = document.getElementById('gateEmail');
    const email = emailEl?.value?.trim();
    if (!email || !email.includes('@')) {
        emailEl?.classList.add('nw-am-error');
        setTimeout(() => emailEl?.classList.remove('nw-am-error'), 1000);
        return;
    }
    localStorage.setItem('kip_alert_email', email);
    const waitlist = JSON.parse(localStorage.getItem('kip_waitlist') || '[]');
    if (!waitlist.includes(email)) { waitlist.push(email); localStorage.setItem('kip_waitlist', JSON.stringify(waitlist)); }
    closePipelineGate();
    if (typeof showToast === 'function') showToast('You\'re on the list. We\'ll notify you when Pipeline launches.', 'success');
}

function renderActionBtn(a) {
    if (!a.signalType) return '';
    const saved = isSignalSaved(a.id);
    const savedClass = saved ? ' nw-saved' : '';
    const savedLabel = saved ? 'Saved' : 'Save';
    return `<div class="nw-action-row">
        <button class="nw-action-btn nw-act-save${savedClass}" id="save-btn-${a.id}" onclick="event.stopPropagation(); toggleSaveSignal('${a.id}')">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="${saved ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
            ${savedLabel}
        </button>
        <button class="nw-action-btn nw-act-share" onclick="event.stopPropagation(); shareSignal('${a.id}')">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
            Share
        </button>
    </div>`;
}

function renderFeaturedCard(a) {
    const img = a.imageUrl
        ? `<img class="nw-featured-img" src="${esc(a.imageUrl)}" alt="" onerror="this.style.display='none'">`
        : '';
    const source = a.sourceName || extractDomain(a.sourceUrl);
    const date = formatDate(a.createdAt);

    const summary = a.aiSummary
        ? `<p class="nw-card-summary nw-clamped" id="sum-${a.id}">${esc(a.aiSummary)}</p><button class="nw-expand-btn" onclick="event.stopPropagation(); toggleSummary('${a.id}')">more</button>`
        : '';
    return `
    <article class="nw-featured-card" onclick="window.open('${esc(a.sourceUrl)}','_blank')">
        ${img}
        <div class="nw-featured-body">
            ${renderSignalBadge(a)}
            <h2 class="nw-featured-headline">${esc(a.headline)}</h2>
            ${renderImplication(a)}
            ${renderTarget(a)}
            ${renderGatedCTA(a)}
            ${summary}
            <div class="nw-card-foot">
                ${renderActionBtn(a)}
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

    const summary = a.aiSummary
        ? `<p class="nw-card-summary nw-clamped" id="sum-${a.id}">${esc(a.aiSummary)}</p><button class="nw-expand-btn" onclick="event.stopPropagation(); toggleSummary('${a.id}')">more</button>`
        : '';
    return `
    <article class="nw-card" onclick="window.open('${esc(a.sourceUrl)}','_blank')">
        ${img}
        <div class="nw-card-body">
            ${renderSignalBadge(a)}
            <h3 class="nw-card-headline">${esc(a.headline)}</h3>
            ${renderImplication(a)}
            ${renderTarget(a)}
            ${renderGatedCTA(a)}
            ${summary}
            <div class="nw-card-foot">
                ${renderActionBtn(a)}
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

function filterImpact() {
    currentImpact = document.getElementById('impactFilter').value;
    loadNews();
}

function clearFilters() {
    currentCategory = '';
    currentCountry = '';
    currentSignal = '';
    currentImpact = '';
    document.getElementById('countryFilter').value = '';
    document.getElementById('signalFilter').value = '';
    const impactEl = document.getElementById('impactFilter');
    if (impactEl) impactEl.value = '';
    const cfm = document.getElementById('countryFilterMobile');
    const sfm = document.getElementById('signalFilterMobile');
    const ifm = document.getElementById('impactFilterMobile');
    if (cfm) cfm.value = '';
    if (sfm) sfm.value = '';
    if (ifm) ifm.value = '';
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

function toggleSummary(id) {
    const el = document.getElementById(`sum-${id}`);
    const btn = el?.nextElementSibling;
    if (!el) return;
    const isClamped = el.classList.contains('nw-clamped');
    el.classList.toggle('nw-clamped');
    if (btn) btn.textContent = isClamped ? 'less' : 'more';
}

// ═══════════════════════════════════════════════════════════════════
//  SAVE SIGNAL (localStorage)
// ═══════════════════════════════════════════════════════════════════
function getSavedSignals() {
    try { return JSON.parse(localStorage.getItem('kip_saved_signals') || '[]'); }
    catch { return []; }
}

function isSignalSaved(id) {
    return getSavedSignals().some(s => s.id === id);
}

function toggleSaveSignal(id) {
    const saved = getSavedSignals();
    const idx = saved.findIndex(s => s.id === id);
    const article = allArticles.find(a => a.id === id);
    if (!article) return;

    if (idx >= 0) {
        saved.splice(idx, 1);
        localStorage.setItem('kip_saved_signals', JSON.stringify(saved));
        updateSaveBtn(id, false);
        updateSavedCount();
        if (typeof showToast === 'function') showToast('Signal removed', 'info');
    } else {
        saved.unshift({
            id: article.id,
            headline: article.headline,
            signalType: article.signalType,
            signalCompany: article.signalCompany || '',
            signalImplication: article.signalImplication || article.signalOpportunity || '',
            impactLevel: article.impactLevel || '',
            sourceUrl: article.sourceUrl,
            category: article.category,
            savedAt: new Date().toISOString()
        });
        localStorage.setItem('kip_saved_signals', JSON.stringify(saved));
        updateSaveBtn(id, true);
        updateSavedCount();
        if (typeof showToast === 'function') showToast('Signal saved', 'success');
    }
}

function updateSaveBtn(id, saved) {
    const btn = document.getElementById(`save-btn-${id}`);
    if (!btn) return;
    btn.classList.toggle('nw-saved', saved);
    const svg = btn.querySelector('svg');
    if (svg) svg.setAttribute('fill', saved ? 'currentColor' : 'none');
    btn.childNodes.forEach(n => { if (n.nodeType === 3) n.textContent = saved ? '\n            Saved' : '\n            Save'; });
}

function updateSavedCount() {
    const count = getSavedSignals().length;
    let badge = document.getElementById('savedCountBadge');
    if (count > 0) {
        if (!badge) {
            const header = document.querySelector('.nw-header-right');
            if (header) {
                const btn = document.createElement('button');
                btn.className = 'nw-saved-btn';
                btn.id = 'savedSignalsBtn';
                btn.onclick = toggleSavedPanel;
                btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg> <span id="savedCountBadge">${count}</span>`;
                header.insertBefore(btn, header.firstChild);
            }
        } else {
            badge.textContent = count;
        }
    } else if (badge) {
        const btn = document.getElementById('savedSignalsBtn');
        if (btn) btn.remove();
        closeSavedPanel();
    }
}

// ═══════════════════════════════════════════════════════════════════
//  SAVED SIGNALS PANEL (slide-out)
// ═══════════════════════════════════════════════════════════════════
function toggleSavedPanel() {
    const existing = document.getElementById('savedPanel');
    if (existing) { closeSavedPanel(); return; }

    const saved = getSavedSignals();
    const panel = document.createElement('div');
    panel.id = 'savedPanel';
    panel.className = 'nw-saved-panel';

    let listHtml = '';
    if (saved.length === 0) {
        listHtml = '<div class="nw-sp-empty">No saved signals yet</div>';
    } else {
        listHtml = saved.map(s => {
            const label = (s.signalType || '').replace(/_/g, ' ');
            const impact = s.impactLevel ? `<span class="nw-sp-impact nw-impact-${s.impactLevel}">${s.impactLevel}</span>` : '';
            return `<div class="nw-sp-item">
                <div class="nw-sp-item-top">
                    <span class="nw-sp-signal">${esc(label)} ${impact}</span>
                    <button class="nw-sp-remove" onclick="removeSavedSignal('${s.id}')" title="Remove">&times;</button>
                </div>
                <a class="nw-sp-headline" href="${esc(s.sourceUrl)}" target="_blank" onclick="event.stopPropagation()">${esc(s.headline)}</a>
                ${s.signalImplication ? `<p class="nw-sp-impl">${esc(s.signalImplication)}</p>` : ''}
                ${s.signalCompany ? `<span class="nw-sp-company">${esc(s.signalCompany)}</span>` : ''}
            </div>`;
        }).join('');
    }

    panel.innerHTML = `
        <div class="nw-sp-overlay" onclick="closeSavedPanel()"></div>
        <div class="nw-sp-body">
            <div class="nw-sp-header">
                <span class="nw-sp-title">Saved Signals (${saved.length})</span>
                <div class="nw-sp-header-actions">
                    ${saved.length > 0 ? '<button class="nw-sp-export" onclick="exportSavedSignals()">Export</button>' : ''}
                    <button class="nw-sp-close" onclick="closeSavedPanel()">&times;</button>
                </div>
            </div>
            <div class="nw-sp-list">${listHtml}</div>
        </div>
    `;
    document.body.appendChild(panel);
    requestAnimationFrame(() => panel.classList.add('open'));
}

function closeSavedPanel() {
    const panel = document.getElementById('savedPanel');
    if (panel) { panel.classList.remove('open'); setTimeout(() => panel.remove(), 250); }
}

function removeSavedSignal(id) {
    const saved = getSavedSignals().filter(s => s.id !== id);
    localStorage.setItem('kip_saved_signals', JSON.stringify(saved));
    updateSaveBtn(id, false);
    updateSavedCount();
    // Re-render panel
    closeSavedPanel();
    setTimeout(() => { if (getSavedSignals().length > 0 || document.getElementById('savedSignalsBtn')) toggleSavedPanel(); }, 260);
}

function exportSavedSignals() {
    const saved = getSavedSignals();
    if (!saved.length) return;
    const lines = ['Signal Type,Impact,Company,Headline,Implication,Source URL,Saved At'];
    saved.forEach(s => {
        lines.push([
            s.signalType, s.impactLevel, `"${(s.signalCompany||'').replace(/"/g,'""')}"`,
            `"${(s.headline||'').replace(/"/g,'""')}"`,
            `"${(s.signalImplication||'').replace(/"/g,'""')}"`,
            s.sourceUrl, s.savedAt
        ].join(','));
    });
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `kip-signals-${new Date().toISOString().slice(0,10)}.csv`;
    a.click(); URL.revokeObjectURL(url);
    if (typeof showToast === 'function') showToast(`Exported ${saved.length} signals`, 'success');
}

// ═══════════════════════════════════════════════════════════════════
//  SHARE SIGNAL (clipboard / native share)
// ═══════════════════════════════════════════════════════════════════
function shareSignal(id) {
    const a = allArticles.find(x => x.id === id);
    if (!a) return;
    const label = (a.signalType || '').replace(/_/g, ' ').toUpperCase();
    const impl = a.signalImplication || a.signalOpportunity || '';
    const impact = a.impactLevel ? ` [${a.impactLevel.toUpperCase()}]` : '';
    const text = `${label} SIGNAL${impact}${a.signalCompany ? ' — ' + a.signalCompany : ''}\n${a.headline}\n${impl ? '→ ' + impl + '\n' : ''}${a.sourceUrl}`;

    if (navigator.share) {
        navigator.share({ title: a.headline, text, url: a.sourceUrl }).catch(() => {});
    } else {
        navigator.clipboard.writeText(text).then(() => {
            if (typeof showToast === 'function') showToast('Signal copied to clipboard', 'success');
        }).catch(() => {
            if (typeof showToast === 'function') showToast('Failed to copy', 'error');
        });
    }
}

// ═══════════════════════════════════════════════════════════════════
//  ALERT MODAL (email capture + localStorage)
// ═══════════════════════════════════════════════════════════════════
function showAlertModal(id) {
    const a = allArticles.find(x => x.id === id);
    if (!a) return;
    const label = (a.signalType || '').replace(/_/g, ' ');
    const savedEmail = localStorage.getItem('kip_alert_email') || '';

    const existing = document.getElementById('alertModal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'alertModal';
    modal.className = 'nw-alert-modal';
    modal.innerHTML = `
        <div class="nw-am-overlay" onclick="closeAlertModal()"></div>
        <div class="nw-am-body">
            <div class="nw-am-header">
                <span>Get alerts for <strong>${esc(label)}</strong> signals</span>
                <button class="nw-am-close" onclick="closeAlertModal()">&times;</button>
            </div>
            <p class="nw-am-desc">We'll notify you when new ${esc(label)} signals are detected${a.category ? ' in ' + esc(a.category) : ''}.</p>
            <input class="nw-am-input" id="alertEmail" type="email" placeholder="your@email.com" value="${esc(savedEmail)}" onkeydown="if(event.key==='Enter')submitAlert('${id}')">
            <button class="nw-am-submit" onclick="submitAlert('${id}')">Set Alert</button>
            <p class="nw-am-note">No spam. Unsubscribe anytime.</p>
        </div>
    `;
    document.body.appendChild(modal);
    requestAnimationFrame(() => modal.classList.add('open'));
    setTimeout(() => document.getElementById('alertEmail')?.focus(), 200);
}

function closeAlertModal() {
    const m = document.getElementById('alertModal');
    if (m) { m.classList.remove('open'); setTimeout(() => m.remove(), 200); }
}

function submitAlert(id) {
    const emailEl = document.getElementById('alertEmail');
    const email = emailEl?.value?.trim();
    if (!email || !email.includes('@')) {
        emailEl?.classList.add('nw-am-error');
        setTimeout(() => emailEl?.classList.remove('nw-am-error'), 1000);
        return;
    }

    const a = allArticles.find(x => x.id === id);
    const signalType = a?.signalType || '';
    const category = a?.category || '';

    // Save email for future use
    localStorage.setItem('kip_alert_email', email);

    // Save alert preference
    const alerts = JSON.parse(localStorage.getItem('kip_alerts') || '[]');
    const exists = alerts.find(al => al.signalType === signalType && al.category === category);
    if (!exists) {
        alerts.push({ signalType, category, email, createdAt: new Date().toISOString() });
        localStorage.setItem('kip_alerts', JSON.stringify(alerts));
    }

    closeAlertModal();
    if (typeof showToast === 'function') showToast(`Alert set for ${signalType.replace(/_/g, ' ')} signals`, 'success');
}

// Init saved count on load
document.addEventListener('DOMContentLoaded', () => updateSavedCount());

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
