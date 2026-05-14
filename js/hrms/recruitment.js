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
        // Reset analytics-loaded flag for the new posting + collapse the
        // panel so HR consciously opts in to seeing the dashboard.
        const det = document.getElementById('detailAnalyticsDetails');
        if (det) {
            det.open = false;
            det.dataset.loaded = '';
        }
        // Wire the toggle + range selector once per session. The toggle
        // triggers loadDetailAnalytics on first expand only; range changes
        // re-fetch only when the panel is currently open.
        const sel = document.getElementById('detailAnalyticsRange');
        if (sel && !sel.dataset.bound) {
            sel.addEventListener('change', () => {
                const d = document.getElementById('detailAnalyticsDetails');
                if (d?.open) loadDetailAnalytics();
            });
            sel.dataset.bound = '1';
        }
        if (det && !det.dataset.bound) {
            det.addEventListener('toggle', () => {
                if (det.open && !det.dataset.loaded) {
                    det.dataset.loaded = '1';
                    loadDetailAnalytics();
                }
            });
            det.dataset.bound = '1';
        }
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
            // Reset + load the Recruit Copilot panel for this application
            const ivBody = document.getElementById('appDrawerInterviewBody');
            if (ivBody) ivBody.innerHTML = '<div class="rec-loading">Loading interview state…</div>';
            openModal('applicationDrawer');
            loadApplicationInterviews(id);
        } catch (err) {
            Toast?.error?.(err?.message || 'Failed to open application');
        }
    };

    // ─── Recruit Copilot panel ─────────────────────────────────────────
    // Cached per-tab so we don't hit Auth on every drawer open. The settings
    // page is the only place that flips these flags, and it forces a reload.
    let _copilotReadinessCache = null;
    async function getRecruitCopilotReadiness() {
        if (_copilotReadinessCache) return _copilotReadinessCache;
        try {
            const r = await api.request('/tenant-settings/copilot/HRMS');
            _copilotReadinessCache = {
                hasAnthropic: !!r.has_anthropic_key,
                hasGladia:    !!r.has_gladia_key,
                enabled:      r.enabled !== false,
            };
        } catch (err) {
            console.warn('copilot readiness fetch failed — assuming OFF', err);
            _copilotReadinessCache = { hasAnthropic: false, hasGladia: false, enabled: false, error: err?.message };
        }
        return _copilotReadinessCache;
    }

    async function loadApplicationInterviews(applicationId) {
        const body = document.getElementById('appDrawerInterviewBody');
        const wrapper = document.getElementById('appDrawerInterviewDetails');
        if (!body) return;

        // Gate: hide the entire Copilot section unless BOTH the Anthropic LLM
        // key AND the Gladia STT key are configured + active for this tenant.
        // The interview Copilot needs both to function (LLM drives questioning,
        // Gladia transcribes the live audio). We render a small inline CTA
        // pointing the admin to /pages/admin/settings.html (API Keys tab) so
        // the gap is discoverable rather than silent.
        const ready = await getRecruitCopilotReadiness();
        if (!ready.hasAnthropic || !ready.hasGladia) {
            body.innerHTML = renderCopilotKeysMissing(ready);
            // Keep the section visible so HR sees WHY the Copilot is unavailable.
            if (wrapper) wrapper.open = true;
            return;
        }

        try {
            const list = await api.request(`/hrms/job-applications/${encodeURIComponent(applicationId)}/interviews`);
            renderInterviewPanel(applicationId, list || []);
        } catch (err) {
            console.error('loadApplicationInterviews failed', err);
            body.innerHTML = `<div class="rec-empty"><div>Failed to load interview state. ${escapeHtml(err?.message || '')}</div></div>`;
        }
    }

    // Inline "configure your AI keys" notice. Mirrors the look of the empty
    // states elsewhere on this page so it doesn't read as an error.
    function renderCopilotKeysMissing(ready) {
        const missing = [];
        if (!ready.hasAnthropic) missing.push('<strong>Anthropic API key</strong> (drives the AI interviewer)');
        if (!ready.hasGladia)    missing.push('<strong>Gladia API key</strong> (transcribes the live meeting)');
        return `
        <div style="padding: 22px 24px; border: 1px dashed var(--border-color); border-radius: 10px; background: rgba(139,92,246,0.06);">
            <div style="display:flex; align-items:flex-start; gap: 14px;">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#c4b5fd" stroke-width="2" style="flex-shrink:0; margin-top: 2px;">
                    <path d="M12 8v4M12 16h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z"/>
                </svg>
                <div style="flex: 1;">
                    <div style="font-size: 0.95rem; font-weight: 600; color: var(--text-primary); margin-bottom: 6px;">
                        Recruit Copilot is not yet configured for this tenant
                    </div>
                    <div style="font-size: 0.86rem; color: var(--text-secondary); line-height: 1.55; margin-bottom: 14px;">
                        AI-driven interview support requires:
                        <ul style="margin: 8px 0 0; padding-left: 18px;">
                            ${missing.map(m => `<li style="margin-bottom: 4px;">${m}</li>`).join('')}
                        </ul>
                    </div>
                    <a href="../admin/settings.html#api-keys" class="rec-btn rec-btn-primary rec-btn-sm" style="text-decoration: none; display: inline-flex; align-items: center; gap: 6px;">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
                        Open settings → API Keys
                    </a>
                    <div style="margin-top: 12px; font-size: 0.78rem; color: var(--text-tertiary, var(--text-secondary)); line-height: 1.5;">
                        Once both keys are saved, refresh this page and the Copilot will be ready to schedule interviews.
                    </div>
                </div>
            </div>
        </div>`;
    }

    function renderInterviewPanel(applicationId, interviews) {
        const body = document.getElementById('appDrawerInterviewBody');
        if (!body) return;
        // Newest first; UI shows the latest interview's state + a fold-down list of older ones
        const sorted = [...interviews].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        const latest = sorted[0];

        // ── Render existing rounds (if any) as a vertical timeline ──────
        // Each completed round shows its recommendation badge + score. The
        // "Schedule next round" form sits below as a single picker.
        const completedRounds = sorted.filter(iv => iv.status === 'completed');
        const inProgress = sorted.find(iv => iv.status === 'scheduled' || iv.status === 'in_progress');

        // Default round-type: if there's prior history, suggest the next
        // logical step. HR screen → Technical → Hiring manager → CEO → Negotiation.
        const lastRoundType = sorted[0]?.round_type || null;
        const nextRoundType = SUGGESTED_NEXT_ROUND[lastRoundType] || 'hr_screen';
        // Default datetime = round UP to next quarter-hour. Split into a
        // local date (yyyy-mm-dd for <input type="date">) and a local time
        // (hh:mm for <input type="time">) — matches the HRMS employee
        // meeting picker's formatting (the previous combined datetime-local
        // input read as one ugly cell).
        const now = new Date();
        const roundedDt = new Date(Math.ceil(now.getTime() / (15 * 60 * 1000)) * (15 * 60 * 1000));
        const pad = n => String(n).padStart(2, '0');
        const defaultDate = `${roundedDt.getFullYear()}-${pad(roundedDt.getMonth()+1)}-${pad(roundedDt.getDate())}`;
        const defaultTime = `${pad(roundedDt.getHours())}:${pad(roundedDt.getMinutes())}`;

        let timelineHtml = '';
        if (sorted.length > 0) {
            timelineHtml = `<h4 style="margin: 0 0 16px; font-size: 0.9rem; text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-secondary); font-weight: 600;">Interview Rounds</h4>
                <div class="rec-iv-timeline" style="display:flex; flex-direction:column; gap:14px;">${sorted.map(iv => renderInterviewRow(iv, iv === sorted[0])).join('')}</div>`;
        }

        // Always show the schedule form — HR can create any number of
        // meetings on a single application regardless of round status. If a
        // duplicate (round_type, round_index) would conflict, the BL's retry-
        // on-23505 loop auto-bumps round_index so a second "HR Screen" lands
        // as HR Screen #2, third as #3, etc.
        const formHtml = `
            <div style="margin-top: ${sorted.length > 0 ? '32px' : '0'}; padding-top: ${sorted.length > 0 ? '28px' : '0'}; border-top: ${sorted.length > 0 ? '1px solid var(--border-color)' : 'none'};">
                <h4 style="margin: 0 0 14px; font-size: 0.9rem; text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-secondary); font-weight: 600;">${sorted.length > 0 ? 'Schedule another interview' : 'Schedule the first interview'}</h4>
                ${sorted.length === 0
                    ? `<p style="margin: 0 0 24px; color: var(--text-secondary); font-size: 0.88rem; line-height: 1.6; max-width: 760px;">
                        AI Copilot reads the JD + the candidate's answers and drives a topic-by-topic interview with drill-down follow-ups.
                        On round 2+, prior round summaries are auto-fed in so the Copilot doesn't re-ask covered topics.
                       </p>`
                    : `<p style="margin: 0 0 22px; color: var(--text-secondary); font-size: 0.86rem; line-height: 1.55; max-width: 760px;">
                        Schedule freely — repeats of the same round type get auto-numbered (#2, #3…) and all prior rounds feed into the Copilot's context.
                       </p>`}
                <div style="display: grid; grid-template-columns: 1.1fr 1.6fr; gap: 18px; max-width: 760px; margin-bottom: 18px;">
                    <div>
                        <label style="display: block; font-size: 0.74rem; color: var(--text-secondary); margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.06em; font-weight: 600;">Round type</label>
                        <select id="ivRoundType" class="form-control" style="width: 100%;">
                            ${ROUND_TYPES.map(rt => `<option value="${rt.value}" ${rt.value === nextRoundType ? 'selected' : ''}>${rt.label}</option>`).join('')}
                        </select>
                    </div>
                    <div>
                        <label style="display: block; font-size: 0.74rem; color: var(--text-secondary); margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.06em; font-weight: 600;">Optional label (e.g. "CTO + 2 staff engineers")</label>
                        <input type="text" id="ivRoundLabel" class="form-control" placeholder="(auto)" maxlength="120" style="width: 100%;">
                    </div>
                </div>
                <!-- Date + time pair (matches the HRMS employee meeting picker — date in
                     "14 May 2026" format and time in "05:00 PM" format come from the
                     browser's native rendering of date / time inputs). Single
                     datetime-local was uglier and hid the time field. -->
                <div style="display: grid; grid-template-columns: 1.4fr 1fr; gap: 18px; max-width: 540px; margin-bottom: 22px;">
                    <div>
                        <label style="display: block; font-size: 0.74rem; color: var(--text-secondary); margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.06em; font-weight: 600;">Date</label>
                        <input type="date" id="ivScheduleDate" class="form-control" value="${defaultDate}" style="width: 100%;">
                    </div>
                    <div>
                        <label style="display: block; font-size: 0.74rem; color: var(--text-secondary); margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.06em; font-weight: 600;">Start time</label>
                        <input type="time" id="ivScheduleTime" class="form-control" value="${defaultTime}" step="900" style="width: 100%;">
                    </div>
                </div>
                <div style="display: flex; align-items: center; gap: 20px; flex-wrap: wrap; margin-top: 4px;">
                    <label style="display: flex; align-items: center; gap: 8px; font-size: 0.88rem; color: var(--text-primary); cursor: pointer; user-select: none;">
                        <input type="checkbox" id="ivSendInvite" checked> Email candidate the invite
                    </label>
                    <button class="rec-btn rec-btn-primary" style="padding: 9px 18px;" onclick="scheduleInterviewWithPicker('${escapeAttr(applicationId)}', false)">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
                        Schedule
                    </button>
                    <button class="rec-btn" style="padding: 9px 18px;" onclick="scheduleInterviewWithPicker('${escapeAttr(applicationId)}', true)" title="Skip the picker — create the meeting and open it now">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                        Start now
                    </button>
                </div>
            </div>`;

        body.innerHTML = timelineHtml + formHtml;
        // Lazy-load token-usage summary for the latest completed round
        if (completedRounds.length > 0) {
            loadTokenUsageForInterview(completedRounds[0].id);
        }
        return;
    }

    // Round-type options (matches HRMS BL allowlist)
    const ROUND_TYPES = [
        { value: 'hr_screen',      label: 'HR Screen' },
        { value: 'technical',      label: 'Technical Round' },
        { value: 'tech_panel',     label: 'Technical Panel' },
        { value: 'hiring_manager', label: 'Hiring Manager' },
        { value: 'ceo',            label: 'CEO Round' },
        { value: 'negotiation',    label: 'Salary Negotiation' },
        { value: 'final',          label: 'Final Round' },
        { value: 'other',          label: 'Other' },
    ];
    // Heuristic next-round suggestion based on what just happened
    const SUGGESTED_NEXT_ROUND = {
        'hr_screen':      'technical',
        'technical':      'tech_panel',
        'tech_panel':     'hiring_manager',
        'hiring_manager': 'ceo',
        'ceo':            'negotiation',
        'negotiation':    'final',
        'final':          'final',
    };

    // (legacy single-latest renderer removed in v3 — the panel above now
    // emits the full timeline of rounds + a single picker form.)

    // Lazy-load token-usage summary for the most recent completed interview
    // so the report card can show "1.2M tokens · $3.40 spent · Haiku 92%".
    async function loadTokenUsageForInterview(interviewId) {
        const target = document.getElementById('iv-tokens-' + interviewId);
        if (!target) return;
        try {
            const summary = await api.request(`/hrms/job-applications/interviews/${encodeURIComponent(interviewId)}/token-usage`);
            const totalIn = (summary.total_input || 0) + (summary.total_cache_read || 0) + (summary.total_cache_creation || 0);
            const cachePct = totalIn > 0 ? Math.round((summary.total_cache_read / totalIn) * 100) : 0;
            const cost = Number(summary.total_cost_usd || 0).toFixed(4);
            const fmt = (n) => Number(n).toLocaleString();
            const modelLines = Object.entries(summary.cost_by_model || {})
                .map(([m, c]) => `${escapeHtml(m.replace(/-2025\d+|-2024\d+/g, ''))}: $${Number(c).toFixed(4)}`)
                .join(' · ');
            target.innerHTML = `
                <div style="display: flex; gap: 16px; flex-wrap: wrap; align-items: baseline;">
                    <div><strong>$${cost}</strong> spent · ${summary.total_calls || 0} LLM calls</div>
                    <div style="color: var(--text-secondary);">${fmt(totalIn)} in / ${fmt(summary.total_output || 0)} out · ${cachePct}% cache hit</div>
                    ${modelLines ? `<div style="color: var(--text-secondary); font-size: 0.78rem;">${modelLines}</div>` : ''}
                </div>`;
        } catch (err) {
            // Non-fatal — usage may not have been flushed yet
            target.innerHTML = `<div style="color: var(--text-secondary); font-size: 0.78rem;">Token usage not yet available</div>`;
        }
    }

    function renderInterviewRow(iv, isLatest) {
        const status = iv.status || 'scheduled';
        const statusBadge = `<span class="rec-badge rec-badge-${escapeAttr(status)}">${escapeHtml(status)}</span>`;
        let topicsSeeded = [];
        try { topicsSeeded = JSON.parse(iv.topics_seeded || '[]'); } catch { /* ignore */ }
        const meta = `Scheduled ${formatDate(iv.scheduled_at || iv.created_at, true)} · ${topicsSeeded.length} topic${topicsSeeded.length===1?'':'s'} seeded`;
        // v3 — round chip (HR Screen / Tech Round #2 / etc.) shown left of status.
        const roundLabel = iv.round_label || (function () {
            const labels = { hr_screen:'HR Screen', technical:'Technical', tech_panel:'Tech Panel',
                hiring_manager:'Hiring Manager', ceo:'CEO Round', negotiation:'Negotiation',
                final:'Final Round', other:'Round' };
            const base = labels[iv.round_type] || 'Interview';
            return iv.round_index > 1 ? `${base} #${iv.round_index}` : base;
        })();
        const roundChip = `<span style="display: inline-flex; align-items: center; gap: 4px; padding: 5px 12px; border-radius: 999px; font-size: 0.76rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; background: rgba(139,92,246,0.16); color: #c4b5fd; border: 1px solid rgba(139,92,246,0.28);">${escapeHtml(roundLabel)}</span>`;

        // Top row: round chip + status + meta + Join+Copy+Email trio.
        // The dropdown markup mirrors PMS (.pms-meeting-dropdown / .pms-meeting-menu)
        // so the styles + JS hooks are shared. Per-row menuId so multiple rounds
        // in the timeline don't collide on toggle.
        const menuId = `recIvMenu_${iv.id}`;
        const meetingCta = iv.meeting_id
            ? `<div class="pms-meeting-dropdown" style="margin-left: auto;">
                 <a class="rec-btn rec-btn-sm rec-btn-primary" href="${escapeAttr(iv.meeting_url || '#')}" target="_blank" rel="noopener" style="padding: 7px 14px;">
                   <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>
                   Join Meeting
                 </a>
                 <button type="button" class="rec-btn rec-btn-sm rec-btn-primary pms-meeting-dropdown-toggle" onclick="toggleRecruitMeetingDropdown(event, '${menuId}')" title="Share">
                   <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/></svg>
                 </button>
                 <div class="pms-meeting-menu" id="${menuId}">
                   <button type="button" onclick="recruitCopyMeetingLink('${escapeAttr(iv.meeting_id)}')">
                     <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
                     Copy Guest Link
                   </button>
                   <button type="button" onclick="recruitCopyEmailCard('${escapeAttr(iv.meeting_id)}', '${escapeAttr(iv.candidate_name || activeApplication?.applicant_name || 'Candidate')}', '${escapeAttr(iv.posting_title || activeApplication?.job_title || 'Interview')}', '${escapeAttr(roundLabel)}')">
                     <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
                     Guest Email Card
                   </button>
                 </div>
               </div>`
            : '';
        const topRow = `
            <div style="display: flex; align-items: center; gap: 14px; flex-wrap: wrap; margin-bottom: 18px;">
                ${roundChip}
                ${statusBadge}
                <span style="color: var(--text-secondary); font-size: 0.86rem;">${escapeHtml(meta)}</span>
                ${meetingCta}
            </div>`;

        // Topics seeded chips
        const topicChips = topicsSeeded.length
            ? `<div style="display: flex; gap: 8px; flex-wrap: wrap; margin: 0;">
                 ${topicsSeeded.map(t => `<span class="rec-badge rec-badge-new" style="font-weight: 400; padding: 5px 12px;">${escapeHtml(t)}</span>`).join('')}
               </div>` : '';

        // Report block — only when complete
        let reportBlock = '';
        if (status === 'completed' && isLatest) {
            let topicsCovered = [], redFlags = [], strengths = [];
            try { topicsCovered = JSON.parse(iv.topics_covered || '[]'); } catch { /* ignore */ }
            try { redFlags = JSON.parse(iv.red_flags || '[]'); } catch { /* ignore */ }
            try { strengths = JSON.parse(iv.strengths || '[]'); } catch { /* ignore */ }
            const recColors = { proceed: '#22c55e', second_round: '#fbbf24', reject: '#ff4757', inconclusive: '#94a3b8' };
            const rec = iv.overall_recommendation || 'inconclusive';
            const recColor = recColors[rec] || '#94a3b8';

            const topicBars = topicsCovered.length
                ? `<table class="rec-mini-table" style="margin-top: 8px;">
                     <thead><tr><th>Topic</th><th>Depth reached</th><th>Score</th><th>Notes</th></tr></thead>
                     <tbody>${topicsCovered.map(t => `
                        <tr>
                          <td>${escapeHtml(t.label || '')}</td>
                          <td>${(t.depth_reached || 0)}/3</td>
                          <td>${(t.depth_score_1_5 || '')}/5</td>
                          <td style="color: var(--text-secondary);">${escapeHtml(t.notes || '')}</td>
                        </tr>`).join('')}</tbody>
                   </table>` : '';

            reportBlock = `
                <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; margin-top: 12px;">
                    <div class="rec-stat-card" style="border-left: 4px solid ${recColor};">
                        <div class="rec-stat-label">RECOMMENDATION</div>
                        <div class="rec-stat-value" style="font-size: 1.2rem; font-weight: 600; text-transform: uppercase; color: ${recColor};">
                            ${escapeHtml((rec || '').replace(/_/g, ' '))}
                        </div>
                        <div class="rec-stat-sub">Overall score ${(iv.overall_score || '?')}/10</div>
                    </div>
                    <div class="rec-stat-card">
                        <div class="rec-stat-label">SUMMARY</div>
                        <div style="font-size: 0.88rem; line-height: 1.5; color: var(--text-primary); margin-top: 4px;">
                            ${escapeHtml(iv.summary_text || '(No summary text)')}
                        </div>
                    </div>
                </div>
                ${topicBars}
                ${strengths.length ? `<h5 style="margin: 14px 0 6px; font-size: 0.86rem; color: #22c55e;">STRENGTHS</h5>
                    <ul style="margin: 0; padding-left: 20px; color: var(--text-primary); font-size: 0.88rem;">${strengths.map(s => `<li>${escapeHtml(s)}</li>`).join('')}</ul>` : ''}
                ${redFlags.length ? `<h5 style="margin: 14px 0 6px; font-size: 0.86rem; color: #ff4757;">RED FLAGS</h5>
                    <ul style="margin: 0; padding-left: 20px; color: var(--text-primary); font-size: 0.88rem;">${redFlags.map(f => `<li>${escapeHtml(f)}</li>`).join('')}</ul>` : ''}
                <div id="iv-tokens-${escapeAttr(iv.id)}" style="margin-top: 14px; padding-top: 12px; border-top: 1px dashed var(--border-color); font-size: 0.84rem; color: var(--text-primary);">
                    <div style="color: var(--text-secondary); font-size: 0.78rem;">Loading token usage…</div>
                </div>
            `;
        } else if (status === 'scheduled' || status === 'in_progress') {
            // Show seeded topic queue as a preview of what the Copilot will probe
            reportBlock = topicChips
                ? `<h5 style="margin: 0 0 12px; font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-secondary); font-weight: 600;">Topics the AI will probe</h5>${topicChips}`
                : '';
        }

        // Wrap every interview row in a soft card so the panel is scannable.
        // Older rounds get a slightly muted border to recede visually.
        const wrapStyle = isLatest
            ? 'background: var(--bg-card-elevated, rgba(255,255,255,0.02)); border: 1px solid var(--border-color); border-radius: 10px; padding: 18px 20px;'
            : 'background: rgba(0,0,0,0.10); border: 1px solid var(--border-color); border-radius: 10px; padding: 16px 18px; opacity: 0.92;';
        return `<div style="${wrapStyle}">${topRow}${reportBlock}</div>`;
    }

    // Picker-aware schedule. `startNow=true` skips the picker entirely (legacy
    // one-click flow). Otherwise reads the datetime input + invite checkbox.
    window.scheduleInterviewWithPicker = async function (applicationId, startNow) {
        const btn = event?.target?.closest('button');
        const origText = btn?.innerHTML;
        if (btn) { btn.disabled = true; btn.innerHTML = 'Scheduling…'; }
        let scheduledAtIso = null;
        let sendInvite = true;
        let roundType = null;
        let roundLabel = null;
        // The round picker is in the form regardless of startNow=true.
        const roundTypeInput = document.getElementById('ivRoundType');
        const roundLabelInput = document.getElementById('ivRoundLabel');
        if (roundTypeInput?.value) roundType = roundTypeInput.value;
        if (roundLabelInput?.value && roundLabelInput.value.trim()) roundLabel = roundLabelInput.value.trim();
        if (!startNow) {
            // Date + time pair (matches HRMS employee meeting picker).
            const dateInput = document.getElementById('ivScheduleDate');
            const timeInput = document.getElementById('ivScheduleTime');
            const inviteInput = document.getElementById('ivSendInvite');
            sendInvite = !!inviteInput?.checked;
            const dateVal = dateInput?.value;
            const timeVal = timeInput?.value;
            if (dateVal && timeVal) {
                // Combine into a naive local datetime, then serialise as UTC.
                // Browser's `new Date("YYYY-MM-DDTHH:mm")` interprets that
                // string as the user's local timezone — exactly what we want
                // since the user picked the time in their own clock.
                const d = new Date(`${dateVal}T${timeVal}`);
                if (!Number.isNaN(d.getTime())) scheduledAtIso = d.toISOString();
            } else if (dateVal || timeVal) {
                Toast?.warning?.('Please pick BOTH a date and a time');
                return;
            }
        }
        try {
            const body = { send_invite_email: sendInvite };
            if (scheduledAtIso) body.scheduled_at = scheduledAtIso;
            if (roundType) body.round_type = roundType;
            if (roundLabel) body.round_label = roundLabel;
            const result = await api.request(`/hrms/job-applications/${encodeURIComponent(applicationId)}/schedule-interview`, {
                method: 'POST',
                body: JSON.stringify(body)
            });
            Toast?.success?.(startNow
                ? 'Interview started — opening meeting now'
                : 'Interview scheduled — invite sent to candidate');
            // Refresh drawer state so the panel flips from form -> scheduled view
            await loadApplicationInterviews(applicationId);
            try {
                const refreshed = await api.request(`/hrms/job-applications/${encodeURIComponent(applicationId)}`);
                activeApplication = refreshed;
                const badge = document.getElementById('appDrawerStatus');
                if (badge) {
                    badge.textContent = refreshed.status;
                    badge.className = 'rec-badge rec-badge-' + (refreshed.status || 'new');
                }
                dd.appDrawerStatusSelect?.setValue(refreshed.status || 'new');
            } catch { /* non-fatal */ }
            // Open the meeting in a new tab only on "start now". For a future-
            // dated schedule, host doesn't want a window pop now.
            if (startNow && result?.meeting_url) window.open(result.meeting_url, '_blank');
        } catch (err) {
            Toast?.error?.(err?.message || 'Failed to schedule interview');
            if (btn) { btn.disabled = false; btn.innerHTML = origText; }
        }
    };

    // Back-compat shim — anything that called the old name still works.
    window.scheduleInterviewNow = (applicationId) => window.scheduleInterviewWithPicker(applicationId, true);

    // ─── Per-row Join+Copy+Email dropdown (matches PMS pattern) ────────
    // Each interview row in the Copilot timeline renders a primary "Join Meeting"
    // button + a 3-dot kebab opening "Copy Guest Link" / "Guest Email Card".
    // Mirrors the PMS implementation so the UX feels identical across modules.
    window.toggleRecruitMeetingDropdown = function (e, menuId) {
        e.stopPropagation();
        const menu = document.getElementById(menuId);
        if (!menu) return;
        // Close any other open menus first (page-wide)
        document.querySelectorAll('.pms-meeting-menu.active').forEach(m => {
            if (m.id !== menuId) m.classList.remove('active');
        });
        menu.classList.toggle('active');
    };
    document.addEventListener('click', () => {
        document.querySelectorAll('.pms-meeting-menu.active').forEach(m => m.classList.remove('active'));
    });

    function _recruitGuestLink(meetingId) {
        // Same shape as PMS: guest-join page in Vision, deep-linked by meeting id.
        return `${window.location.origin}/pages/vision/guest-join.html?id=${encodeURIComponent(meetingId)}`;
    }

    window.recruitCopyMeetingLink = function (meetingId) {
        const link = _recruitGuestLink(meetingId);
        navigator.clipboard.writeText(link).then(() => {
            Toast?.success?.('Guest link copied!');
        }).catch(() => {
            // Fallback for older browsers / non-secure contexts
            const ta = document.createElement('textarea');
            ta.value = link; document.body.appendChild(ta); ta.select();
            document.execCommand('copy'); document.body.removeChild(ta);
            Toast?.success?.('Guest link copied!');
        });
        document.querySelectorAll('.pms-meeting-menu.active').forEach(m => m.classList.remove('active'));
    };

    window.recruitCopyEmailCard = function (meetingId, candidateName, postingTitle, roundLabel) {
        if (typeof ShareWidget === 'undefined' || !ShareWidget.buildEmailCard) {
            Toast?.error?.('Email card helper not loaded');
            return;
        }
        const url = _recruitGuestLink(meetingId);
        const title = `${postingTitle} — ${roundLabel || 'Interview'}`;
        const description = `Hi ${candidateName}, here's the link to join your interview on Ragenaizer Vision. The room opens 5 minutes before the scheduled time.`;
        const ogImage = `${window.location.origin}/assets/og-vision.png`;
        const html = ShareWidget.buildEmailCard({ url, title, description, ogImage, btnText: 'Join Interview →' });
        try {
            const blob = new Blob([html], { type: 'text/html' });
            const plainBlob = new Blob([html], { type: 'text/plain' });
            navigator.clipboard.write([
                new ClipboardItem({ 'text/html': blob, 'text/plain': plainBlob })
            ]).then(() => Toast?.success?.('Email card copied — paste into Outlook or Gmail!'))
              .catch(() => navigator.clipboard.writeText(html).then(() => Toast?.success?.('Email card copied!')));
        } catch (err) {
            navigator.clipboard.writeText(html).then(() => Toast?.success?.('Email card copied!'))
                .catch(() => Toast?.error?.('Could not copy'));
        }
        document.querySelectorAll('.pms-meeting-menu.active').forEach(m => m.classList.remove('active'));
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

    // ─── Analytics tab ─────────────────────────────────────────────────
    async function loadDetailAnalytics() {
        if (!activePostingId) return;
        const body = document.getElementById('detailAnalyticsBody');
        const sel = document.getElementById('detailAnalyticsRange');
        const label = document.getElementById('detailAnalyticsRangeLabel');
        const range = parseInt(sel?.value || '30', 10);
        if (label) label.textContent = ' · last ' + range + ' day' + (range === 1 ? '' : 's');
        body.innerHTML = '<div class="rec-loading" id="detailAnalyticsLoading">Loading analytics…</div>';
        try {
            const data = await api.request(`/hrms/job-postings/${encodeURIComponent(activePostingId)}/analytics?rangeDays=${range}`);
            renderDetailAnalytics(data, range);
        } catch (err) {
            console.error('loadDetailAnalytics failed', err);
            body.innerHTML = `<div class="rec-empty"><div>Failed to load analytics. ${escapeHtml(err?.message || '')}</div></div>`;
        }
    }

    function renderDetailAnalytics(d, rangeDays) {
        const s = d.summary || {};
        const fmt = (n) => (n == null ? '0' : Number(n).toLocaleString());
        const fmtMs = (ms) => {
            if (!ms) return '0s';
            const sec = Math.round(ms / 1000);
            if (sec < 60) return sec + 's';
            const m = Math.floor(sec / 60), r = sec % 60;
            return r ? `${m}m ${r}s` : `${m}m`;
        };
        const conversionPct = s.total_views > 0
            ? ((s.submitted_success / s.total_views) * 100).toFixed(1) + '%' : '—';
        const formStartPct = s.total_views > 0
            ? ((s.form_started_count / s.total_views) * 100).toFixed(1) + '%' : '—';
        const bouncePct = s.total_views > 0
            ? ((s.bounce_count / s.total_views) * 100).toFixed(1) + '%' : '—';

        // KPI cards (3-row × 4-col layout, falls to 2-col on mobile via the
        // existing rec-stat-grid styling).
        const kpis = `
          <div class="rec-stats-row">
            <div class="rec-stat-card">
                <div class="rec-stat-label">TOTAL VIEWS</div>
                <div class="rec-stat-value">${fmt(s.total_views)}</div>
                <div class="rec-stat-sub"><span style="color:#22c55e">●</span> ${fmt(s.active_now)} active now · ${fmt(s.unique_today)} today</div>
            </div>
            <div class="rec-stat-card">
                <div class="rec-stat-label">UNIQUE VISITORS</div>
                <div class="rec-stat-value">${fmt(s.unique_visitors)}</div>
                <div class="rec-stat-sub">${fmt(s.unique_ips)} unique IP${s.unique_ips === 1 ? '' : 's'}</div>
            </div>
            <div class="rec-stat-card">
                <div class="rec-stat-label">FORM START RATE</div>
                <div class="rec-stat-value">${formStartPct}</div>
                <div class="rec-stat-sub">${fmt(s.form_started_count)} of ${fmt(s.total_views)} started filling</div>
            </div>
            <div class="rec-stat-card">
                <div class="rec-stat-label">CONVERSION</div>
                <div class="rec-stat-value">${conversionPct}</div>
                <div class="rec-stat-sub">${fmt(s.submitted_success)} applied · ${fmt(s.submitted_total - s.submitted_success)} failed</div>
            </div>
          </div>
          <div class="rec-stats-row" style="margin-top: 12px;">
            <div class="rec-stat-card">
                <div class="rec-stat-label">AVG TIME ON PAGE</div>
                <div class="rec-stat-value">${fmtMs(s.avg_duration_ms)}</div>
                <div class="rec-stat-sub">p50 ${fmtMs(s.p50_duration_ms)} · p95 ${fmtMs(s.p95_duration_ms)}</div>
            </div>
            <div class="rec-stat-card">
                <div class="rec-stat-label">BOUNCE RATE</div>
                <div class="rec-stat-value">${bouncePct}</div>
                <div class="rec-stat-sub">&lt;15s and didn't start</div>
            </div>
            <div class="rec-stat-card">
                <div class="rec-stat-label">SHARES</div>
                <div class="rec-stat-value">${fmt(s.share_count)}</div>
                <div class="rec-stat-sub">${fmt(s.referred_visits)} inbound via ?via=</div>
            </div>
            <div class="rec-stat-card">
                <div class="rec-stat-label">DEVICES</div>
                <div class="rec-stat-value" style="font-size: 1rem; font-weight: 500; line-height: 1.4;">${renderDeviceMix(d.device_breakdown)}</div>
                <div class="rec-stat-sub">&nbsp;</div>
            </div>
          </div>
        `;

        const dailyChart = renderDailySparkBars(d.daily || []);
        const ipsTable = renderIpsTable(d.top_ips || []);
        const refTable = renderListTable('Referrer', d.top_referrers || [], 'referrer', 'count');
        const utmTable = renderUtmTable(d.top_utm_sources || []);
        const shareTable = renderKVPairs('Channel', d.share_channels || {}, true);
        const outcomeTable = renderKVPairs('Outcome', d.submit_outcomes || {});
        const dropOff = renderKVPairs('Last field touched', d.drop_off_fields || {});

        document.getElementById('detailAnalyticsBody').innerHTML = `
            ${kpis}
            <div class="rec-analytics-grid">
                <div class="rec-analytics-block" style="grid-column: 1 / -1;">
                    <h4>Daily activity</h4>
                    ${dailyChart}
                </div>
                <div class="rec-analytics-block">
                    <h4>Top IPs <span class="rec-analytics-sub">(${(d.top_ips || []).length})</span></h4>
                    ${ipsTable}
                </div>
                <div class="rec-analytics-block">
                    <h4>Top referrers</h4>
                    ${refTable}
                </div>
                <div class="rec-analytics-block">
                    <h4>UTM sources</h4>
                    ${utmTable}
                </div>
                <div class="rec-analytics-block">
                    <h4>Share channels</h4>
                    ${shareTable}
                </div>
                <div class="rec-analytics-block">
                    <h4>Submit outcomes</h4>
                    ${outcomeTable}
                </div>
                <div class="rec-analytics-block">
                    <h4>Drop-off fields <span class="rec-analytics-sub">(last field touched before leaving without submitting)</span></h4>
                    ${dropOff}
                </div>
            </div>
        `;
    }

    function renderDeviceMix(map) {
        const order = ['desktop', 'mobile', 'tablet'];
        const total = Object.values(map || {}).reduce((a, b) => a + b, 0);
        if (!total) return '<span style="color: var(--text-secondary);">—</span>';
        return order
            .filter(k => map[k])
            .map(k => `${escapeHtml(k)} <strong>${Math.round(map[k] / total * 100)}%</strong>`)
            .join(' · ') || '—';
    }

    function renderDailySparkBars(daily) {
        if (!daily.length) return '<div class="rec-empty-mini">No visits yet.</div>';
        const max = Math.max(1, ...daily.map(d => d.views));
        const bars = daily.map(d => {
            const h = Math.round((d.views / max) * 100);
            const submitH = Math.round((d.submits / max) * 100);
            return `<div class="rec-spark-day" title="${escapeAttr(d.day)}: ${d.views} view${d.views===1?'':'s'}, ${d.unique_visitors} unique, ${d.submits} submit${d.submits===1?'':'s'}">
                <div class="rec-spark-fill" style="height:${h}%"></div>
                <div class="rec-spark-fill rec-spark-submit" style="height:${submitH}%"></div>
            </div>`;
        }).join('');
        // Date range labels under the bars (first + last)
        const first = daily[0]?.day || '';
        const last = daily[daily.length - 1]?.day || '';
        return `
            <div class="rec-spark-bars">${bars}</div>
            <div class="rec-spark-labels">
                <span>${escapeHtml(first)}</span>
                <span style="font-size: 0.7rem;"><span class="rec-spark-legend-views"></span> views &nbsp;<span class="rec-spark-legend-submits"></span> submits</span>
                <span>${escapeHtml(last)}</span>
            </div>`;
    }

    function renderIpsTable(rows) {
        if (!rows.length) return '<div class="rec-empty-mini">No IPs recorded yet.</div>';
        return `<table class="rec-mini-table">
            <thead><tr><th>IP</th><th>Visits</th><th>Visitors</th><th>Last seen</th></tr></thead>
            <tbody>${rows.map(r => `
                <tr>
                    <td><code>${escapeHtml(r.source_ip)}</code></td>
                    <td>${r.visits}</td>
                    <td>${r.distinct_visitors}</td>
                    <td>${formatDate(r.last_seen, true)}</td>
                </tr>`).join('')}</tbody>
        </table>`;
    }

    function renderListTable(col, rows, keyField, valueField) {
        if (!rows.length) return '<div class="rec-empty-mini">None recorded yet.</div>';
        return `<table class="rec-mini-table">
            <thead><tr><th>${col}</th><th>Count</th></tr></thead>
            <tbody>${rows.map(r => `
                <tr><td>${escapeHtml(String(r[keyField] || '').slice(0, 80))}</td><td>${r[valueField]}</td></tr>
            `).join('')}</tbody>
        </table>`;
    }

    function renderUtmTable(rows) {
        if (!rows.length) return '<div class="rec-empty-mini">No UTM-tagged inbound traffic yet.</div>';
        return `<table class="rec-mini-table">
            <thead><tr><th>Source</th><th>Medium</th><th>Campaign</th><th>Count</th></tr></thead>
            <tbody>${rows.map(r => `
                <tr>
                    <td>${escapeHtml(r.utm_source || '')}</td>
                    <td>${escapeHtml(r.utm_medium || '—')}</td>
                    <td>${escapeHtml(r.utm_campaign || '—')}</td>
                    <td>${r.count}</td>
                </tr>`).join('')}</tbody>
        </table>`;
    }

    function renderKVPairs(col, dict, prettyChannel) {
        const entries = Object.entries(dict || {});
        if (!entries.length) return '<div class="rec-empty-mini">None recorded yet.</div>';
        const labelize = (k) => prettyChannel
            ? ({copy_link:'Copy link', linkedin:'LinkedIn', twitter:'X / Twitter', native_share:'Native share', email:'Email'}[k] || k)
            : k;
        return `<table class="rec-mini-table">
            <thead><tr><th>${col}</th><th>Count</th></tr></thead>
            <tbody>${entries.map(([k, v]) => `
                <tr><td>${escapeHtml(labelize(k))}</td><td>${v}</td></tr>
            `).join('')}</tbody>
        </table>`;
    }
})();
