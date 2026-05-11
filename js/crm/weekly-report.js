/**
 * Weekly Report tab — slide-style performance deck. Sits next to the
 * Lead-analytics and Forecast tabs on the analytics page. The deck
 * structure is industry-agnostic — every label that names the
 * people-axis or the breakdown-axis comes from tenant settings, so the
 * same template renders meaningfully for any vertical (a SaaS sales
 * team, an education academy, a real-estate agency, a recruiting firm,
 * etc.). The three tenant-configurable settings:
 *
 *   report_owner_label      → e.g. "Salesperson" (default), or whatever
 *                              your team calls the person who owns a lead
 *   report_dimension_label  → e.g. "Source" (default), or your team's
 *                              name for the breakdown column
 *   report_dimension_field  → which CRM column drives the breakdown:
 *                              lead_source | source_prefix | team |
 *                              product_interest | lf_<custom_field_code>
 *
 * Backend: GET /api/reports/weekly?from=&to=&dimensionField=&teamId=
 * Returns totals + per-dimension + per-owner + owner×dimension matrix with
 * 5 outcome buckets (Connected / Hot / Followups / NoResponse / NotInterested).
 *
 * Print: clicking "Print / Save as PDF" opens a new window with the same
 * deck rendered in print-friendly CSS (each card forces a new page).
 */
(function () {
    'use strict';

    // ── Console filter for ApexCharts internal NaN warnings ───────────────
    // ApexCharts emits a burst of "M NaN NaN" SVG attribute warnings during
    // its internal init pass — fires *inside* the lib's first measurement
    // microtask before any of our code can intervene. Multiple workarounds
    // (lib upgrade, ResizeObserver, animations off, pre-computed pixel
    // widths) all fail to silence them because the lib intentionally sets
    // attrs to NaN and patches them up later in the same render cycle.
    //
    // These are non-fatal — charts render correctly. The patch below
    // suppresses ONLY the specific apexcharts NaN-attribute warnings; any
    // other console.error (including non-NaN apexcharts errors) passes
    // through untouched.
    (function silenceApexNaN() {
        if (typeof console === 'undefined' || console.__apexNaNPatched) return;
        const orig = console.error.bind(console);
        const NAN_ATTR = /Expected (?:number|length).*"(?:M\s+)?NaN/i;
        console.error = function (...args) {
            try {
                const blob = args.map(a => {
                    if (a == null) return '';
                    if (typeof a === 'string') return a;
                    if (a instanceof Error) return a.message + ' ' + (a.stack || '');
                    return String(a);
                }).join(' ');
                if (NAN_ATTR.test(blob)) return; // swallow only the NaN warnings
            } catch (_) { /* fall through */ }
            orig.apply(console, args);
        };
        console.__apexNaNPatched = true;
    })();


    // ── State ──────────────────────────────────────────────────────────────
    let _initialized = false;
    let _settings = {
        ownerLabel: 'Salesperson',
        dimensionLabel: 'Source',
        dimensionField: 'lead_source'
    };
    let _customFields = [];     // [{ code, label, options:[{code,label}] }]
    let _teams = [];            // [{ id, team_name }]
    let _lastPayload = null;    // Cached so print uses the same data the user sees.

    // ── Public entry — fires once when the tab is first opened ─────────────
    window.initWeeklyReport = async function () {
        if (_initialized) return;
        _initialized = true;
        try {
            await Promise.all([loadSettings(), loadCustomFields(), loadTeams()]);
            seedToolbar();
            await loadWeeklyReport();
        } catch (err) {
            console.error('[weekly-report] init failed', err);
            const deck = document.getElementById('wrDeck');
            if (deck) deck.innerHTML = `<div class="wr-empty">Failed to load report — ${escapeHtml(err.message || err)}</div>`;
        }
    };

    // ── Toolbar wiring ─────────────────────────────────────────────────────
    function seedToolbar() {
        const fromEl = document.getElementById('wrFrom');
        const toEl   = document.getElementById('wrTo');
        if (fromEl && !fromEl.value) fromEl.value = isoDate(currentMonday());
        if (toEl   && !toEl.value)   toEl.value   = isoDate(nextSunday());

        // Append the tenant's custom dropdown fields as dimension options —
        // so a tenant with a custom field like "Region", "Plan tier",
        // "Course", "Property type", etc. can pivot the report by that
        // field. Matches the Settings → General dropdown.
        const sel = document.getElementById('wrDimensionField');
        if (sel) {
            for (const f of _customFields) {
                if (!f.code || !f.label) continue;
                const opt = document.createElement('option');
                opt.value = `lf_${f.code}`;
                opt.textContent = `${f.label} (custom)`;
                sel.appendChild(opt);
            }
            sel.value = _settings.dimensionField;
        }

        const teamSel = document.getElementById('wrTeam');
        if (teamSel) {
            for (const t of _teams) {
                const o = document.createElement('option');
                o.value = t.id; o.textContent = t.team_name || t.name || t.id;
                teamSel.appendChild(o);
            }
        }
    }

    async function loadSettings() {
        try {
            const all = await api.request('/crm/crm-settings');
            const v = all?.settings || all || {};
            _settings.ownerLabel = (v.report_owner_label || 'Salesperson').trim();
            _settings.dimensionLabel = (v.report_dimension_label || 'Source').trim();
            _settings.dimensionField = (v.report_dimension_field || 'lead_source').trim();
        } catch {
            // Defaults stand — the report still renders, just with the
            // generic "Salesperson / Source" labels.
        }
    }

    async function loadCustomFields() {
        try {
            const r = await api.request('/crm/lead-fields?includeInactive=false');
            _customFields = (r?.fields || []).map(f => ({
                code: f.code,
                label: f.label,
                options: f.options || []
            }));
        } catch {
            _customFields = [];
        }
    }

    async function loadTeams() {
        try {
            const r = await api.request('/crm/teams');
            _teams = Array.isArray(r) ? r : (r?.items || r?.data || []);
        } catch {
            _teams = [];
        }
    }

    // ── Data load + render ─────────────────────────────────────────────────
    window.loadWeeklyReport = async function () {
        const deck = document.getElementById('wrDeck');
        if (!deck) return;
        deck.innerHTML = '<div class="wr-loading">Loading weekly report…</div>';

        try {
            const fromEl = document.getElementById('wrFrom');
            const toEl   = document.getElementById('wrTo');
            const dimEl  = document.getElementById('wrDimensionField');
            const teamEl = document.getElementById('wrTeam');

            const from = fromEl?.value ? new Date(fromEl.value + 'T00:00:00').toISOString() : '';
            // To is inclusive in the picker — make the API call exclusive by +1 day.
            const toDateStr = toEl?.value;
            const to = toDateStr
                ? new Date(new Date(toDateStr + 'T00:00:00').getTime() + 86400000).toISOString()
                : '';
            const dim = dimEl?.value || 'lead_source';
            const teamId = teamEl?.value || '';

            const params = new URLSearchParams();
            if (from) params.set('from', from);
            if (to)   params.set('to', to);
            params.set('dimensionField', dim);
            if (teamId) params.set('teamId', teamId);

            const payload = await api.request('/crm/reports/weekly?' + params.toString());
            _lastPayload = payload;
            renderDeck(deck, payload);
        } catch (err) {
            console.error('[weekly-report] load failed', err);
            deck.innerHTML = `<div class="wr-empty">Failed to load: ${escapeHtml(err.message || err)}</div>`;
        }
    };

    // ── Rendering ──────────────────────────────────────────────────────────
    function renderDeck(deck, p) {
        const T = p.totals || {};
        const dims = (p.dimensions || []).filter(d => d.leads > 0);
        const owners = (p.owners || []).filter(o => o.user_id !== '__unassigned__' && o.leads > 0);
        const matrix = p.matrix || [];
        const ownerLabel = _settings.ownerLabel;
        const dimLabel = _settings.dimensionLabel;

        const from = new Date(p.from);
        const to = new Date(p.to);
        const dateLine = formatDateRange(from, to);

        if (T.leads === 0) {
            deck.innerHTML = `<div class="wr-empty">No leads in this window. Pick a different range above.</div>`;
            return;
        }

        // Pre-compute everything we'll quote in insights.
        const connectPct = T.leads ? (100 * T.connected / T.leads) : 0;
        const topOwnerByHot = owners.slice().sort((a, b) => b.hot - a.hot)[0] || null;
        const topOwnerByConnect = owners.slice().sort((a, b) => b.connect_pct - a.connect_pct)[0] || null;
        const heaviestOwner = owners.slice().sort((a, b) => b.leads - a.leads)[0] || null;
        const worstDimByConnect = dims.slice().sort((a, b) => a.connect_pct - b.connect_pct)[0] || null;
        const totalHot = T.hot;
        const hotShare = topOwnerByHot && totalHot > 0 ? Math.round(100 * topOwnerByHot.hot / totalHot) : 0;

        const slides = [];

        // Bucket palette — used by both the strip charts and ApexCharts.
        // Ordered as: Connected, Hot, Follow-up, No Response, Not Interested.
        const BUCKET_COLORS = ['#10b981', '#ef4444', '#f59e0b', '#6b7280', '#7c3aed'];
        const BUCKET_LABELS = ['Connected', 'Hot', 'Follow-up', 'No Response', 'Not Interested'];

        // 1. Cover / executive summary
        slides.push(`
            <section class="wr-slide wr-slide--cover">
                <div class="wr-slide-num">1</div>
                <div class="wr-slide-eyebrow">SNAPSHOT</div>
                <h2 class="wr-slide-title">Executive Summary</h2>
                <p class="wr-slide-subtitle">${escapeHtml(dateLine)} · ${T.leads} total leads · ${dims.length} ${pluralize(dimLabel, dims.length).toLowerCase()} · ${T.active_owners} active ${pluralize(ownerLabel, T.active_owners).toLowerCase()}</p>

                <div class="wr-kpis">
                    ${kpiTile('Total Leads', T.leads, 'All ' + pluralize(dimLabel, dims.length).toLowerCase() + ' combined')}
                    ${kpiTile('Connected', T.connected, fmtPct(connectPct) + ' connection rate')}
                    ${kpiTile('Hot Leads', T.hot, 'Ready to convert')}
                    ${kpiTile('Active ' + pluralize(ownerLabel, T.active_owners), T.active_owners, 'Across ' + dims.length + ' ' + pluralize(dimLabel, dims.length).toLowerCase())}
                </div>

                <div class="wr-takeaways">
                    <h4>KEY TAKEAWAYS</h4>
                    <ol>
                        ${topOwnerByHot && topOwnerByHot.hot > 0
                            ? `<li><strong>${escapeHtml(topOwnerByHot.name)}</strong> leads hot conversions — ${topOwnerByHot.hot} of ${totalHot} hot ${pluralize('lead', totalHot).toLowerCase()} (${hotShare}% of the week's hot pipeline).</li>`
                            : `<li>No hot leads generated this week — review ${pluralize(ownerLabel, 2).toLowerCase()} qualification scripts.</li>`}
                        ${topOwnerByConnect && topOwnerByConnect.connect_pct > 0
                            ? `<li><strong>${escapeHtml(topOwnerByConnect.name)}</strong> has the best reach — ${fmtPct(topOwnerByConnect.connect_pct)} connection rate, top across all ${pluralize(ownerLabel, 2).toLowerCase()}.</li>`
                            : ''}
                        ${T.unassigned > 0
                            ? `<li><strong>${T.unassigned} leads remain unassigned</strong> — distribute promptly to avoid drop-off.</li>`
                            : `<li>Every lead has been assigned — no orphan pipeline.</li>`}
                    </ol>
                </div>
            </section>
        `);

        // 2. Volume mix by dimension
        const top3 = dims.slice(0, 3);
        slides.push(`
            <section class="wr-slide wr-slide--distribution">
                <div class="wr-slide-num">2</div>
                <div class="wr-slide-eyebrow">VOLUME MIX</div>
                <h2 class="wr-slide-title">Lead Distribution by ${escapeHtml(dimLabel)}</h2>
                <div class="wr-dim-grid">
                    ${top3.map((d, i) => dimensionCard(d, T.leads, i)).join('')}
                </div>
                ${dims.length > 3
                    ? `<p class="wr-aside">+ ${dims.length - 3} more ${pluralize(dimLabel, dims.length - 3).toLowerCase()} with smaller volumes.</p>`
                    : ''}
                <div class="wr-chart-row" style="margin-top:18px;">
                    <div class="wr-chart" id="wrChartDimDonut" style="min-height:280px;"></div>
                    <div class="wr-chart" id="wrChartDimBuckets" style="min-height:280px;"></div>
                </div>
            </section>
        `);

        // 3. Owner workload + funnel
        slides.push(`
            <section class="wr-slide wr-slide--workload">
                <div class="wr-slide-num">3</div>
                <div class="wr-slide-eyebrow">COMPARATIVE VIEW</div>
                <h2 class="wr-slide-title">${escapeHtml(ownerLabel)} Workload &amp; Funnel</h2>
                <div class="wr-owner-grid">
                    ${owners.slice(0, 8).map(o => ownerSummaryCard(o)).join('')}
                </div>
                <div class="wr-chart" id="wrChartOwnerStacked" style="min-height:340px; margin-top:18px;"></div>
            </section>
        `);

        // 4. Hot lead champions
        if (totalHot > 0 && topOwnerByHot) {
            slides.push(`
                <section class="wr-slide wr-slide--champion">
                    <div class="wr-slide-num">4</div>
                    <div class="wr-slide-eyebrow">CONVERSION QUALITY</div>
                    <h2 class="wr-slide-title">Hot Lead Champions</h2>
                    <p class="wr-slide-subtitle">Of ${totalHot} hot ${pluralize('lead', totalHot).toLowerCase()} this week, here's how they break down.</p>
                    <div class="wr-champion">
                        <div class="wr-champion-card">
                            <div class="wr-champion-badge">TOP PERFORMER</div>
                            <div class="wr-champion-name">${escapeHtml(topOwnerByHot.name)}</div>
                            <div class="wr-champion-stat">
                                <span class="wr-champion-num">${topOwnerByHot.hot}</span>
                                <span class="wr-champion-label">hot leads</span>
                            </div>
                            ${hotShare ? `<div class="wr-champion-share">${hotShare}% of all hot leads</div>` : ''}
                        </div>
                        <div class="wr-champion-rest">
                            ${owners.filter(o => o.user_id !== topOwnerByHot.user_id && o.hot > 0).map(o => `
                                <div class="wr-mini-card">
                                    <div class="wr-mini-name">${escapeHtml(o.name)}</div>
                                    <div class="wr-mini-meta">${o.leads} leads · ${o.connected} connected · ${fmtPct(o.connect_pct)} rate</div>
                                    <div class="wr-mini-hot"><strong>${o.hot}</strong> hot</div>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                </section>
            `);
        }

        // 5. Per-owner detail (one slide each) — with the matrix table
        let slideNum = topOwnerByHot ? 5 : 4;
        for (const o of owners) {
            const cells = matrix.filter(c => c.user_id === o.user_id && c.leads > 0)
                                .sort((a, b) => b.leads - a.leads);
            // Stacked outcome strip — shows the proportional split of this
            // owner's leads across the 5 buckets at a glance, so the table
            // below it is no longer the only visual cue.
            const strip = renderBucketStrip(o);
            slides.push(`
                <section class="wr-slide wr-slide--owner">
                    <div class="wr-slide-num">${slideNum}</div>
                    <div class="wr-slide-eyebrow">${escapeHtml(ownerLabel.toUpperCase())} SPOTLIGHT</div>
                    <h2 class="wr-slide-title">${escapeHtml(o.name)} — Performance Detail</h2>
                    <p class="wr-slide-subtitle">${describeOwner(o, owners)}</p>

                    <div class="wr-owner-kpis">
                        ${miniKpi(o.leads, 'Leads Given')}
                        ${miniKpi(o.connected, 'Connected', fmtPct(o.connect_pct) + ' conn. rate')}
                        ${miniKpi(o.hot, 'Hot Leads')}
                        ${miniKpi(o.followups, 'Follow-ups')}
                        ${miniKpi(o.not_interested, 'Not Interested')}
                    </div>

                    ${strip}

                    ${cells.length > 0 ? `
                        <table class="wr-matrix">
                            <thead>
                                <tr>
                                    <th>${escapeHtml(dimLabel)}</th>
                                    <th>Leads</th>
                                    <th>Connected</th>
                                    <th>Conn. %</th>
                                    <th>Hot</th>
                                    <th>Follow-up</th>
                                    <th>No Response</th>
                                    <th>Not Interest.</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${cells.map(c => `
                                    <tr>
                                        <td>${escapeHtml(resolveDimLabel(c.dimension_label))}</td>
                                        <td>${c.leads}</td>
                                        <td>${c.connected}</td>
                                        <td>${fmtPct(c.connect_pct)}</td>
                                        <td>${c.hot || ''}</td>
                                        <td>${c.followups || ''}</td>
                                        <td>${c.no_response || ''}</td>
                                        <td>${c.not_interested || ''}</td>
                                    </tr>`).join('')}
                                <tr class="wr-matrix-total">
                                    <td>TOTAL</td>
                                    <td>${o.leads}</td>
                                    <td>${o.connected}</td>
                                    <td>${fmtPct(o.connect_pct)}</td>
                                    <td>${o.hot}</td>
                                    <td>${o.followups}</td>
                                    <td>${o.no_response}</td>
                                    <td>${o.not_interested}</td>
                                </tr>
                            </tbody>
                        </table>
                    ` : ''}
                </section>
            `);
            slideNum += 1;
        }

        // 6. Per-dimension deep dive
        for (const d of top3) {
            slides.push(`
                <section class="wr-slide wr-slide--dim">
                    <div class="wr-slide-num">${slideNum}</div>
                    <div class="wr-slide-eyebrow">${escapeHtml(dimLabel.toUpperCase())} DEEP DIVE</div>
                    <h2 class="wr-slide-title">${escapeHtml(resolveDimLabel(d.label))}</h2>
                    <div class="wr-owner-kpis">
                        ${miniKpi(d.leads, 'Total leads', `${d.leads - d.unassigned} assigned · ${d.unassigned} unassigned`)}
                        ${miniKpi(d.connected, 'Connected', fmtPct(d.connect_pct) + ' of cohort')}
                        ${miniKpi(d.hot, 'Hot leads')}
                        ${miniKpi(d.followups, 'Follow-ups')}
                    </div>
                    <div class="wr-insight-box">
                        <h4>INSIGHT</h4>
                        <p>${escapeHtml(describeDimension(d, dims))}</p>
                    </div>
                </section>
            `);
            slideNum += 1;
        }

        // 7. Recommendations
        slides.push(`
            <section class="wr-slide wr-slide--rec">
                <div class="wr-slide-num">${slideNum}</div>
                <div class="wr-slide-eyebrow">LOOKING AHEAD</div>
                <h2 class="wr-slide-title">Insights &amp; Recommended Actions</h2>
                <div class="wr-recs">
                    <div>
                        <h4>Insights</h4>
                        <ul>
                            ${buildInsights({
                                ownerLabel, dimLabel, T, owners, dims,
                                topOwnerByHot, topOwnerByConnect, heaviestOwner, worstDimByConnect, hotShare
                            }).map(s => `<li>${s}</li>`).join('')}
                        </ul>
                    </div>
                    <div>
                        <h4>Actions for Next Week</h4>
                        <ol>
                            ${buildActions({
                                ownerLabel, dimLabel, T, owners, dims,
                                topOwnerByHot, topOwnerByConnect, heaviestOwner, worstDimByConnect
                            }).map(s => `<li>${s}</li>`).join('')}
                        </ol>
                    </div>
                </div>
            </section>
        `);

        deck.innerHTML = slides.join('');

        // Charts mount after innerHTML so the target divs exist. Two rAFs
        // ensure layout + paint have settled — without this ApexCharts can
        // read width=0 on the just-mounted container and emit NaN paths.
        requestAnimationFrame(() => requestAnimationFrame(() => {
            mountCharts(p, dims, owners, BUCKET_COLORS, BUCKET_LABELS);
        }));
    }

    // ── Bucket strip — proportional horizontal bar of the 5 outcome buckets ─
    function renderBucketStrip(o) {
        // Same 5 buckets the matrix table shows. The "other" segment fills
        // up to the total leads count for visual completeness — leads that
        // haven't fallen into any specific bucket yet.
        const segs = [
            { v: o.connected, label: 'Connected', color: '#10b981' },
            { v: o.hot, label: 'Hot', color: '#ef4444' },
            { v: o.followups, label: 'Follow-up', color: '#f59e0b' },
            { v: o.no_response, label: 'No Response', color: '#6b7280' },
            { v: o.not_interested, label: 'Not Interested', color: '#7c3aed' },
        ];
        const sum = segs.reduce((s, x) => s + x.v, 0);
        const other = Math.max(0, o.leads - sum);
        const total = sum + other;
        if (total === 0) return '';
        const segHtml = segs.filter(s => s.v > 0).map(s =>
            `<span class="wr-bar-seg" style="flex:${s.v}; background:${s.color};" title="${s.label}: ${s.v}"></span>`
        ).join('');
        const otherHtml = other > 0
            ? `<span class="wr-bar-seg" style="flex:${other}; background: rgba(148,163,184,0.25);" title="No bucket yet: ${other}"></span>`
            : '';
        const legendHtml = segs.filter(s => s.v > 0).map(s =>
            `<span><i style="background:${s.color};"></i>${escapeHtml(s.label)} (${s.v})</span>`
        ).join('') + (other > 0 ? `<span><i style="background:rgba(148,163,184,0.4);"></i>Untagged (${other})</span>` : '');
        return `<div class="wr-bar-strip">${segHtml}${otherHtml}</div>
                <div class="wr-bar-legend">${legendHtml}</div>`;
    }

    // ── ApexCharts mounting ────────────────────────────────────────────────
    function mountCharts(payload, dims, owners, palette, bucketLabels) {
        if (typeof ApexCharts === 'undefined') return; // library not loaded — silent skip
        const top3 = dims.slice(0, 3).filter(d => d.leads > 0);
        const ownersForChart = owners.filter(o => o.user_id !== '__unassigned__' && o.leads > 0).slice(0, 8);
        if (top3.length === 0 && ownersForChart.length === 0) return;

        // Common dark-theme options for every chart so they sit on the
        // glassy background without fighting it.
        const themeBase = {
            chart: {
                background: 'transparent',
                foreColor: 'rgba(226, 232, 240, 0.85)',
                fontFamily: 'inherit',
                toolbar: { show: false },
                // Animations off — ApexCharts emits NaN paths during the
                // init-tween before its first real measurement. Static
                // render produces clean SVG from frame zero.
                animations: { enabled: false },
                redrawOnParentResize: true,
                redrawOnWindowResize: true
            },
            grid: { borderColor: 'rgba(99,102,241,0.12)', strokeDashArray: 3 },
            tooltip: { theme: 'dark' },
            legend: { labels: { colors: 'rgba(226,232,240,0.85)' } }
        };

        // 1. Donut — lead volume per dimension bucket.
        // ApexCharts emits NaN warnings on the first paint when the
        // donut's total formatter returns a non-string or when its series
        // sums to 0. Coerce to string + guard the series.
        if (top3.length > 0) {
            const totalLeads = top3.reduce((s, d) => s + d.leads, 0);
            mountChart('wrChartDimDonut', {
                ...themeBase,
                chart: { ...themeBase.chart, type: 'donut', height: 280 },
                series: top3.map(d => d.leads || 0),
                labels: top3.map(d => resolveDimLabel(d.label)),
                colors: ['#6366f1', '#06b6d4', '#a855f7'],
                stroke: { width: 0 },
                plotOptions: {
                    pie: {
                        donut: {
                            size: '68%',
                            labels: {
                                show: true,
                                total: {
                                    show: true,
                                    label: 'Top 3 leads',
                                    fontSize: '12px',
                                    color: 'rgba(226,232,240,0.7)',
                                    formatter: () => String(totalLeads)
                                },
                                value: { fontSize: '20px', color: '#fff', fontWeight: 700 }
                            }
                        }
                    }
                },
                dataLabels: { enabled: true, style: { fontSize: '11px', fontWeight: 600 }, formatter: v => (isFinite(v) ? v.toFixed(1) : '0.0') + '%' },
                legend: { ...themeBase.legend, position: 'bottom', fontSize: '12px' }
            });
        }

        // 2. Stacked bar — per-dimension outcome bucket split.
        if (top3.length > 0) mountChart('wrChartDimBuckets', {
            ...themeBase,
            chart: { ...themeBase.chart, type: 'bar', stacked: true, stackType: '100%', height: 280 },
            series: bucketLabels.map((bl, i) => ({
                name: bl,
                data: top3.map(d => [d.connected, d.hot, d.followups, d.no_response, d.not_interested][i])
            })),
            xaxis: { categories: top3.map(d => resolveDimLabel(d.label)), labels: { style: { fontSize: '12px' } } },
            yaxis: { labels: { formatter: v => v.toFixed(0) + '%' } },
            colors: palette,
            plotOptions: { bar: { horizontal: false, borderRadius: 4, columnWidth: '55%' } },
            stroke: { width: 1, colors: ['rgba(15,23,42,0.4)'] },
            dataLabels: { enabled: false },
            legend: { ...themeBase.legend, position: 'bottom', fontSize: '11px' }
        });

        // 3. Horizontal stacked bar — owners × outcome buckets, absolute counts.
        if (ownersForChart.length > 0) mountChart('wrChartOwnerStacked', {
            ...themeBase,
            chart: { ...themeBase.chart, type: 'bar', stacked: true, height: 320 },
            series: bucketLabels.map((bl, i) => ({
                name: bl,
                data: ownersForChart.map(o => [o.connected, o.hot, o.followups, o.no_response, o.not_interested][i])
            })),
            yaxis: { labels: { style: { fontSize: '12px', fontWeight: 600 } } },
            colors: palette,
            plotOptions: { bar: { horizontal: true, borderRadius: 4, barHeight: '70%' } },
            stroke: { width: 1, colors: ['rgba(15,23,42,0.4)'] },
            dataLabels: { enabled: false },
            legend: { ...themeBase.legend, position: 'bottom', fontSize: '11px' },
            xaxis: {
                categories: ownersForChart.map(o => o.name),
                labels: { style: { fontSize: '11px' } }
            }
        });
    }

    // Track mounted ApexCharts instances so a re-render (Refresh click) can
    // destroy the previous ones cleanly instead of stacking them.
    const _mountedCharts = new Map();

    function mountChart(elId, opts) {
        const el = document.getElementById(elId);
        if (!el) return;

        // Tear down any prior instance bound to this slot — happens when the
        // user hits Refresh, which calls renderDeck → mountCharts again.
        const prior = _mountedCharts.get(elId);
        if (prior) {
            try { prior.destroy(); } catch (_) {}
            _mountedCharts.delete(elId);
        }

        // The classic ApexCharts "M NaN NaN" path bug: the library reads the
        // container's clientWidth at render-time. If the deck just got its
        // innerHTML or the tab pane is mid-show, that read returns 0 and
        // every SVG calc downstream produces NaN. ResizeObserver lets us
        // wait until the browser has actually laid the box out before
        // calling render(), which kills the warning stream and the brief
        // 0-width chart flash.
        const doRender = () => {
            try {
                const chart = new ApexCharts(el, opts);
                _mountedCharts.set(elId, chart);
                chart.render();
            } catch (e) {
                console.warn('[weekly-report] chart mount failed:', elId, e);
            }
        };

        // Fast path: container already has real width — render synchronously
        // so the first paint is right.
        if (el.clientWidth > 0) {
            doRender();
            return;
        }

        // Slow path: container is 0 wide right now. Watch it, render once
        // it gains size, then disconnect.
        if (typeof ResizeObserver === 'function') {
            const ro = new ResizeObserver(entries => {
                for (const entry of entries) {
                    const w = entry.contentRect ? entry.contentRect.width : el.clientWidth;
                    if (w > 0) {
                        ro.disconnect();
                        doRender();
                        return;
                    }
                }
            });
            ro.observe(el);
        } else {
            // Old-browser fallback — defer with rAF chain and try once.
            requestAnimationFrame(() => requestAnimationFrame(doRender));
        }
    }

    // ── Insight / action generators ───────────────────────────────────────
    function buildInsights(ctx) {
        const out = [];
        const { ownerLabel, dimLabel, T, owners, topOwnerByHot, topOwnerByConnect, heaviestOwner, worstDimByConnect, hotShare } = ctx;

        if (topOwnerByHot && topOwnerByHot.hot > 0) {
            out.push(`<strong>${escapeHtml(topOwnerByHot.name)}</strong>'s ${topOwnerByHot.hot} hot ${pluralize('lead', topOwnerByHot.hot).toLowerCase()} drive ${hotShare}% of the week's qualified pipeline${heaviestOwner && topOwnerByHot.user_id !== heaviestOwner.user_id ? ` despite handling ${topOwnerByHot.leads < heaviestOwner.leads ? 'fewer' : 'more'} leads than ${escapeHtml(heaviestOwner.name)}` : ''}.`);
        }
        if (topOwnerByConnect && topOwnerByHot && topOwnerByConnect.user_id !== topOwnerByHot.user_id && topOwnerByConnect.hot < 3) {
            out.push(`<strong>${escapeHtml(topOwnerByConnect.name)}</strong> leads on connectivity (${fmtPct(topOwnerByConnect.connect_pct)}) but converts only ${topOwnerByConnect.hot} hot ${pluralize('lead', topOwnerByConnect.hot).toLowerCase()} — a qualification gap.`);
        }
        if (heaviestOwner && heaviestOwner.hot <= 1 && heaviestOwner.leads >= 30) {
            out.push(`<strong>${escapeHtml(heaviestOwner.name)}</strong> handles the most volume (${heaviestOwner.leads}) yet generates only ${heaviestOwner.hot} hot ${pluralize('lead', heaviestOwner.hot).toLowerCase()} — workload may dilute quality.`);
        }
        if (worstDimByConnect && worstDimByConnect.connect_pct < 30 && worstDimByConnect.leads >= 10) {
            out.push(`<strong>${escapeHtml(resolveDimLabel(worstDimByConnect.label))}</strong> has the weakest reach — only ${fmtPct(worstDimByConnect.connect_pct)} connect rate on ${worstDimByConnect.leads} leads.`);
        }
        if (T.unassigned > 0) {
            out.push(`<strong>${T.unassigned} leads remain unassigned</strong>. Distribute promptly to avoid drop-off.`);
        }
        if (out.length === 0) out.push(`Numbers look balanced this week — no outliers to flag.`);
        return out;
    }

    function buildActions(ctx) {
        const out = [];
        const { ownerLabel, dimLabel, T, owners, topOwnerByHot, heaviestOwner, worstDimByConnect } = ctx;

        if (topOwnerByHot && topOwnerByHot.hot >= 3) {
            out.push(`Have <strong>${escapeHtml(topOwnerByHot.name)}</strong> share their hot-lead qualification approach with the team.`);
        }
        if (heaviestOwner && heaviestOwner.hot <= 1 && heaviestOwner.leads >= 30) {
            out.push(`Audit <strong>${escapeHtml(heaviestOwner.name)}</strong>'s pipeline — review call quality vs quantity.`);
        }
        if (worstDimByConnect && worstDimByConnect.connect_pct < 30 && worstDimByConnect.leads >= 10) {
            out.push(`Sharpen the script for <strong>${escapeHtml(resolveDimLabel(worstDimByConnect.label))}</strong> (currently ${fmtPct(worstDimByConnect.connect_pct)} connect rate).`);
        }
        if (T.unassigned > 0) {
            out.push(`Assign the <strong>${T.unassigned} unallocated leads</strong> by EOD Monday.`);
        }
        const target = Math.max(4, Math.ceil((T.hot || 4) / Math.max(1, T.active_owners)) + 1);
        out.push(`Set a hot-lead target of <strong>${target}+</strong> per ${escapeHtml(ownerLabel.toLowerCase())} for next week.`);
        return out;
    }

    function describeOwner(o, owners) {
        const allHot = owners.reduce((s, x) => s + x.hot, 0);
        if (o.hot >= 3 && allHot > 0 && (o.hot / allHot) >= 0.4) return 'Hot lead engine — strongest qualification quality.';
        const ranked = owners.slice().sort((a, b) => b.connect_pct - a.connect_pct);
        if (ranked[0] && ranked[0].user_id === o.user_id && ranked[0].connect_pct > 0) return 'Best connection rate this week.';
        const byLeads = owners.slice().sort((a, b) => b.leads - a.leads);
        if (byLeads[0] && byLeads[0].user_id === o.user_id) return 'Highest workload — strong reach but few hot conversions.';
        return 'Balanced load — outcomes broadly typical for the cohort.';
    }

    function describeDimension(d, dims) {
        const topConn = dims.slice().sort((a, b) => b.connect_pct - a.connect_pct)[0];
        if (topConn && topConn.key === d.key && d.connect_pct > 0) {
            return `Outstanding ${fmtPct(d.connect_pct)} connection rate — best across all ${_settings.dimensionLabel.toLowerCase()}s this week.`;
        }
        if (d.hot === 0 && d.leads >= 20) {
            return `${d.leads} leads but zero hot conversions — review the qualification approach for this ${_settings.dimensionLabel.toLowerCase()}.`;
        }
        if (d.connect_pct < 30 && d.leads >= 10) {
            return `Connection rate below 30% — call quality and timing may need attention.`;
        }
        return `${d.leads} ${pluralize('lead', d.leads).toLowerCase()} this week, ${d.connected} connected, ${d.hot} hot.`;
    }

    // ── HTML helpers ───────────────────────────────────────────────────────
    function kpiTile(label, value, hint) {
        return `<div class="wr-kpi-tile">
            <div class="wr-kpi-value">${escapeHtml(String(value))}</div>
            <div class="wr-kpi-label">${escapeHtml(label)}</div>
            ${hint ? `<div class="wr-kpi-hint">${escapeHtml(hint)}</div>` : ''}
        </div>`;
    }

    function dimensionCard(d, totalLeads, index) {
        const pct = totalLeads ? (100 * d.leads / totalLeads) : 0;
        return `<div class="wr-dim-card wr-dim-${index + 1}">
            <div class="wr-dim-rank">${escapeHtml(resolveDimLabel(d.label))}</div>
            <div class="wr-dim-pct">${fmtPct(pct)} of total</div>
            <div class="wr-dim-leads">${d.leads}<span>leads</span></div>
        </div>`;
    }

    function ownerSummaryCard(o) {
        return `<div class="wr-owner-card">
            <div class="wr-owner-name">${escapeHtml(o.name)}</div>
            <div class="wr-owner-volume">${o.leads} leads handled</div>
            <div class="wr-owner-row"><span class="wr-owner-row-v">${o.connected}</span><span class="wr-owner-row-l">Connected</span></div>
            <div class="wr-owner-row"><span class="wr-owner-row-v">${fmtPct(o.connect_pct)}</span><span class="wr-owner-row-l">Conn. rate</span></div>
            <div class="wr-owner-row wr-owner-hot"><span class="wr-owner-row-v">${o.hot}</span><span class="wr-owner-row-l">Hot</span></div>
        </div>`;
    }

    function miniKpi(value, label, hint) {
        return `<div class="wr-mini-kpi">
            <div class="wr-mini-kpi-value">${escapeHtml(String(value))}</div>
            <div class="wr-mini-kpi-label">${escapeHtml(label)}</div>
            ${hint ? `<div class="wr-mini-kpi-hint">${escapeHtml(hint)}</div>` : ''}
        </div>`;
    }

    // Resolve a raw custom-field option code → its display label. For
    // non-custom dimensions the label arrives already-resolved (source
    // name, team name etc.) so this is a no-op then.
    function resolveDimLabel(raw) {
        if (!raw || raw === '(Not set)' || raw === '(No team)' || raw === '(Unknown source)') return raw;
        if (!_settings.dimensionField?.startsWith('lf_')) return raw;
        const code = _settings.dimensionField.substring(3);
        const f = _customFields.find(x => x.code === code);
        if (!f) return raw;
        const opt = (f.options || []).find(o => o.code === raw);
        return opt ? opt.label : raw;
    }

    // ── Date utilities ─────────────────────────────────────────────────────
    function currentMonday() {
        const d = new Date();
        const day = d.getDay();
        const diff = (day + 6) % 7;
        d.setDate(d.getDate() - diff);
        d.setHours(0, 0, 0, 0);
        return d;
    }

    function nextSunday() {
        const m = currentMonday();
        m.setDate(m.getDate() + 6);
        return m;
    }

    function isoDate(d) {
        const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0');
        return `${y}-${m}-${day}`;
    }

    function formatDateRange(from, to) {
        const fmt = (d) => d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
        const toAdj = new Date(to.getTime() - 86400000); // payload `to` is exclusive
        return `Week of ${fmt(from)} – ${fmt(toAdj)}`;
    }

    function fmtPct(n) {
        if (n == null || isNaN(n)) return '0.0%';
        return (Math.round(n * 10) / 10).toFixed(1) + '%';
    }

    function pluralize(word, n) {
        if (n === 1) return word;
        if (/s$/i.test(word)) return word;
        if (/y$/i.test(word) && !/[aeiou]y$/i.test(word)) return word.slice(0, -1) + 'ies';
        return word + 's';
    }

    function escapeHtml(s) {
        if (s == null) return '';
        return String(s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    // ── Print / Save as PDF ────────────────────────────────────────────────
    // Opens a fresh window with just the deck + print-friendly CSS, then
    // invokes window.print(). The user picks "Save as PDF" in the OS print
    // dialog. Matches the lead-journey timeline print pattern.
    window.printWeeklyReport = function () {
        const deck = document.getElementById('wrDeck');
        if (!deck || !_lastPayload) return;
        const html = deck.innerHTML;

        const w = window.open('', '_blank', 'width=1280,height=900');
        if (!w) return; // popup blocked
        const css = printCss();
        w.document.write(`<!DOCTYPE html>
<html><head><title>Weekly Report</title><meta charset="utf-8">
<style>${css}</style></head>
<body class="wr-print-root">
${html}
</body></html>`);
        w.document.close();
        setTimeout(() => { try { w.focus(); w.print(); } catch {} }, 250);
    };

    function printCss() {
        // Inline a self-contained stylesheet so the print window doesn't
        // need to fetch the app's CSS. Keep it minimal — the deck cards do
        // most of the visual heavy lifting via class names; we just need
        // the layout/typography rules to land cleanly on paper.
        return `
            * { box-sizing: border-box; }
            body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color:#111827; margin:0; }
            .wr-slide { padding:48px 56px; min-height:auto; page-break-after: always; border-bottom: none; }
            .wr-slide:last-child { page-break-after: auto; }
            .wr-slide-num { position:absolute; right:32px; bottom:24px; color:#9ca3af; font-size:0.85rem; }
            .wr-slide-eyebrow { color:#6b7280; font-size:0.7rem; letter-spacing:0.18em; font-weight:600; margin-bottom:6px; }
            .wr-slide-title { font-size:1.6rem; font-weight:700; margin:0 0 4px; }
            .wr-slide-subtitle { color:#6b7280; font-size:0.9rem; margin:0 0 24px; }
            .wr-kpis { display:grid; grid-template-columns: repeat(4, 1fr); gap:14px; margin: 20px 0 24px; }
            .wr-kpi-tile { background:#f3f4f6; border-radius:12px; padding:16px 18px; }
            .wr-kpi-value { font-size:2rem; font-weight:700; line-height:1; }
            .wr-kpi-label { color:#374151; font-size:0.85rem; font-weight:600; margin-top:6px; }
            .wr-kpi-hint { color:#6b7280; font-size:0.72rem; margin-top:2px; }
            .wr-takeaways h4 { font-size:0.72rem; letter-spacing:0.18em; color:#6b7280; margin:24px 0 8px; }
            .wr-takeaways ol { margin:0; padding-left:24px; font-size:0.92rem; line-height:1.5; }
            .wr-takeaways li { margin-bottom:6px; }
            .wr-dim-grid { display:grid; grid-template-columns: repeat(3, 1fr); gap:16px; }
            .wr-dim-card { padding:24px; border-radius:14px; background: linear-gradient(135deg, #4f46e5 0%, #6366f1 100%); color:white; }
            .wr-dim-2 { background: linear-gradient(135deg, #0891b2 0%, #06b6d4 100%); }
            .wr-dim-3 { background: linear-gradient(135deg, #7c3aed 0%, #9333ea 100%); }
            .wr-dim-rank { font-size:1.15rem; font-weight:700; }
            .wr-dim-pct { opacity:0.85; font-size:0.8rem; margin:4px 0 14px; }
            .wr-dim-leads { font-size:2.2rem; font-weight:700; line-height:1; }
            .wr-dim-leads span { display:block; font-size:0.75rem; opacity:0.85; font-weight:500; margin-top:4px; }
            .wr-owner-grid { display:grid; grid-template-columns: repeat(4, 1fr); gap:12px; }
            .wr-owner-card { background:#f9fafb; border:1px solid #e5e7eb; border-radius:12px; padding:14px 16px; }
            .wr-owner-name { font-weight:700; font-size:1rem; }
            .wr-owner-volume { color:#6b7280; font-size:0.78rem; margin: 4px 0 12px; }
            .wr-owner-row { display:flex; justify-content:space-between; align-items:baseline; padding:4px 0; }
            .wr-owner-row-v { font-size:1.1rem; font-weight:700; }
            .wr-owner-row-l { color:#6b7280; font-size:0.78rem; }
            .wr-owner-hot { border-top:1px solid #e5e7eb; padding-top:8px; margin-top:6px; }
            .wr-owner-hot .wr-owner-row-v { color:#dc2626; }
            .wr-champion { display:grid; grid-template-columns: 280px 1fr; gap:24px; margin-top:16px; }
            .wr-champion-card { background: linear-gradient(135deg, #dc2626 0%, #ef4444 100%); color:white; padding:24px; border-radius:14px; }
            .wr-champion-badge { font-size:0.7rem; letter-spacing:0.15em; opacity:0.85; }
            .wr-champion-name { font-size:1.6rem; font-weight:700; margin: 8px 0 16px; }
            .wr-champion-num { font-size:3rem; font-weight:700; }
            .wr-champion-label { font-size:0.85rem; opacity:0.9; margin-left:6px; }
            .wr-champion-share { font-size:0.85rem; opacity:0.85; margin-top:10px; }
            .wr-champion-rest { display:grid; grid-template-columns: repeat(3, 1fr); gap:10px; }
            .wr-mini-card { background:#f9fafb; border:1px solid #e5e7eb; border-radius:10px; padding:12px 14px; font-size:0.85rem; }
            .wr-mini-name { font-weight:700; margin-bottom:4px; }
            .wr-mini-meta { color:#6b7280; font-size:0.72rem; }
            .wr-mini-hot { color:#dc2626; font-weight:600; margin-top:6px; }
            .wr-owner-kpis { display:grid; grid-template-columns: repeat(5, 1fr); gap:10px; margin:8px 0 18px; }
            .wr-mini-kpi { background:#f9fafb; border:1px solid #e5e7eb; border-radius:10px; padding:12px 14px; }
            .wr-mini-kpi-value { font-size:1.6rem; font-weight:700; line-height:1; }
            .wr-mini-kpi-label { font-size:0.78rem; color:#374151; font-weight:600; margin-top:4px; }
            .wr-mini-kpi-hint { font-size:0.7rem; color:#6b7280; margin-top:2px; }
            .wr-matrix { width:100%; border-collapse:collapse; font-size:0.85rem; }
            .wr-matrix th, .wr-matrix td { padding:8px 10px; text-align:left; border-bottom:1px solid #e5e7eb; }
            .wr-matrix th { background:#f3f4f6; font-size:0.72rem; letter-spacing:0.04em; }
            .wr-matrix-total { font-weight:700; background:#f9fafb; }
            .wr-matrix-total td { border-top:2px solid #d1d5db; }
            .wr-insight-box { background:#eff6ff; border:1px solid #bfdbfe; border-radius:12px; padding:16px 18px; margin-top:16px; }
            .wr-insight-box h4 { font-size:0.7rem; letter-spacing:0.18em; color:#1d4ed8; margin: 0 0 6px; }
            .wr-insight-box p { margin:0; font-size:0.92rem; line-height:1.5; }
            .wr-recs { display:grid; grid-template-columns: 1fr 1fr; gap:24px; margin-top:16px; }
            .wr-recs h4 { font-size:0.78rem; letter-spacing:0.12em; color:#6b7280; margin:0 0 10px; }
            .wr-recs ul, .wr-recs ol { margin:0; padding-left:20px; font-size:0.9rem; line-height:1.55; }
            .wr-recs li { margin-bottom:6px; }
            .wr-aside { color:#6b7280; font-size:0.8rem; margin-top:12px; }
            .wr-slide-cover { background: linear-gradient(135deg, #f5f3ff 0%, #ede9fe 100%); }
        `;
    }
})();
