/**
 * CRM Forecast tab — pipeline weighted by stage win-probability, quotas,
 * confidence buckets, and a weekly accuracy chart.
 *
 * Lives on /pages/crm/analytics.html alongside the existing lead-analytics
 * dashboard. The two tabs are independent: the Forecast tab has its own
 * date range + scope picker (team / owner) so users can drill into pipeline
 * without disturbing the lead-side filters.
 *
 * Data source: GET /api/forecast — single composite endpoint that returns
 * KPIs + by-stage / by-owner / by-month / by-category aggregates in one
 * call so every chart on this tab tells the same story for the same window.
 *
 * Charts use ApexCharts (already loaded by analytics.html).
 */

(() => {
    'use strict';

    // Lazy-loaded ApexCharts instances — destroyed + replaced on each
    // re-fetch so axis values track the new window cleanly.
    let _fcMonthChart = null;
    let _fcStageChart = null;
    let _fcCategoryChart = null;
    let _fcAccuracyChart = null;

    let _fcLoaded = false;          // becomes true after first successful load
    let _fcOwnersCache = [];        // resolved {id, name} list for the Owner dropdown
    let _fcTeamsCache = [];         // resolved {id, name} list for the Team dropdown

    // ── Tab switcher (wired to the inline onclick on the tab buttons) ────
    window.switchAnaTab = function(tab) {
        const isFc = tab === 'forecast';
        const isWr = tab === 'weekly';
        const isAn = !isFc && !isWr;

        const setActive = (id, on) => {
            const el = document.getElementById(id);
            if (!el) return;
            el.classList.toggle('active', on);
            el.setAttribute('aria-selected', String(on));
        };
        setActive('anaTabAnalytics', isAn);
        setActive('anaTabForecast', isFc);
        setActive('anaTabWeekly', isWr);

        const setPane = (id, on) => {
            const el = document.getElementById(id);
            if (el) el.style.display = on ? '' : 'none';
        };
        setPane('anaPane-analytics', isAn);
        setPane('anaPane-forecast', isFc);
        setPane('anaPane-weekly', isWr);

        // Lazy first-load on each tab so we don't pay for everything on cold
        // page open. Subsequent tab clicks just toggle visibility.
        if (isFc && !_fcLoaded) {
            populateScopeDropdowns().then(() => loadForecast());
        }
        if (isWr && typeof window.initWeeklyReport === 'function') {
            window.initWeeklyReport();
        }
    };

    // ── Scope dropdowns ───────────────────────────────────────────────────
    async function populateScopeDropdowns() {
        try {
            const teams = await api.request('/crm/teams');
            _fcTeamsCache = (teams || []).map(t => ({ id: t.id, name: t.team_name || t.name || t.id }));
            const teamSel = document.getElementById('fcTeam');
            if (teamSel) {
                for (const t of _fcTeamsCache) {
                    const o = document.createElement('option');
                    o.value = t.id; o.textContent = t.name;
                    teamSel.appendChild(o);
                }
            }
        } catch (e) { console.warn('forecast: load teams failed', e); }

        try {
            // /api/teams/users returns every Auth user with their CRM team
            // assignment. We use it to populate the Owner dropdown + the
            // Quotas modal's user-scope picker. Endpoint requires team-mgmt
            // privileges; if the caller can't see it, the catch swallows.
            const users = await api.request('/crm/teams/users');
            _fcOwnersCache = (users || [])
                .filter(u => u.user_id || u.id)
                .map(u => ({
                    id: u.user_id || u.id,
                    name: u.full_name || (u.first_name ? `${u.first_name} ${u.last_name || ''}`.trim() : (u.email || u.user_id || u.id))
                }));
            const ownerSel = document.getElementById('fcOwner');
            if (ownerSel) {
                for (const u of _fcOwnersCache) {
                    const o = document.createElement('option');
                    o.value = u.id; o.textContent = u.name;
                    ownerSel.appendChild(o);
                }
            }
        } catch (e) { /* /teams/users is admin-only — silently skip if forbidden */ }
    }

    // ── Currency / number helpers ─────────────────────────────────────────
    //
    // ⚠ THIS COMMENT USED TO DESCRIBE A MECHANISM THAT DOES NOT EXIST.
    // It claimed the tenant's home currency was taken "from the first non-empty
    // deal currency we find on the response". Nothing here has ever read a
    // currency, and nothing could: ForecastPayload, ForecastKpis and every row
    // type in CRM/Models/CrmModels.cs carry amounts with NO currency field.
    //
    // ⚠ OPEN, LARGER PROBLEM — NOT FIXED HERE.
    // The forecast SUMS deal_value across every deal in the window regardless of
    // its currency, so in a workspace holding both USD and INR deals the totals
    // are a mixed-currency sum, and rendering it as ₹ labels that sum with one
    // of the currencies that went into it. Fixing it properly needs the API to
    // either return a currency or group by one — a backend change on the
    // analytics surface, deliberately out of scope for the deal-money work that
    // uncovered it. INR is kept as the label rather than silently dropped so the
    // figure does not start looking trustworthy while it is still wrong.
    function fmtCurrency(n) {
        const v = Number(n) || 0;
        try {
            return new Intl.NumberFormat('en-IN', {
                style: 'currency', currency: 'INR',
                maximumFractionDigits: 0
            }).format(v);
        } catch { return v.toLocaleString(); }
    }
    function fmtPct(n) {
        const v = Number(n) || 0;
        return v.toFixed(v < 10 ? 1 : 0) + '%';
    }
    function readDate(id) { return document.getElementById(id)?.value || ''; }

    // ── Data load ─────────────────────────────────────────────────────────
    async function loadForecast() {
        const params = new URLSearchParams();
        const f = readDate('fcFrom');
        const t = readDate('fcTo');
        if (f) params.set('from', f);
        if (t) params.set('to', t);
        const team = document.getElementById('fcTeam')?.value;
        if (team) params.set('teamId', team);
        const owner = document.getElementById('fcOwner')?.value;
        if (owner) params.set('ownerUserId', owner);

        const grid = document.getElementById('fcKpiGrid');
        if (grid) grid.innerHTML = '<div class="ana-loading">Loading…</div>';

        let data;
        try {
            data = await api.request('/crm/forecast?' + params.toString());
        } catch (e) {
            if (grid) grid.innerHTML = `<div class="ana-empty" style="color:var(--color-danger)">Failed to load forecast: ${(e?.message || e)}</div>`;
            return;
        }

        renderKpis(data.kpis || {});
        renderMonthChart(data.by_month || []);
        renderStageChart(data.by_stage || []);
        renderCategoryChart(data.by_category || []);
        renderRepTable(data.by_owner || []);
        loadAccuracy().catch(e => console.warn('forecast accuracy load failed', e));
        _fcLoaded = true;
    }
    window.loadForecast = loadForecast;

    function renderKpis(k) {
        const grid = document.getElementById('fcKpiGrid');
        if (!grid) return;
        // Each tile carries a long-form `info` blurb that renders as the
        // (i) hover tooltip — same UX as the lead-analytics dashboard's
        // KPI cards (data-tooltip + tabindex on .ana-info).
        const tiles = [
            {
                label: 'Open pipeline',
                value: fmtCurrency(k.open_pipeline_value),
                sub: 'Sum of every open deal',
                info: 'Sum of deal_value across every active deal whose stage is type "open" (not won, not lost). Excludes archived deals. The forecast scope filters (date range, team, owner) DON\'T affect this number — it\'s a snapshot of open pipeline as of right now.'
            },
            {
                label: 'Weighted forecast',
                value: fmtCurrency(k.weighted_pipeline_value),
                sub: 'Open × stage win-probability',
                info: 'For each open deal, deal_value × that deal\'s stage win_probability ÷ 100, summed across every open deal in scope. Edit per-stage win_probability under CRM Settings → Pipeline. The realistic forecast number you commit against quota.'
            },
            {
                label: 'Won (in window)',
                value: fmtCurrency(k.won_value_in_window),
                sub: 'Closed-won inside the date range',
                info: 'Deals that reached a "won" stage with actual_close_date inside the From/To window above. Lost deals don\'t count. This is the actual-cash side of the attainment ratio.'
            },
            {
                label: 'Quota target',
                value: fmtCurrency(k.quota_target),
                sub: k.quota_target > 0 ? `${fmtPct(k.quota_attainment_pct)} attained` : 'No matching quota',
                info: 'Sum of every quota row whose period overlaps the From/To window AND whose scope matches your current Team / Owner filter (or tenant-wide when no filter). Manage quotas via the Quotas button on the toolbar. Attainment % = Won ÷ Quota.'
            }
        ];
        grid.innerHTML = tiles.map(t => `
            <div class="ana-kpi-card">
                <div class="fc-kpi-label">
                    ${escapeHtml(t.label)}
                    <button type="button" class="ana-info"
                            data-tooltip="${escapeAttr(t.info)}"
                            aria-label="What is ${escapeAttr(t.label)}?"
                            tabindex="0">i</button>
                </div>
                <div class="fc-kpi-value">${escapeHtml(t.value)}</div>
                <div class="fc-kpi-sub">${escapeHtml(t.sub)}</div>
            </div>`).join('');
    }

    function escapeAttr(s) {
        return escapeHtml(s);
    }

    function renderMonthChart(rows) {
        if (_fcMonthChart) { _fcMonthChart.destroy(); _fcMonthChart = null; }
        const el = document.getElementById('fcMonthChart');
        if (!el) return;
        const cats = rows.map(r => r.month);
        const open     = rows.map(r => Number(r.open_value     || 0));
        const weighted = rows.map(r => Number(r.weighted_value || 0));
        const won      = rows.map(r => Number(r.won_value_in_window || 0));
        const quota    = rows.map(r => Number(r.quota_target   || 0));
        const opts = {
            chart: { type: 'bar', height: 280, toolbar: { show: false }, background: 'transparent', stacked: false },
            theme: { mode: 'dark' },
            series: [
                { name: 'Open',     data: open,     type: 'bar' },
                { name: 'Weighted', data: weighted, type: 'bar' },
                { name: 'Won',      data: won,      type: 'bar' },
                { name: 'Quota',    data: quota,    type: 'line' }
            ],
            stroke: { width: [0, 0, 0, 3], curve: 'smooth', dashArray: [0, 0, 0, 6] },
            colors: ['#60a5fa', '#a78bfa', '#34d399', '#f59e0b'],
            plotOptions: { bar: { columnWidth: '45%', borderRadius: 4 } },
            xaxis: { categories: cats, labels: { style: { colors: 'var(--text-secondary)' } } },
            yaxis: { labels: { style: { colors: 'var(--text-secondary)' }, formatter: v => fmtCurrency(v) } },
            tooltip: { theme: 'dark', y: { formatter: v => fmtCurrency(v) } },
            legend: { position: 'top', labels: { colors: 'var(--text-secondary)' } },
            grid: { borderColor: 'rgba(255,255,255,0.08)' }
        };
        _fcMonthChart = new ApexCharts(el, opts);
        _fcMonthChart.render();
    }

    function renderStageChart(rows) {
        if (_fcStageChart) { _fcStageChart.destroy(); _fcStageChart = null; }
        const el = document.getElementById('fcStageChart');
        if (!el) return;
        // Only the open stages — won + lost are zero by definition for the
        // open-pipeline columns.
        const openRows = rows.filter(r => r.stage_type === 'open');
        const cats = openRows.map(r => `${r.stage_name} (${Number(r.win_probability)}%)`);
        const open     = openRows.map(r => Number(r.open_value     || 0));
        const weighted = openRows.map(r => Number(r.weighted_value || 0));
        const opts = {
            chart: { type: 'bar', height: 240, toolbar: { show: false }, background: 'transparent' },
            theme: { mode: 'dark' },
            series: [
                { name: 'Open',     data: open },
                { name: 'Weighted', data: weighted }
            ],
            colors: ['#60a5fa', '#a78bfa'],
            plotOptions: { bar: { horizontal: true, borderRadius: 4, dataLabels: { position: 'top' } } },
            xaxis: { labels: { style: { colors: 'var(--text-secondary)' }, formatter: v => fmtCurrency(v) } },
            yaxis: { labels: { style: { colors: 'var(--text-secondary)' } } },
            tooltip: { theme: 'dark', y: { formatter: v => fmtCurrency(v) } },
            legend: { position: 'top', labels: { colors: 'var(--text-secondary)' } },
            grid: { borderColor: 'rgba(255,255,255,0.08)' }
        };
        _fcStageChart = new ApexCharts(el, opts);
        _fcStageChart.render();
    }

    function renderCategoryChart(rows) {
        if (_fcCategoryChart) { _fcCategoryChart.destroy(); _fcCategoryChart = null; }
        const el = document.getElementById('fcCategoryChart');
        if (!el) return;
        // Stable display order regardless of API row order.
        const order = ['commit', 'most_likely', 'best_case', 'omitted', 'uncategorised'];
        const labels = { commit: 'Commit', most_likely: 'Most likely', best_case: 'Best case', omitted: 'Omitted', uncategorised: 'Uncategorised' };
        const ordered = order
            .map(c => rows.find(r => r.category === c))
            .filter(Boolean);
        const cats = ordered.map(r => labels[r.category] || r.category);
        const weighted = ordered.map(r => Number(r.weighted_value || 0));
        const opts = {
            chart: { type: 'donut', height: 240, toolbar: { show: false }, background: 'transparent' },
            theme: { mode: 'dark' },
            labels: cats,
            series: weighted,
            colors: ['#34d399', '#60a5fa', '#facc15', '#94a3b8', '#a78bfa'],
            legend: { position: 'bottom', labels: { colors: 'var(--text-secondary)' } },
            tooltip: { theme: 'dark', y: { formatter: v => fmtCurrency(v) } },
            dataLabels: { enabled: false },
            plotOptions: { pie: { donut: { labels: { show: true, total: { show: true, label: 'Weighted', formatter: () => fmtCurrency(weighted.reduce((a,b)=>a+b,0)) } } } } }
        };
        _fcCategoryChart = new ApexCharts(el, opts);
        _fcCategoryChart.render();
    }

    function renderRepTable(rows) {
        const tbody = document.querySelector('#fcRepTable tbody');
        if (!tbody) return;
        if (rows.length === 0) {
            tbody.innerHTML = '<tr><td colspan="7" class="ana-empty">No deals in this scope.</td></tr>';
            return;
        }
        tbody.innerHTML = rows.map(r => {
            const name = r.owner_name || (r.owner_user_id ? r.owner_user_id.slice(0, 8) + '…' : '(Unassigned)');
            const att = Number(r.attainment_pct || 0);
            const attCls = att >= 80 ? 'fc-good' : (att >= 50 ? 'fc-mid' : 'fc-low');
            return `<tr>
                <td>${escapeHtml(name)}</td>
                <td class="num">${r.open_deals || 0}</td>
                <td class="num">${escapeHtml(fmtCurrency(r.open_value))}</td>
                <td class="num">${escapeHtml(fmtCurrency(r.weighted_value))}</td>
                <td class="num">${escapeHtml(fmtCurrency(r.won_value_in_window))}</td>
                <td class="num">${escapeHtml(fmtCurrency(r.quota_target))}</td>
                <td class="num"><span class="${attCls}">${escapeHtml(fmtPct(att))}</span></td>
            </tr>`;
        }).join('');
    }

    async function loadAccuracy() {
        if (_fcAccuracyChart) { _fcAccuracyChart.destroy(); _fcAccuracyChart = null; }
        const el = document.getElementById('fcAccuracyChart');
        const hint = document.getElementById('fcAccuracyHint');
        if (!el) return;
        const data = await api.request('/crm/forecast/history?weeks=12');
        if (!Array.isArray(data) || data.length === 0) {
            el.innerHTML = '';
            if (hint) hint.style.display = '';
            return;
        }
        if (hint) hint.style.display = 'none';
        const cats = data.map(r => (r.snapshot_date || '').slice(0, 10));
        const weighted = data.map(r => Number(r.weighted_pipeline || 0));
        const cumulativeWon = data.map(r => Number(r.cumulative_won_since_snapshot || 0));
        const opts = {
            chart: { type: 'line', height: 260, toolbar: { show: false }, background: 'transparent' },
            theme: { mode: 'dark' },
            series: [
                { name: 'Weighted forecast (as of)', data: weighted, type: 'line' },
                { name: 'Closed-won since',          data: cumulativeWon, type: 'line' }
            ],
            colors: ['#a78bfa', '#34d399'],
            stroke: { width: [3, 3], curve: 'smooth' },
            markers: { size: 4 },
            xaxis: { categories: cats, labels: { style: { colors: 'var(--text-secondary)' } } },
            yaxis: { labels: { style: { colors: 'var(--text-secondary)' }, formatter: v => fmtCurrency(v) } },
            tooltip: { theme: 'dark', y: { formatter: v => fmtCurrency(v) } },
            legend: { position: 'top', labels: { colors: 'var(--text-secondary)' } },
            grid: { borderColor: 'rgba(255,255,255,0.08)' }
        };
        _fcAccuracyChart = new ApexCharts(el, opts);
        _fcAccuracyChart.render();
    }

    // ── Quotas modal ──────────────────────────────────────────────────────
    let _quotasCache = [];

    window.openQuotasModal = async function() {
        document.getElementById('quotasModal').classList.add('active');
        document.body.style.overflow = 'hidden';
        await refreshQuotaScopeIdSelect();
        await loadQuotas();
    };
    window.closeQuotasModal = function() {
        document.getElementById('quotasModal').classList.remove('active');
        document.body.style.overflow = '';
        // Re-fetch the forecast in case quotas changed (lazy refresh).
        if (_fcLoaded) loadForecast();
    };
    window.qScopeChanged = async function() {
        await refreshQuotaScopeIdSelect();
    };

    async function refreshQuotaScopeIdSelect() {
        const scope = document.getElementById('qScopeType').value;
        const wrap = document.getElementById('qScopeIdField');
        const sel  = document.getElementById('qScopeId');
        if (scope === 'tenant') {
            wrap.style.display = 'none';
            sel.innerHTML = '';
            return;
        }
        wrap.style.display = '';
        sel.innerHTML = '';
        const list = scope === 'team' ? _fcTeamsCache : _fcOwnersCache;
        for (const item of list) {
            const o = document.createElement('option');
            o.value = item.id; o.textContent = item.name;
            sel.appendChild(o);
        }
    }

    async function loadQuotas() {
        const tbody = document.querySelector('#qList tbody');
        if (!tbody) return;
        tbody.innerHTML = '<tr><td colspan="5" class="ana-empty">Loading…</td></tr>';
        try {
            _quotasCache = await api.request('/crm/forecast/quotas');
            if (!Array.isArray(_quotasCache) || _quotasCache.length === 0) {
                tbody.innerHTML = '<tr><td colspan="5" class="ana-empty">No quotas yet — add one above.</td></tr>';
                return;
            }
            tbody.innerHTML = _quotasCache.map(q => `
                <tr>
                    <td>${escapeHtml(q.scope_label || q.scope_type)}</td>
                    <td>${escapeHtml((q.period_start || '').slice(0,10))} → ${escapeHtml((q.period_end || '').slice(0,10))}</td>
                    <td class="num">${escapeHtml(fmtCurrency(q.target_value))}</td>
                    <td>${escapeHtml(q.target_metric)}</td>
                    <td><button type="button" class="btn btn-sm btn-outline-danger" onclick="window.deleteQuota('${q.id}')">Delete</button></td>
                </tr>`).join('');
        } catch (e) {
            tbody.innerHTML = `<tr><td colspan="5" class="ana-empty" style="color:var(--color-danger)">${escapeHtml(e?.message || String(e))}</td></tr>`;
        }
    }

    window.saveQuota = async function() {
        const body = {
            scope_type: document.getElementById('qScopeType').value,
            scope_id: document.getElementById('qScopeId').value || null,
            period_start: document.getElementById('qStart').value,
            period_end: document.getElementById('qEnd').value,
            target_value: Number(document.getElementById('qValue').value || 0),
            target_metric: 'won_value'
        };
        if (body.scope_type === 'tenant') body.scope_id = null;
        if (!body.period_start || !body.period_end) {
            alert('Pick both period start and end dates.');
            return;
        }
        try {
            await api.request('/crm/forecast/quotas', { method: 'POST', body: JSON.stringify(body) });
            // Reset the form
            document.getElementById('qValue').value = '';
            await loadQuotas();
        } catch (e) {
            alert('Failed to save quota: ' + (e?.message || e));
        }
    };

    window.deleteQuota = async function(id) {
        if (!confirm('Delete this quota?')) return;
        try {
            await api.request('/crm/forecast/quotas/' + encodeURIComponent(id), { method: 'DELETE' });
            await loadQuotas();
        } catch (e) {
            alert('Failed to delete: ' + (e?.message || e));
        }
    };

    // Lightweight escape — analytics.js exports its own but it loads after
    // this script in the analytics.html script chain, so duplicate to be safe.
    function escapeHtml(s) {
        if (s === null || s === undefined) return '';
        return String(s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }
})();
