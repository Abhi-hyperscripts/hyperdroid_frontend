/* HRMS Recruitment — Job postings + per-posting applications.
   Architecture: postings list view → click into a posting detail view
   that shows the posting metadata and its applications. Applications are
   sub-nodes of a posting, never browsed independently. */

(function () {
    'use strict';

    // ─── State ─────────────────────────────────────────────────────────────
    let postings = [];                  // current page of postings
    let editingPostingId = null;
    let activeFieldCard = null;
    let activeApplicationId = null;
    let activeApplication = null;

    // Detail view state
    let activePostingId = null;
    let activePosting = null;
    let activePostingApps = [];

    // Listing state (table view)
    let currentStatusFilter = '';       // '', 'open', 'paused', 'closed', 'archived'
    let currentSearchQ = '';
    let currentEmploymentFilter = '';
    let currentSortField = 'created_at';
    let currentSortOrder = 'desc';
    let currentPage = 1;
    let currentPageSize = 25;
    let lastPageMeta = { total: 0, total_pages: 0, status_counts: { all: 0, open: 0, paused: 0, closed: 0, archived: 0 } };
    let selectedIds = new Set();

    // Aggregate stats (sum across ALL postings, regardless of filters)
    let aggregateStats = { open: 0, totalApps: 0, newApps: 0 };

    // Reload trigger from search input — debounced.
    let _reloadTimer = null;
    function scheduleReload() {
        clearTimeout(_reloadTimer);
        _reloadTimer = setTimeout(() => loadPostings(), 200);
    }

    // SearchableDropdown instances
    const dd = {
        postingEmploymentType: null,
        postingStatus: null,
        postingTheme: null,
        fsType: null,
        detailAppStatusFilter: null,
        appDrawerStatusSelect: null,
        filterEmploymentType: null,
        filterSort: null,
        pageSizeSelect: null
    };

    // Quill editor instance for job description (lazy-init on first modal open)
    let quillDescription = null;
    const QUILL_TOOLBAR = [
        [{ header: [1, 2, 3, false] }],
        ['bold', 'italic', 'underline', 'strike'],
        [{ list: 'ordered' }, { list: 'bullet' }],
        ['blockquote', 'code-block'],
        ['link'],
        ['clean']
    ];

    const FIELD_TYPES_WITH_OPTIONS = new Set(['select', 'multiselect', 'radio']);
    const FIELD_TYPES_WITH_LENGTH = new Set(['text', 'textarea', 'url']);
    const FIELD_TYPES_WITH_RANGE  = new Set(['number', 'age']);
    const FIELD_TYPES_WITH_DATE_RANGE = new Set(['date', 'date_of_birth']);

    // ─── Init ──────────────────────────────────────────────────────────────
    document.addEventListener('DOMContentLoaded', async () => {
        if (typeof Navigation !== 'undefined' && Navigation.init) Navigation.init();
        setupSidebar();
        wireSearchInputs();
        initSearchableDropdowns();
        await loadPostings();
    });

    // Global SignalR handler invoked by hrms-signalr.js when an application
    // arrives for a posting that has notify_on_application = true. Refresh the
    // list so the new-app count badge updates without HR hitting reload, and
    // refresh the detail-view application table if it's currently visible.
    window.onRecruitmentApplicationReceived = function (data) {
        try { loadPostings(); } catch { /* ignore */ }
        const postingId = data?.posting_id || data?.PostingId;
        if (postingId && activePostingId && postingId === activePostingId && typeof loadDetailApps === 'function') {
            try { loadDetailApps(); } catch { /* ignore */ }
        }
    };

    function wireSearchInputs() {
        document.getElementById('postingSearch')?.addEventListener('input', e => {
            currentSearchQ = e.target.value.trim();
            currentPage = 1;
            scheduleReload();
        });
        // Status tab click handler
        document.querySelectorAll('.rec-status-tab').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.rec-status-tab').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                currentStatusFilter = btn.dataset.status || '';
                currentPage = 1;
                clearBulkSelection();
                loadPostings();
            });
        });
        // Sortable column headers
        document.querySelectorAll('.rec-table-postings thead th[data-sort]').forEach(th => {
            th.addEventListener('click', () => {
                const field = th.dataset.sort;
                if (currentSortField === field) {
                    currentSortOrder = currentSortOrder === 'asc' ? 'desc' : 'asc';
                } else {
                    currentSortField = field;
                    currentSortOrder = field === 'title' || field === 'location' ? 'asc' : 'desc';
                }
                currentPage = 1;
                loadPostings();
            });
        });
        // Close the kebab menu when clicking outside it
        document.addEventListener('click', e => {
            const menu = document.getElementById('recKebabMenu');
            if (!menu || menu.style.display === 'none') return;
            if (!menu.contains(e.target) && !e.target.closest('.rec-kebab-trigger')) hideKebabMenu();
        });
    }

    // ─── Sidebar (matches employees.html pattern) ──────────────────────────
    function setupSidebar() {
        const toggle = document.getElementById('sidebarToggle');
        const sidebar = document.getElementById('recruitmentSidebar');
        const container = document.querySelector('.hrms-container');
        const overlay = document.getElementById('sidebarOverlay');
        if (!toggle || !sidebar) return;

        // Open by default on desktop, closed on mobile
        if (window.innerWidth > 1024) {
            toggle.classList.add('active');
            sidebar.classList.add('open');
            container?.classList.add('sidebar-open');
        } else {
            toggle.classList.remove('active');
            sidebar.classList.remove('open');
            overlay?.classList.remove('active');
        }

        toggle.addEventListener('click', () => {
            toggle.classList.toggle('active');
            sidebar.classList.toggle('open');
            container?.classList.toggle('sidebar-open');
            if (window.innerWidth <= 1024) overlay?.classList.toggle('active');
        });

        overlay?.addEventListener('click', () => {
            toggle.classList.remove('active');
            sidebar.classList.remove('open');
            container?.classList.remove('sidebar-open');
            overlay?.classList.remove('active');
        });

        // Collapsible nav groups
        document.querySelectorAll('.nav-group-header').forEach(h =>
            h.addEventListener('click', () => h.closest('.nav-group').classList.toggle('collapsed')));

        // Sidebar tab buttons. There's only one ("postings") right now, but we
        // wire it the same way for consistency with other HRMS pages.
        document.querySelectorAll('.sidebar-btn[data-tab]').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.sidebar-btn[data-tab]').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
                document.getElementById(btn.dataset.tab)?.classList.add('active');
                const titleEl = document.getElementById('activeTabName');
                if (titleEl) titleEl.textContent = btn.querySelector('.nav-label')?.textContent || '';
                // Always return to list view on tab click
                closePostingDetail();
            });
        });

        // Escape closes sidebar on mobile
        document.addEventListener('keydown', e => {
            if (e.key === 'Escape' && sidebar.classList.contains('open') && window.innerWidth <= 1024) {
                toggle.classList.remove('active');
                sidebar.classList.remove('open');
                container?.classList.remove('sidebar-open');
                overlay?.classList.remove('active');
            }
        });
    }

    // ─── Searchable dropdowns ──────────────────────────────────────────────
    function initSearchableDropdowns() {
        // All native <select data-searchable="true"> get converted up-front.
        // Filter dropdowns trigger reloads; modal dropdowns just sync state.
        if (typeof convertSelectToSearchable !== 'function') {
            console.warn('SearchableDropdown not loaded — falling back to native selects');
            return;
        }

        dd.postingEmploymentType = convertSelectToSearchable('postingEmploymentType', {
            placeholder: 'Select employment type'
        });
        dd.postingStatus = convertSelectToSearchable('postingStatus', { placeholder: 'Open' });
        dd.postingTheme = convertSelectToSearchable('postingTheme', { placeholder: 'Dark' });
        dd.fsType = convertSelectToSearchable('fsType', {
            placeholder: 'Single-line text',
            onChange: () => syncOptionsVisibility()
        });
        dd.detailAppStatusFilter = convertSelectToSearchable('detailAppStatusFilter', {
            placeholder: 'All statuses',
            onChange: () => renderDetailApps()
        });
        dd.appDrawerStatusSelect = convertSelectToSearchable('appDrawerStatusSelect', {
            placeholder: 'Set status',
            onChange: changeApplicationStatus
        });

        // Filter dropdowns on the postings table
        dd.filterEmploymentType = convertSelectToSearchable('filterEmploymentType', {
            placeholder: 'All types',
            onChange: v => { currentEmploymentFilter = v || ''; currentPage = 1; loadPostings(); }
        });
        dd.filterSort = convertSelectToSearchable('filterSort', {
            placeholder: 'Sort',
            onChange: v => {
                const [field, order] = (v || 'created_at:desc').split(':');
                currentSortField = field || 'created_at';
                currentSortOrder = order || 'desc';
                currentPage = 1;
                loadPostings();
            }
        });
        dd.pageSizeSelect = convertSelectToSearchable('pageSizeSelect', {
            placeholder: '25 / page',
            onChange: v => { currentPageSize = parseInt(v, 10) || 25; currentPage = 1; loadPostings(); }
        });
        // Seed initial values
        dd.filterSort?.setValue('created_at:desc');
        dd.pageSizeSelect?.setValue('25');
    }

    // ─── Postings list (paginated table) ──────────────────────────────────
    async function loadPostings() {
        const loading = document.getElementById('postingsLoading');
        const empty = document.getElementById('postingsEmpty');
        const wrap = document.getElementById('postingsTableWrap');
        const pagination = document.getElementById('recPagination');
        loading.style.display = '';
        empty.style.display = 'none';
        wrap.style.display = 'none';
        pagination.style.display = 'none';

        const qs = new URLSearchParams({
            page: String(currentPage),
            pageSize: String(currentPageSize),
            sort: currentSortField,
            order: currentSortOrder
        });
        if (currentStatusFilter) qs.set('status', currentStatusFilter);
        if (currentSearchQ) qs.set('q', currentSearchQ);
        if (currentEmploymentFilter) qs.set('employmentType', currentEmploymentFilter);

        try {
            const result = await api.request('/hrms/job-postings?' + qs.toString());
            if (result && Array.isArray(result.items)) {
                postings = result.items;
                lastPageMeta = {
                    total: result.total,
                    total_pages: result.total_pages,
                    status_counts: result.status_counts || lastPageMeta.status_counts
                };
            } else if (Array.isArray(result)) {
                postings = result;
                lastPageMeta = {
                    total: result.length, total_pages: 1,
                    status_counts: { all: result.length, open: 0, paused: 0, closed: 0, archived: 0 }
                };
            }
            loading.style.display = 'none';
            renderPostingsTable();
            renderStatusTabs();
            renderPagination();
            updateSortIndicators();
            updateAggregateStats();
        } catch (err) {
            console.error('loadPostings failed', err);
            loading.textContent = 'Failed to load postings. ' + (err?.message || '');
            Toast?.error?.(err?.message || 'Failed to load postings');
        }
    }

    function renderPostingsTable() {
        const empty = document.getElementById('postingsEmpty');
        const wrap = document.getElementById('postingsTableWrap');
        const tbody = document.getElementById('postingsTbody');
        if (postings.length === 0) {
            empty.style.display = '';
            wrap.style.display = 'none';
            return;
        }
        empty.style.display = 'none';
        wrap.style.display = '';
        tbody.innerHTML = postings.map(p => renderRow(p)).join('');
        const selectAll = document.getElementById('selectAllCheckbox');
        const allSelected = postings.length > 0 && postings.every(p => selectedIds.has(p.id));
        if (selectAll) selectAll.checked = allSelected;
    }

    function renderRow(p) {
        const checked = selectedIds.has(p.id) ? 'checked' : '';
        const empType = formatEmploymentType(p.employment_type);
        const newPill = p.new_application_count > 0
            ? `<span class="new-pill">${p.new_application_count} new</span>` : '';
        const subtitle = (p.openings > 1 ? `${p.openings} openings` : '') ||
                         (countFields(p.form_fields) ? `${countFields(p.form_fields)} form fields` : '');
        return `
            <tr data-id="${escapeAttr(p.id)}" class="${selectedIds.has(p.id) ? 'selected' : ''}" onclick="openPostingDetail('${escapeAttr(p.id)}')">
                <td onclick="event.stopPropagation();">
                    <input type="checkbox" data-row-check="${escapeAttr(p.id)}" ${checked} onchange="toggleRowSelection('${escapeAttr(p.id)}', this.checked)">
                </td>
                <td>
                    <div class="rec-row-title">${escapeHtml(p.title || 'Untitled')}${subtitle ? `<small>${escapeHtml(subtitle)}</small>` : ''}</div>
                </td>
                <td><span class="rec-badge rec-badge-${escapeAttr(p.status || 'open')}">${escapeHtml(p.status || 'open')}</span></td>
                <td>${escapeHtml(p.location || '—')}</td>
                <td>${escapeHtml(empType || '—')}</td>
                <td class="rec-applicants-cell">${p.application_count || 0}${newPill}</td>
                <td style="white-space: nowrap; color: var(--text-secondary);">${formatDate(p.created_at)}</td>
                <td style="white-space: nowrap; color: var(--text-secondary);">${formatDate(p.updated_at)}</td>
                <td onclick="event.stopPropagation();">
                    <button class="rec-kebab-trigger" data-kebab="${escapeAttr(p.id)}" onclick="showKebabMenu(event, '${escapeAttr(p.id)}')" aria-label="Row actions">⋯</button>
                </td>
            </tr>
        `;
    }

    function renderStatusTabs() {
        const c = lastPageMeta.status_counts || {};
        document.querySelectorAll('.rec-tab-count').forEach(el => {
            const key = el.dataset.count;
            el.textContent = c[key] || 0;
        });
        document.querySelectorAll('.rec-status-tab').forEach(t => {
            t.classList.toggle('active', (t.dataset.status || '') === currentStatusFilter);
        });
    }

    function renderPagination() {
        const total = lastPageMeta.total || 0;
        const pages = lastPageMeta.total_pages || 0;
        const wrap = document.getElementById('recPagination');
        if (total === 0) { wrap.style.display = 'none'; return; }
        wrap.style.display = '';

        const from = (currentPage - 1) * currentPageSize + 1;
        const to = Math.min(currentPage * currentPageSize, total);
        document.getElementById('recPaginationInfo').textContent = `Showing ${from}–${to} of ${total}`;
        document.getElementById('prevPageBtn').disabled = currentPage <= 1;
        document.getElementById('nextPageBtn').disabled = currentPage >= pages;

        const pagesEl = document.getElementById('recPaginationPages');
        const nums = [];
        if (pages <= 7) {
            for (let i = 1; i <= pages; i++) nums.push(i);
        } else {
            nums.push(1);
            if (currentPage > 4) nums.push('…');
            const start = Math.max(2, currentPage - 1);
            const end = Math.min(pages - 1, currentPage + 1);
            for (let i = start; i <= end; i++) nums.push(i);
            if (currentPage < pages - 3) nums.push('…');
            nums.push(pages);
        }
        pagesEl.innerHTML = nums.map(n =>
            n === '…' ? `<span class="ellipsis">…</span>`
                      : `<button class="${n === currentPage ? 'active' : ''}" onclick="goToPage(${n})">${n}</button>`
        ).join('');
    }

    function updateSortIndicators() {
        document.querySelectorAll('.rec-table-postings thead th[data-sort]').forEach(th => {
            th.classList.remove('sort-asc', 'sort-desc');
            if (th.dataset.sort === currentSortField) {
                th.classList.add(currentSortOrder === 'asc' ? 'sort-asc' : 'sort-desc');
            }
        });
    }

    window.goToPage = function (n) {
        const max = lastPageMeta.total_pages || 1;
        currentPage = Math.max(1, Math.min(max, n));
        loadPostings();
    };

    function countFields(formFieldsJson) {
        if (!formFieldsJson) return 0;
        try {
            const arr = typeof formFieldsJson === 'string' ? JSON.parse(formFieldsJson) : formFieldsJson;
            return Array.isArray(arr) ? arr.length : 0;
        } catch { return 0; }
    }

    function updateAggregateStats() {
        const c = lastPageMeta.status_counts || {};
        document.getElementById('statOpenPostings').textContent = c.open || 0;
        // Page-scope sums for the stats. Backend already filters; for accurate
        // tenant-wide totals we'd need a separate aggregate endpoint — fine for
        // now since stats reflect the visible page when filters are active.
        const onPage = postings.reduce((acc, p) => ({
            apps: acc.apps + (p.application_count || 0),
            news: acc.news + (p.new_application_count || 0)
        }), { apps: 0, news: 0 });
        document.getElementById('statTotalApps').textContent = onPage.apps;
        document.getElementById('statNewApps').textContent = onPage.news;
    }

    // ─── Bulk selection ────────────────────────────────────────────────────
    window.toggleRowSelection = function (id, checked) {
        if (checked) selectedIds.add(id); else selectedIds.delete(id);
        const row = document.querySelector(`tr[data-id="${cssEscape(id)}"]`);
        if (row) row.classList.toggle('selected', checked);
        updateBulkbar();
    };

    window.toggleSelectAll = function (checked) {
        postings.forEach(p => { if (checked) selectedIds.add(p.id); else selectedIds.delete(p.id); });
        document.querySelectorAll('input[data-row-check]').forEach(cb => cb.checked = checked);
        document.querySelectorAll('.rec-table-postings tbody tr').forEach(tr => tr.classList.toggle('selected', checked));
        updateBulkbar();
    };

    function updateBulkbar() {
        const bar = document.getElementById('recBulkbar');
        const count = selectedIds.size;
        bar.style.display = count > 0 ? '' : 'none';
        document.getElementById('recBulkCount').textContent = count;
    }

    window.clearBulkSelection = function () {
        selectedIds.clear();
        document.querySelectorAll('input[data-row-check]').forEach(cb => cb.checked = false);
        document.querySelectorAll('.rec-table-postings tbody tr').forEach(tr => tr.classList.remove('selected'));
        const selectAll = document.getElementById('selectAllCheckbox');
        if (selectAll) selectAll.checked = false;
        updateBulkbar();
    };

    window.bulkSetStatus = async function (status) {
        if (selectedIds.size === 0) return;
        if (!confirm(`Set status to "${status}" for ${selectedIds.size} posting(s)?`)) return;
        try {
            await Promise.all([...selectedIds].map(id =>
                api.request(`/hrms/job-postings/${id}`, { method: 'PUT', body: JSON.stringify({ status }) })
            ));
            Toast?.success?.(`${selectedIds.size} posting(s) updated`);
            selectedIds.clear();
            await loadPostings();
        } catch (err) { Toast?.error?.(err?.message || 'Bulk status update failed'); }
    };

    window.bulkDelete = async function () {
        if (selectedIds.size === 0) return;
        if (!confirm(`Delete ${selectedIds.size} posting(s) AND all their applications? This cannot be undone.`)) return;
        try {
            await Promise.all([...selectedIds].map(id =>
                api.request(`/hrms/job-postings/${id}`, { method: 'DELETE' })
            ));
            Toast?.success?.(`${selectedIds.size} posting(s) deleted`);
            selectedIds.clear();
            await loadPostings();
        } catch (err) { Toast?.error?.(err?.message || 'Bulk delete failed'); }
    };

    // ─── Kebab menu (per-row quick actions) ───────────────────────────────
    let _kebabTargetId = null;
    let _menuHoisted = false;
    window.showKebabMenu = function (ev, id) {
        ev.stopPropagation();
        _kebabTargetId = id;
        const menu = document.getElementById('recKebabMenu');
        const trigger = ev.target.closest('.rec-kebab-trigger');

        // Hoist the menu out of the deeply nested content container so its
        // `position: absolute` is calculated against the document root.
        // `position: fixed` got confused inside the layout — the menu landed
        // at viewport-x ≈1988 with only a 1559px viewport, completely off-screen.
        // Becoming a direct body child + using document coords sidesteps the
        // containing-block issue entirely.
        if (!_menuHoisted) {
            document.body.appendChild(menu);
            menu.style.position = 'absolute';
            _menuHoisted = true;
        }

        // Filter visible actions BEFORE measuring so the menu's height reflects
        // what will actually render.
        const p = postings.find(x => x.id === id);
        const st = p?.status || 'open';
        const showFor = {
            'pause':   st === 'open',
            'resume':  st !== 'open',
            'close':   st !== 'closed',
            'archive': st !== 'archived'
        };
        menu.querySelectorAll('button[data-action]').forEach(b => {
            const a = b.dataset.action;
            b.style.display = (a in showFor) ? (showFor[a] ? '' : 'none') : '';
        });

        // Make the menu visible off-screen first, force a reflow, THEN measure.
        menu.style.visibility = 'hidden';
        menu.style.display = 'block';
        menu.style.top = '0px';
        menu.style.left = '0px';
        void menu.offsetHeight; // force reflow
        const menuW = menu.offsetWidth || 200;
        const menuH = menu.offsetHeight || 240;

        // Trigger's position in document coordinates.
        const rect = trigger.getBoundingClientRect();
        const docTop = rect.top + window.scrollY;
        const docRight = rect.right + window.scrollX;
        const docBottom = rect.bottom + window.scrollY;

        // Right-align with the trigger, but clamp inside the viewport.
        let left = docRight - menuW;
        const minLeft = window.scrollX + 8;
        const maxLeft = window.scrollX + window.innerWidth - menuW - 8;
        if (left < minLeft) left = minLeft;
        if (left > maxLeft) left = maxLeft;

        let top = docBottom + 4;
        const maxTop = window.scrollY + window.innerHeight - menuH - 8;
        if (top > maxTop) {
            top = docTop - menuH - 4; // flip above the trigger
            if (top < window.scrollY + 8) top = window.scrollY + 8;
        }

        menu.style.top = top + 'px';
        menu.style.left = left + 'px';
        menu.style.visibility = '';
    };

    function hideKebabMenu() {
        const menu = document.getElementById('recKebabMenu');
        if (menu) menu.style.display = 'none';
        _kebabTargetId = null;
    }

    // Delegate kebab menu actions
    document.addEventListener('DOMContentLoaded', () => {
        const menu = document.getElementById('recKebabMenu');
        if (!menu) return;
        menu.addEventListener('click', async (e) => {
            const btn = e.target.closest('button[data-action]');
            if (!btn) return;
            const id = _kebabTargetId;
            const p = postings.find(x => x.id === id);
            if (!p) return hideKebabMenu();
            const action = btn.dataset.action;
            hideKebabMenu();
            const publicUrl = `${window.location.origin}/pages/apply.html?k=${encodeURIComponent(p.webhook_key || '')}`;
            switch (action) {
                case 'open': openPostingDetail(id); break;
                case 'edit': editPosting(id); break;
                case 'copy-link': copyPostingLink(id, publicUrl); break;
                case 'preview': window.open(publicUrl, '_blank'); break;
                case 'regen': regenerateKey(id); break;
                case 'pause': await quickSetStatus(id, 'paused'); break;
                case 'resume': await quickSetStatus(id, 'open'); break;
                case 'close': await quickSetStatus(id, 'closed'); break;
                case 'archive': await quickSetStatus(id, 'archived'); break;
                case 'delete': deletePosting(id); break;
            }
        });
    });

    async function quickSetStatus(id, status) {
        try {
            await api.request(`/hrms/job-postings/${id}`, { method: 'PUT', body: JSON.stringify({ status }) });
            Toast?.success?.(`Status set to ${status}`);
            await loadPostings();
        } catch (err) { Toast?.error?.(err?.message || 'Failed to update status'); }
    }

    function cssEscape(s) { return (window.CSS && CSS.escape) ? CSS.escape(s) : String(s).replace(/[^a-zA-Z0-9_-]/g, '\\$&'); }

    // ─── Posting detail view ──────────────────────────────────────────────
    window.openPostingDetail = async function (id) {
        activePostingId = id;
        activePosting = postings.find(p => p.id === id) || null;

        document.getElementById('postingsListView').style.display = 'none';
        document.getElementById('postingDetailView').style.display = '';
        document.getElementById('activeTabName').textContent = activePosting?.title || 'Posting detail';

        renderPostingDetailCard();
        await loadDetailApps();
    };

    window.closePostingDetail = function () {
        activePostingId = null;
        activePosting = null;
        activePostingApps = [];
        const detail = document.getElementById('postingDetailView');
        const list = document.getElementById('postingsListView');
        if (detail) detail.style.display = 'none';
        if (list) list.style.display = '';
        const titleEl = document.getElementById('activeTabName');
        if (titleEl) titleEl.textContent = 'Job Postings';
    };

    function renderPostingDetailCard() {
        if (!activePosting) return;
        const p = activePosting;
        const publicUrl = `${window.location.origin}/pages/apply.html?k=${encodeURIComponent(p.webhook_key || '')}`;
        // Share URL goes through HRMS backend so social scrapers (FB, X,
        // LinkedIn, Slack) see custom og: meta tags + the auto-generated 1200×630
        // OG image. Real users land here briefly then redirect to publicUrl.
        const shareUrl = `${CONFIG.hrmsApiBaseUrl}/recruitment/apply/${encodeURIComponent(p.webhook_key || '')}/share`;
        const ogImageUrl = `${CONFIG.hrmsApiBaseUrl}/recruitment/apply/${encodeURIComponent(p.webhook_key || '')}/og.png`;
        const fieldCount = countFields(p.form_fields);
        const metaBits = [];
        if (p.location) metaBits.push(escapeHtml(p.location));
        const empType = formatEmploymentType(p.employment_type);
        if (empType) metaBits.push(escapeHtml(empType));
        if (p.openings > 1) metaBits.push(`${p.openings} openings`);
        if (fieldCount) metaBits.push(`${fieldCount} form field${fieldCount === 1 ? '' : 's'}`);

        // p.description is HTML (Quill output). Sanitize via DOMPurify (loaded
        // from CDN in recruitment.html) before innerHTML insertion — any HR who
        // pastes raw `<img src=x onerror=...>` from a Word doc would otherwise
        // get persistent XSS against every reader of the posting drawer.
        const descSafe = p.description
            ? (typeof DOMPurify !== 'undefined' ? DOMPurify.sanitize(p.description) : '')
            : '';
        const desc = descSafe ? `<div class="rec-description-rendered">${descSafe}</div>` : '';

        document.getElementById('detailPostingCard').innerHTML = `
            <div class="rec-posting-top">
                <div class="rec-posting-main">
                    <div class="rec-posting-title-row">
                        <h3>${escapeHtml(p.title || 'Untitled')}</h3>
                        <span class="rec-badge rec-badge-${escapeAttr(p.status || 'open')}">${escapeHtml(p.status || 'open')}</span>
                    </div>
                    <div class="rec-posting-meta">${metaBits.join(' · ') || '—'}</div>
                    ${desc}
                    <div class="rec-link-strip" style="margin-top: 14px;">
                        <code>${escapeHtml(publicUrl)}</code>
                        <button class="rec-btn rec-btn-sm" onclick="copyPostingLink('${escapeAttr(p.id)}','${escapeAttr(publicUrl)}')">Copy apply URL</button>
                        <button class="rec-btn rec-btn-sm" onclick="window.open('${escapeAttr(publicUrl)}', '_blank')">Preview</button>
                    </div>
                    <!-- Social-share URL: paste this in Slack / X / LinkedIn /
                         Facebook to get a custom preview card with the
                         auto-generated OG image + tagline. Same destination
                         (the apply page) but goes through a server-rendered
                         redirect so scrapers can read the meta tags. -->
                    <div class="rec-link-strip" style="margin-top: 8px; gap: 8px;">
                        <code style="background: var(--bg-tertiary); border-color: rgba(139,92,246,0.3);">${escapeHtml(shareUrl)}</code>
                        <button class="rec-btn rec-btn-sm" onclick="copyPostingLink('${escapeAttr(p.id)}','${escapeAttr(shareUrl)}')" title="Use this link for social-media posts so Slack/X/LinkedIn show a branded preview">Copy share link</button>
                        <button class="rec-btn rec-btn-sm" onclick="window.open('${escapeAttr(ogImageUrl)}', '_blank')" title="Preview the OG image that scrapers will see">View OG image</button>
                    </div>
                </div>
                <div class="rec-posting-actions">
                    <button class="rec-btn rec-btn-sm" onclick="editPosting('${escapeAttr(p.id)}')">Edit</button>
                    <button class="rec-btn rec-btn-sm" onclick="regenerateKey('${escapeAttr(p.id)}')" title="Invalidate the public link and mint a fresh one">Regen link</button>
                    <button class="rec-btn rec-btn-sm rec-btn-danger" onclick="deletePosting('${escapeAttr(p.id)}')">Delete</button>
                </div>
            </div>
        `;
    }

    async function loadDetailApps() {
        if (!activePostingId) return;
        const loading = document.getElementById('detailAppsLoading');
        const empty = document.getElementById('detailAppsEmpty');
        const wrap = document.getElementById('detailAppsTableWrap');
        loading.style.display = '';
        empty.style.display = 'none';
        wrap.style.display = 'none';
        try {
            activePostingApps = await api.request(`/hrms/job-applications?jobPostingId=${encodeURIComponent(activePostingId)}`);
            loading.style.display = 'none';
            renderDetailApps();
        } catch (err) {
            console.error('loadDetailApps failed', err);
            loading.textContent = 'Failed to load applications. ' + (err?.message || '');
        }
    }

    function renderDetailApps() {
        const empty = document.getElementById('detailAppsEmpty');
        const wrap = document.getElementById('detailAppsTableWrap');
        const tbody = document.getElementById('detailAppsTbody');
        const countEl = document.getElementById('detailAppCount');

        const status = dd.detailAppStatusFilter ? dd.detailAppStatusFilter.getValue() : '';
        const filtered = !status ? activePostingApps : activePostingApps.filter(a => a.status === status);

        if (countEl) countEl.textContent = `(${filtered.length}${activePostingApps.length !== filtered.length ? ` of ${activePostingApps.length}` : ''})`;

        if (filtered.length === 0) {
            empty.style.display = '';
            wrap.style.display = 'none';
            return;
        }
        empty.style.display = 'none';
        wrap.style.display = '';
        tbody.innerHTML = filtered.map(a => `
            <tr onclick="openApplicationDrawer('${escapeAttr(a.id)}')">
                <td class="applicant-name">${escapeHtml(a.applicant_name || '—')}</td>
                <td>${escapeHtml(a.applicant_email || '')}</td>
                <td>${escapeHtml(a.applicant_phone || '')}</td>
                <td><span class="rec-badge rec-badge-${escapeAttr(a.status || 'new')}">${escapeHtml(a.status || 'new')}</span></td>
                <td style="white-space: nowrap; color: var(--text-secondary);">${formatDate(a.created_at)}</td>
                <td><button class="rec-btn rec-btn-sm" onclick="event.stopPropagation(); openApplicationDrawer('${escapeAttr(a.id)}')">Open</button></td>
            </tr>
        `).join('');
    }

    // Lazy-init Quill the first time the modal is opened. Initialising on
    // DOMContentLoaded breaks because the editor host is inside a modal that
    // may not be visible — Quill needs the element to have a parent at init time.
    function ensureQuill() {
        if (quillDescription) return quillDescription;
        if (typeof Quill === 'undefined') {
            console.warn('Quill not loaded yet');
            return null;
        }
        const host = document.getElementById('postingDescriptionEditor');
        if (!host) return null;
        quillDescription = new Quill(host, {
            theme: 'snow',
            modules: { toolbar: QUILL_TOOLBAR },
            placeholder: 'Brief overview, responsibilities, requirements...'
        });
        return quillDescription;
    }

    function getDescriptionHtml() {
        const q = ensureQuill();
        if (!q) return '';
        // Empty editor returns '<p><br></p>' — treat that as blank.
        const html = q.root.innerHTML.trim();
        return html === '<p><br></p>' ? '' : html;
    }

    function setDescriptionHtml(html) {
        const q = ensureQuill();
        if (!q) return;
        if (html) {
            // dangerouslyPasteHTML keeps formatting; the source is HR-authored
            // markup from our own admin UI, so trust it.
            q.clipboard.dangerouslyPasteHTML(html);
        } else {
            q.setText('');
        }
    }

    // ─── Posting modal (create / edit) ────────────────────────────────────
    window.openNewPostingModal = function () {
        editingPostingId = null;
        document.getElementById('postingModalTitle').textContent = 'New Posting';
        document.getElementById('postingForm').reset();
        document.getElementById('postingId').value = '';
        document.getElementById('postingOpenings').value = '1';
        document.getElementById('postingLogoUrl').value = '';
        document.getElementById('postingBannerUrl').value = '';
        document.getElementById('postingCompanyName').value = '';
        document.getElementById('postingCompanyWebsite').value = '';
        document.getElementById('postingLatitude').value = '';
        document.getElementById('postingLongitude').value = '';
        document.getElementById('postingSummary').value = '';
        document.getElementById('postingOgImageUrl').value = '';
        document.getElementById('postingNotifyOnApplication').checked = false;
        updateSummaryCounter();
        dd.postingEmploymentType?.setValue('');
        dd.postingStatus?.setValue('open');
        dd.postingTheme?.setValue('dark');
        document.getElementById('formFieldsList').innerHTML = '';
        addDefaultStarterFields();
        openModal('postingModal');
        // Quill must be initialised AFTER the modal is visible so its editor
        // host has measurable dimensions; do it on the next tick.
        setTimeout(() => { ensureQuill(); setDescriptionHtml(''); }, 50);
    };

    window.editPosting = function (id) {
        const p = postings.find(x => x.id === id);
        if (!p) return;
        editingPostingId = id;
        document.getElementById('postingModalTitle').textContent = 'Edit Posting';
        document.getElementById('postingId').value = id;
        document.getElementById('postingTitle').value = p.title || '';
        document.getElementById('postingLocation').value = p.location || '';
        dd.postingEmploymentType?.setValue(p.employment_type || '');
        document.getElementById('postingOpenings').value = p.openings || 1;
        dd.postingStatus?.setValue(p.status || 'open');
        dd.postingTheme?.setValue(p.theme || 'dark');
        document.getElementById('postingLogoUrl').value = p.logo_url || '';
        document.getElementById('postingBannerUrl').value = p.banner_url || '';
        document.getElementById('postingCompanyName').value = p.company_name || '';
        document.getElementById('postingCompanyWebsite').value = p.company_website || '';
        document.getElementById('postingLatitude').value = p.office_latitude ?? '';
        document.getElementById('postingLongitude').value = p.office_longitude ?? '';
        document.getElementById('postingSummary').value = p.summary || '';
        document.getElementById('postingOgImageUrl').value = p.og_image_url || '';
        document.getElementById('postingNotifyOnApplication').checked = !!p.notify_on_application;
        updateSummaryCounter();

        document.getElementById('formFieldsList').innerHTML = '';
        let fields = [];
        try { fields = typeof p.form_fields === 'string' ? JSON.parse(p.form_fields) : (p.form_fields || []); } catch { fields = []; }
        fields.forEach(f => addFormFieldCard(f));

        openModal('postingModal');
        setTimeout(() => { ensureQuill(); setDescriptionHtml(p.description || ''); }, 50);
    };

    window.closePostingModal = function () { closeModal('postingModal'); };

    window.savePosting = async function (ev) {
        ev.preventDefault();
        const btn = document.getElementById('postingSubmitBtn');
        const orig = btn.textContent;
        btn.disabled = true; btn.textContent = 'Saving...';
        try {
            const formFields = collectFormFields();
            const latRaw = document.getElementById('postingLatitude').value;
            const lngRaw = document.getElementById('postingLongitude').value;
            const payload = {
                title: document.getElementById('postingTitle').value.trim(),
                location: nullIfBlank(document.getElementById('postingLocation').value),
                employment_type: nullIfBlank(dd.postingEmploymentType?.getValue() || ''),
                description: nullIfBlank(getDescriptionHtml()),
                openings: Math.max(1, parseInt(document.getElementById('postingOpenings').value, 10) || 1),
                status: dd.postingStatus?.getValue() || 'open',
                form_fields: JSON.stringify(formFields),
                logo_url: nullIfBlank(document.getElementById('postingLogoUrl').value),
                banner_url: nullIfBlank(document.getElementById('postingBannerUrl').value),
                theme: dd.postingTheme?.getValue() || 'dark',
                company_name: nullIfBlank(document.getElementById('postingCompanyName').value),
                company_website: nullIfBlank(document.getElementById('postingCompanyWebsite').value),
                office_latitude: latRaw === '' ? null : parseFloat(latRaw),
                office_longitude: lngRaw === '' ? null : parseFloat(lngRaw),
                summary: nullIfBlank(document.getElementById('postingSummary').value),
                og_image_url: nullIfBlank(document.getElementById('postingOgImageUrl').value),
                notify_on_application: document.getElementById('postingNotifyOnApplication').checked
            };

            if (editingPostingId) {
                await api.request(`/hrms/job-postings/${editingPostingId}`, {
                    method: 'PUT', body: JSON.stringify(payload)
                });
                Toast?.success?.('Posting updated');
            } else {
                await api.request('/hrms/job-postings', {
                    method: 'POST', body: JSON.stringify(payload)
                });
                Toast?.success?.('Posting created — share the apply link');
            }
            closePostingModal();
            await loadPostings();
            // If we were in detail view for this posting, refresh it too
            if (activePostingId && editingPostingId === activePostingId) {
                activePosting = postings.find(p => p.id === activePostingId) || null;
                renderPostingDetailCard();
            }
        } catch (err) {
            console.error('savePosting failed', err);
            Toast?.error?.(err?.message || 'Failed to save posting');
        } finally {
            btn.disabled = false; btn.textContent = orig;
        }
    };

    window.deletePosting = async function (id) {
        const p = postings.find(x => x.id === id);
        if (!p) return;
        if (!confirm(`Delete "${p.title}" and all its applications? This cannot be undone.`)) return;
        try {
            await api.request(`/hrms/job-postings/${id}`, { method: 'DELETE' });
            Toast?.success?.('Posting deleted');
            if (activePostingId === id) closePostingDetail();
            await loadPostings();
        } catch (err) {
            Toast?.error?.(err?.message || 'Failed to delete posting');
        }
    };

    window.regenerateKey = async function (id) {
        if (!confirm('Regenerate the public apply link? The old link will stop working immediately.')) return;
        try {
            await api.request(`/hrms/job-postings/${id}/regenerate-key`, { method: 'POST' });
            Toast?.success?.('New apply link generated');
            await loadPostings();
            if (activePostingId === id) {
                activePosting = postings.find(p => p.id === id) || null;
                renderPostingDetailCard();
            }
        } catch (err) {
            Toast?.error?.(err?.message || 'Failed to regenerate key');
        }
    };

    window.copyPostingLink = async function (id, url) {
        try {
            await navigator.clipboard.writeText(url);
            Toast?.success?.('Apply link copied');
        } catch {
            const ta = document.createElement('textarea');
            ta.value = url; document.body.appendChild(ta); ta.select();
            document.execCommand('copy'); document.body.removeChild(ta);
            Toast?.success?.('Apply link copied');
        }
    };

    // Live char counter for the share-summary textarea (220 char hard cap on
    // the backend; we mirror the limit in the UI so HR can write to the line).
    window.updateSummaryCounter = function () {
        const ta = document.getElementById('postingSummary');
        const counter = document.getElementById('postingSummaryCounter');
        if (!ta || !counter) return;
        const len = ta.value.length;
        counter.textContent = `${len} / 220`;
        counter.style.color = len > 200
            ? 'var(--color-warning, #b08800)'
            : 'var(--text-secondary)';
    };

    // ─── Form-fields builder ──────────────────────────────────────────────
    function addDefaultStarterFields() {
        const defaults = [
            { key: 'full_name', type: 'text', label: 'Full name', required: true, width: 'full' },
            { key: 'email', type: 'email', label: 'Email', required: true, width: 'half' },
            { key: 'phone', type: 'tel', label: 'Phone', required: true, width: 'half' }
        ];
        defaults.forEach(f => addFormFieldCard(f));
    }

    window.addFormField = function () {
        addFormFieldCard({ key: '', type: 'text', label: '', placeholder: '', required: false, width: 'full', options: [] });
    };

    function addFormFieldCard(field) {
        const list = document.getElementById('formFieldsList');
        const f = field || {};
        const card = document.createElement('div');
        card.className = 'ff-row';
        card._ffData = {
            key: f.key || '',
            type: f.type || 'text',
            label: f.label || '',
            placeholder: f.placeholder || '',
            required: !!f.required,
            width: f.width || 'full',
            options: Array.isArray(f.options) ? f.options.slice() : [],
            // Round-trip the new constraint props so editing a field doesn't
            // drop them when HR opens & re-saves the settings modal.
            helper_text: f.helper_text || null,
            min: (f.min == null) ? null : Number(f.min),
            max: (f.max == null) ? null : Number(f.max),
            min_date: f.min_date || null,
            max_date: f.max_date || null,
            min_length: (f.min_length == null) ? null : parseInt(f.min_length, 10),
            max_length: (f.max_length == null) ? null : parseInt(f.max_length, 10),
            keyUserEdited: !!f.key
        };
        card.innerHTML = `
            <span class="ff-row-handle">⋮⋮</span>
            <input type="text" class="ff-row-label" placeholder="Untitled field" value="${escapeAttr(card._ffData.label)}">
            <span class="ff-type-pill" data-ff-type></span>
            <span class="ff-required-pill" data-ff-req style="display:none;">required</span>
            <div class="ff-row-actions">
                <button type="button" class="ff-icon-btn" data-ff-settings title="Settings">⚙</button>
                <button type="button" class="ff-icon-btn" data-ff-up title="Move up">↑</button>
                <button type="button" class="ff-icon-btn" data-ff-down title="Move down">↓</button>
                <button type="button" class="ff-icon-btn ff-danger" data-ff-remove title="Remove">×</button>
            </div>
        `;
        card.querySelector('[data-ff-type]').textContent = card._ffData.type;
        card.querySelector('[data-ff-req]').style.display = card._ffData.required ? '' : 'none';

        const labelInput = card.querySelector('.ff-row-label');
        labelInput.addEventListener('input', () => {
            card._ffData.label = labelInput.value;
            if (!card._ffData.keyUserEdited) card._ffData.key = slugify(labelInput.value);
        });
        card.querySelector('[data-ff-remove]').addEventListener('click', () => card.remove());
        card.querySelector('[data-ff-up]').addEventListener('click', () => {
            const prev = card.previousElementSibling;
            if (prev) list.insertBefore(card, prev);
        });
        card.querySelector('[data-ff-down]').addEventListener('click', () => {
            const next = card.nextElementSibling;
            if (next) list.insertBefore(next, card);
        });
        card.querySelector('[data-ff-settings]').addEventListener('click', () => openFieldSettings(card));

        list.appendChild(card);
    }

    function openFieldSettings(card) {
        activeFieldCard = card;
        const d = card._ffData;
        document.getElementById('fsLabel').value = d.label;
        dd.fsType?.setValue(d.type || 'text');
        document.getElementById('fsPlaceholder').value = d.placeholder;
        document.getElementById('fsHelperText').value = d.helper_text || '';
        document.getElementById('fsKey').value = d.key;
        document.getElementById('fsRequired').checked = d.required;
        // Per-type constraint values (blanks left as blanks)
        document.getElementById('fsMinLength').value = d.min_length ?? '';
        document.getElementById('fsMaxLength').value = d.max_length ?? '';
        document.getElementById('fsMin').value       = d.min ?? '';
        document.getElementById('fsMax').value       = d.max ?? '';
        document.getElementById('fsMinDate').value   = d.min_date || '';
        document.getElementById('fsMaxDate').value   = d.max_date || '';
        document.getElementById('fsOptions').value = (d.options || [])
            .map(o => o.label && o.label !== o.value ? `${o.value}|${o.label}` : o.value).join('\n');
        syncOptionsVisibility();
        document.getElementById('fsLabel').oninput = () => {
            if (!activeFieldCard?._ffData?.keyUserEdited) {
                document.getElementById('fsKey').value = slugify(document.getElementById('fsLabel').value);
            }
        };
        document.getElementById('fsKey').oninput = () => {
            if (activeFieldCard?._ffData) activeFieldCard._ffData.keyUserEdited = true;
        };
        openModal('fieldSettingsModal');
    }

    window.closeFieldSettings = function () { closeModal('fieldSettingsModal'); activeFieldCard = null; };

    window.saveFieldSettings = function () {
        if (!activeFieldCard) return closeFieldSettings();
        const label = document.getElementById('fsLabel').value.trim();
        if (!label) { Toast?.error?.('Label is required'); return; }
        const type = dd.fsType?.getValue() || 'text';
        const key = (document.getElementById('fsKey').value.trim() || slugify(label));
        const required = document.getElementById('fsRequired').checked;
        const placeholder = document.getElementById('fsPlaceholder').value;
        const helperText = document.getElementById('fsHelperText').value.trim();
        let options = [];
        // country/yesno have hardcoded options on the backend, HR doesn't supply
        // them — only the "real" choice types ask HR to type the list.
        if (FIELD_TYPES_WITH_OPTIONS.has(type)) {
            options = document.getElementById('fsOptions').value.split('\n').map(line => {
                const t = line.trim(); if (!t) return null;
                const i = t.indexOf('|');
                if (i === -1) return { value: t, label: t };
                const v = t.slice(0, i).trim(); const l = t.slice(i + 1).trim();
                return v ? { value: v, label: l || v } : null;
            }).filter(Boolean);
        }
        const numOrNull = (id) => {
            const v = document.getElementById(id).value;
            return v === '' || v == null ? null : Number(v);
        };
        const intOrNull = (id) => {
            const v = document.getElementById(id).value;
            return v === '' || v == null ? null : parseInt(v, 10);
        };
        const strOrNull = (id) => {
            const v = (document.getElementById(id).value || '').trim();
            return v || null;
        };
        activeFieldCard._ffData = {
            key, type, label, placeholder, required, width: 'full', options,
            helper_text: helperText || null,
            min: FIELD_TYPES_WITH_RANGE.has(type) ? numOrNull('fsMin') : null,
            max: FIELD_TYPES_WITH_RANGE.has(type) ? numOrNull('fsMax') : null,
            min_date: FIELD_TYPES_WITH_DATE_RANGE.has(type) ? strOrNull('fsMinDate') : null,
            max_date: FIELD_TYPES_WITH_DATE_RANGE.has(type) ? strOrNull('fsMaxDate') : null,
            min_length: FIELD_TYPES_WITH_LENGTH.has(type) ? intOrNull('fsMinLength') : null,
            max_length: FIELD_TYPES_WITH_LENGTH.has(type) ? intOrNull('fsMaxLength') : null,
            keyUserEdited: true
        };
        activeFieldCard.querySelector('.ff-row-label').value = label;
        activeFieldCard.querySelector('[data-ff-type]').textContent = type;
        activeFieldCard.querySelector('[data-ff-req]').style.display = required ? '' : 'none';
        closeFieldSettings();
    };

    function syncOptionsVisibility() {
        const t = dd.fsType?.getValue() || 'text';
        document.getElementById('fsOptionsWrap').style.display    = FIELD_TYPES_WITH_OPTIONS.has(t) ? '' : 'none';
        document.getElementById('fsLengthWrap').style.display     = FIELD_TYPES_WITH_LENGTH.has(t) ? '' : 'none';
        document.getElementById('fsRangeWrap').style.display      = FIELD_TYPES_WITH_RANGE.has(t) ? '' : 'none';
        document.getElementById('fsDateRangeWrap').style.display  = FIELD_TYPES_WITH_DATE_RANGE.has(t) ? '' : 'none';
    }

    function collectFormFields() {
        const cards = document.querySelectorAll('#formFieldsList .ff-row');
        const out = [];
        cards.forEach(card => {
            const d = card._ffData; if (!d) return;
            const liveLabel = card.querySelector('.ff-row-label')?.value?.trim() || d.label || '';
            const key = (d.key || '').trim() || slugify(liveLabel);
            if (!key) return;
            const f = {
                key, type: d.type || 'text', label: liveLabel || key,
                placeholder: d.placeholder || '', required: !!d.required, width: d.width || 'full'
            };
            // Only the user-curated option types ship an options[] array. The
            // backend generates options for country/yesno on its own.
            if (FIELD_TYPES_WITH_OPTIONS.has(f.type)) f.options = Array.isArray(d.options) ? d.options : [];
            // Forward the per-type constraints when they're meaningful for that
            // type. Send nulls for blanks so the backend can apply its defaults.
            if (d.helper_text) f.helper_text = d.helper_text;
            if (FIELD_TYPES_WITH_LENGTH.has(f.type)) {
                if (d.min_length != null) f.min_length = d.min_length;
                if (d.max_length != null) f.max_length = d.max_length;
            }
            if (FIELD_TYPES_WITH_RANGE.has(f.type)) {
                if (d.min != null) f.min = d.min;
                if (d.max != null) f.max = d.max;
            }
            if (FIELD_TYPES_WITH_DATE_RANGE.has(f.type)) {
                if (d.min_date) f.min_date = d.min_date;
                if (d.max_date) f.max_date = d.max_date;
            }
            out.push(f);
        });
        return out;
    }

    // ─── Application drawer ───────────────────────────────────────────────
    window.openApplicationDrawer = async function (id) {
        activeApplicationId = id;
        try {
            activeApplication = await api.request(`/hrms/job-applications/${id}`);
            document.getElementById('appDrawerTitle').textContent = activeApplication.applicant_name || 'Application';
            const badge = document.getElementById('appDrawerStatus');
            badge.textContent = activeApplication.status;
            badge.className = 'rec-badge rec-badge-' + (activeApplication.status || 'new');
            dd.appDrawerStatusSelect?.setValue(activeApplication.status || 'new');
            document.getElementById('appDrawerMeta').textContent = `For "${activeApplication.job_title}" · ${formatDate(activeApplication.created_at, true)}`;
            document.getElementById('appDrawerNotes').value = activeApplication.notes || '';
            renderApplicationFields(activeApplication);
            openModal('applicationDrawer');
        } catch (err) {
            Toast?.error?.(err?.message || 'Failed to open application');
        }
    };

    window.closeApplicationDrawer = function () { closeModal('applicationDrawer'); activeApplicationId = null; activeApplication = null; };

    function renderApplicationFields(app) {
        const wrap = document.getElementById('appDrawerFields');
        let data = {};
        try { data = typeof app.submitted_data === 'string' ? JSON.parse(app.submitted_data) : (app.submitted_data || {}); } catch { data = {}; }
        const seen = new Set();
        const rows = [];
        const firstClass = ['full_name', 'name', 'applicant_name', 'first_name', 'last_name', 'email', 'phone'];
        firstClass.forEach(k => {
            if (data[k] != null && !seen.has(k)) { rows.push(rowHtml(humanise(k), data[k])); seen.add(k); }
        });
        Object.keys(data).forEach(k => {
            if (seen.has(k)) return;
            rows.push(rowHtml(humanise(k), data[k]));
        });
        wrap.innerHTML = rows.join('') || '<p style="color: var(--text-secondary);">No form data captured.</p>';
    }

    function rowHtml(label, value) {
        const v = value == null ? '' : (typeof value === 'string' ? value : JSON.stringify(value));
        return `<div class="rec-app-field-row">
                    <div class="rec-app-field-key">${escapeHtml(label)}</div>
                    <div class="rec-app-field-val">${escapeHtml(v)}</div>
                </div>`;
    }

    function changeApplicationStatus() {
        // SearchableDropdown calls this directly via onChange (no event arg).
        // Guard against firing during initial open before activeApplicationId is set.
        if (!activeApplicationId) return;
        const status = dd.appDrawerStatusSelect?.getValue();
        if (!status) return;
        api.request(`/hrms/job-applications/${activeApplicationId}/status`, {
            method: 'PUT',
            body: JSON.stringify({ status, notes: document.getElementById('appDrawerNotes').value })
        }).then(updated => {
            activeApplication = updated;
            const badge = document.getElementById('appDrawerStatus');
            badge.textContent = updated.status;
            badge.className = 'rec-badge rec-badge-' + (updated.status || 'new');
            Toast?.success?.(`Status set to ${updated.status}`);
            // Refresh the detail-view list if we're in it
            if (activePostingId && updated.job_posting_id === activePostingId) loadDetailApps();
            // Also refresh postings list so counts update
            loadPostings();
        }).catch(err => {
            Toast?.error?.(err?.message || 'Failed to update status');
        });
    }

    window.saveApplicationNotes = async function () {
        if (!activeApplicationId) return;
        try {
            await api.request(`/hrms/job-applications/${activeApplicationId}/status`, {
                method: 'PUT', body: JSON.stringify({
                    status: dd.appDrawerStatusSelect?.getValue() || 'new',
                    notes: document.getElementById('appDrawerNotes').value
                })
            });
            Toast?.success?.('Notes saved');
        } catch (err) {
            Toast?.error?.(err?.message || 'Failed to save notes');
        }
    };

    // ─── Modal helpers ─────────────────────────────────────────────────────
    function openModal(id) {
        const m = document.getElementById(id); if (!m) return;
        m.hidden = false;
        void m.offsetWidth;
        m.classList.add('active');
    }
    function closeModal(id) {
        const m = document.getElementById(id); if (!m) return;
        m.classList.remove('active');
        setTimeout(() => { m.hidden = true; }, 220);
    }
    window.openModal = openModal;
    window.closeModal = closeModal;

    // ─── Utility ───────────────────────────────────────────────────────────
    function slugify(s) {
        return String(s || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    }
    function escapeHtml(s) {
        return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }
    function escapeAttr(s) { return escapeHtml(s).replace(/`/g, '&#96;'); }
    function nullIfBlank(s) { return s && s.trim() ? s.trim() : null; }
    function debounce(fn, ms) {
        let t; return function (...args) { clearTimeout(t); t = setTimeout(() => fn.apply(this, args), ms); };
    }
    function humanise(key) {
        const s = String(key || '').replace(/_/g, ' ').trim();
        return s ? s[0].toUpperCase() + s.slice(1) : key;
    }
    function formatEmploymentType(t) {
        const map = { full_time: 'Full-time', part_time: 'Part-time', contract: 'Contract', intern: 'Internship', freelance: 'Freelance' };
        return map[t] || t || '';
    }
    function formatDate(iso, withTime) {
        if (!iso) return '';
        const d = new Date(iso); if (Number.isNaN(d.getTime())) return iso;
        const opts = withTime
            ? { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }
            : { year: 'numeric', month: 'short', day: 'numeric' };
        return d.toLocaleDateString(undefined, opts);
    }
})();
