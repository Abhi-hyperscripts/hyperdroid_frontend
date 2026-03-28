/**
 * Procurement Quote Comparison — Decision-First Architecture
 * Priority: Decision → Supporting Logic → Learning
 */

// ==================== State ====================
let rfqId = null;
let currentComparison = null;
let vendorQuotes = [];
let aiAvailable = false;
let vendorPerformanceSummaries = [];
let learningDetailsExpanded = false;
let aiDetailsExpanded = false;
let awardMode = 'single'; // 'single' or 'split'
let splitAllocations = []; // current item→vendor assignments for split mode

async function checkAIAvailability() {
    try {
        const resp = await api.request('/procurement/procurement-ai/status', { _skipSpinner: true });
        aiAvailable = resp.ai_available === true;
    } catch {
        aiAvailable = false;
    }
}

// ==================== Initialization ====================

document.addEventListener('DOMContentLoaded', () => {
    Navigation.init('procurement', '../');

    if (!api.isAuthenticated()) {
        window.location.href = '../login.html';
        return;
    }

    checkAIAvailability();

    const params = new URLSearchParams(window.location.search);
    rfqId = params.get('rfqId');
    if (!rfqId) {
        Toast.error('No RFQ ID provided');
        window.location.href = 'rfqs.html';
        return;
    }

    loadComparison();
});

// ==================== Data Loading ====================

async function loadComparison() {
    try {
        const response = await api.request(`/procurement/comparisons?rfqId=${rfqId}`);
        const data = response.data || response;

        if (Array.isArray(data) && data.length > 0) {
            currentComparison = data[0];
        } else if (data && data.id) {
            currentComparison = data;
        } else {
            currentComparison = null;
        }

        if (currentComparison) {
            renderComparison();
        } else {
            showNoComparison();
        }
    } catch (error) {
        console.error('Failed to load comparison:', error);
        showNoComparison();
    }

    loadVendorQuotes();
}

async function loadVendorQuotes() {
    try {
        const response = await api.request(`/procurement/vendor-quotes?rfqId=${rfqId}`, { _skipSpinner: true });
        vendorQuotes = response.data || response || [];
    } catch {
        vendorQuotes = [];
    }
}

// ==================== Display States ====================

function showNoComparison() {
    document.getElementById('noComparisonState').style.display = '';
    document.getElementById('comparisonContent').style.display = 'none';
    document.getElementById('headerActions').innerHTML = `
        <button class="btn btn-primary btn-sm" onclick="generateComparison()">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="18" y1="20" x2="18" y2="10"/>
                <line x1="12" y1="20" x2="12" y2="4"/>
                <line x1="6" y1="20" x2="6" y2="14"/>
            </svg>
            Generate Comparison
        </button>
    `;
}

function parseJsonField(val) {
    if (!val) return null;
    if (typeof val === 'object') return val;
    try { return JSON.parse(val); } catch { return null; }
}

function renderComparison() {
    document.getElementById('noComparisonState').style.display = 'none';
    document.getElementById('comparisonContent').style.display = '';

    const comp = currentComparison;

    // Parse JSONB fields
    comp._det = parseJsonField(comp.deterministic);
    comp._heur = parseJsonField(comp.heuristic);
    comp._ai = parseJsonField(comp.ai_analysis);
    comp._rec = parseJsonField(comp.recommendation);
    comp._conf = parseJsonField(comp.confidence_factors);

    // Metadata
    document.getElementById('breadcrumbTitle').textContent = comp.rfq_number || 'Comparison';
    document.getElementById('comparisonTitle').textContent = `Comparison: ${escapeHtml(comp.rfq_title || comp.rfq_number || '')}`;
    document.getElementById('metaRfqNumber').textContent = comp.rfq_number || '-';
    document.getElementById('metaVersion').innerHTML = `<span style="cursor:pointer;text-decoration:underline dotted;" onclick="loadComparisonHistory()">v${comp.version || 1}</span>`;
    document.getElementById('metaGenerated').textContent = formatDate(comp.created_at);

    // Confidence — human-readable
    renderConfidence(comp);

    // Header actions
    const hasAiCached = !!comp._ai;
    const aiBtn = aiAvailable ? `
        <button class="btn btn-sm" id="aiAnalysisBtn" style="background: var(--bg-tertiary); color: var(--color-warning); border: 1px solid var(--color-warning); font-weight: 600;" onclick="runAiAnalysis(${hasAiCached ? 'true' : 'false'})">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                ${hasAiCached
                    ? '<polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>'
                    : '<path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2z"/><path d="M12 6v6l4 2"/>'}
            </svg>
            ${hasAiCached ? 'Regenerate AI' : 'AI Analysis'}
        </button>
    ` : '';
    document.getElementById('headerActions').innerHTML = `
        ${aiBtn}
        <button class="btn btn-secondary btn-sm" onclick="generateComparison()">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="23 4 23 10 17 10"/>
                <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
            </svg>
            Regenerate
        </button>
    `;

    // 1. DECISION — Final Recommendation (top)
    renderFinalRecommendation(comp);

    // 1b. SPLIT AWARD — Toggle + optimal basket (if applicable)
    renderSplitAwardToggle(comp);

    // 2. ALTERNATIVES — Secondary options (hidden in split mode)
    renderAlternatives(comp);

    // 3. AI INSIGHTS — Compressed
    renderAiAnalysis(comp);

    // 4. PRICE DATA — Collapsed
    renderPriceMatrix(comp);
    renderScores(comp);

    // 5. LEARNING — Collapsed at bottom
    loadAndRenderLearningProgress(comp);
}

// ==================== Confidence (Human-Readable) ====================

function renderConfidence(comp) {
    const confidence = comp.confidence_score;
    if (confidence === null || confidence === undefined) {
        document.getElementById('metaConfidence').textContent = '-';
        return;
    }
    const pct = Math.round(confidence * 100);
    let color, label;
    if (pct >= 80) { color = 'var(--color-success)'; label = 'High'; }
    else if (pct >= 60) { color = 'var(--color-warning)'; label = 'Moderate'; }
    else if (pct >= 40) { color = 'var(--color-warning)'; label = 'Low'; }
    else { color = 'var(--color-error)'; label = 'Very Low'; }

    const conf = comp._conf || {};
    let reason = '';
    if (!conf.has_performance_data && !conf.has_quality_scores) reason = 'limited historical data';
    else if (conf.quotes_received < conf.quotes_expected) reason = 'not all vendors quoted';
    else if (conf.vendor_history_records < 5) reason = 'few past transactions';
    else reason = 'strong data foundation';

    document.getElementById('metaConfidence').innerHTML =
        `<span style="color: ${color}; font-weight: 600;">${pct}% — ${label}</span>
         <span style="color: var(--text-secondary); font-size: 12px; margin-left: 4px;">(${reason})</span>`;
}

// ==================== 1. FINAL RECOMMENDATION ====================

function renderFinalRecommendation(comp) {
    const container = document.getElementById('finalRecommendation');
    const rec = comp._rec || {};
    const det = comp._det || {};
    const heur = comp._heur || {};
    const vendorTotals = det.vendor_totals || [];
    const scores = heur.vendor_scores || [];

    // Determine the ONE recommended vendor (Best Value > AI > Cheapest)
    let finalVendorId = rec.best_value_vendor_id || rec.ai_recommended_vendor_id || rec.cheapest_vendor_id;
    let finalVendorName = rec.best_value_vendor_name || rec.ai_recommended_vendor_name || rec.cheapest_vendor_name;

    // If AI recommends differently and has analysis, prefer AI
    if (rec.ai_recommended_vendor_id && comp._ai) {
        finalVendorId = rec.ai_recommended_vendor_id;
        finalVendorName = rec.ai_recommended_vendor_name;
    }
    // But if best value = AI recommended, that's the strongest signal
    if (rec.best_value_vendor_id === rec.ai_recommended_vendor_id && rec.best_value_vendor_id) {
        finalVendorId = rec.best_value_vendor_id;
        finalVendorName = rec.best_value_vendor_name;
    }

    if (!finalVendorId) {
        container.innerHTML = '';
        return;
    }

    // Calculate savings vs alternatives
    const finalTotal = vendorTotals.find(v => v.vendor_id === finalVendorId);
    const otherTotals = vendorTotals.filter(v => v.vendor_id !== finalVendorId);
    const mostExpensive = otherTotals.length ? Math.max(...otherTotals.map(v => v.total)) : null;
    const cheapest = vendorTotals.length ? Math.min(...vendorTotals.map(v => v.total)) : null;

    // Build reason bullets — human language, not metrics
    const reasons = [];
    const score = scores.find(s => s.vendor_id === finalVendorId);
    let savingsAmount = null;

    if (finalTotal && mostExpensive && finalTotal.total < mostExpensive) {
        savingsAmount = mostExpensive - finalTotal.total;
    }
    if (score) {
        const qualScore = score.quality_score > 1 ? score.quality_score : score.quality_score * 100;
        const delScore = score.delivery_score > 1 ? score.delivery_score : score.delivery_score * 100;
        if (qualScore >= 80) reasons.push('Strong quality — suitable for premium operations');
        else if (qualScore >= 60) reasons.push('Good quality — suitable for mid-to-upper tier operations');
        else if (qualScore >= 40) reasons.push('Acceptable quality — suitable for standard operations');
        if (delScore >= 90) reasons.push('Highly reliable delivery — low operational risk');
        else if (delScore >= 70) reasons.push('Good delivery track record');
    }
    if (finalVendorId !== rec.cheapest_vendor_id) {
        reasons.push('Avoids quality risks of cheapest option');
    }
    if (finalVendorId === rec.cheapest_vendor_id && finalTotal) {
        reasons.push(`Lowest total cost at ${formatCurrency(finalTotal.total)}`);
    }

    // Determine subtitle based on recommendation type
    let subtitle = 'Best balance of cost and quality for this RFQ';
    if (finalVendorId === rec.cheapest_vendor_id) subtitle = 'Lowest cost with acceptable quality';
    else if (finalVendorId === rec.ai_recommended_vendor_id && finalVendorId !== rec.best_value_vendor_id) subtitle = 'AI-recommended based on qualitative analysis';

    // Confidence — inside card, human readable
    const confPct = comp.confidence_score ? Math.round(comp.confidence_score * 100) : 0;
    let confColor = 'var(--color-success)';
    let confLabel = 'High confidence';
    if (confPct < 40) { confColor = 'var(--color-error)'; confLabel = 'Low confidence'; }
    else if (confPct < 60) { confColor = 'var(--color-warning)'; confLabel = 'Low confidence'; }
    else if (confPct < 80) { confColor = 'var(--color-warning)'; confLabel = 'Moderate confidence'; }
    else { confLabel = 'High confidence'; }

    // Confidence reasons
    const conf = comp._conf || {};
    const confReasons = [];
    confReasons.push(`Based on ${vendorTotals.length} vendor${vendorTotals.length !== 1 ? 's' : ''} quoting`);
    if (!conf.has_performance_data && !conf.has_quality_scores) confReasons.push('Limited historical performance data');
    else if (conf.has_performance_data) confReasons.push('Historical delivery data available');
    if (conf.vendor_history_records > 5) confReasons.push('Price trend data available');
    else confReasons.push('No long-term price trends yet');

    // Decision snapshot — labeled by role, not just name
    const totalItems = det.total_items || (det.item_prices ? det.item_prices.length : 0);
    const sortedTotals = [...vendorTotals].sort((a, b) => a.total - b.total);
    const snapshotRows = sortedTotals.map(vt => {
        const isRec = vt.vendor_id === finalVendorId;
        const isCheapest = vt.total === Math.min(...vendorTotals.map(v => v.total));
        const isPremium = vt.total === Math.max(...vendorTotals.map(v => v.total));
        let roleLabel = '';
        if (isRec) roleLabel = '<span style="color:var(--brand-primary);font-size:10px;font-weight:700;">RECOMMENDED</span>';
        else if (isCheapest) roleLabel = '<span style="color:#10b981;font-size:10px;font-weight:600;">CHEAPEST</span>';
        else if (isPremium) roleLabel = '<span style="color:#f59e0b;font-size:10px;font-weight:600;">PREMIUM</span>';
        const recBg = isRec ? 'background:currentColor;background:color-mix(in srgb, currentColor 5%, transparent);border-radius:8px;padding:8px 10px;margin:0 -10px;border-left:3px solid var(--brand-primary);' : '';
        const quoted = vt.items_quoted || 0;
        const coverageColor = quoted >= totalItems ? '#10b981' : (quoted > totalItems / 2 ? '#f59e0b' : '#ef4444');
        const itemNames = vt.quoted_item_names || [];
        const dataItems = itemNames.length ? ` data-items="${itemNames.map(n => escapeHtml(n)).join('|')}"` : '';
        return `<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid currentColor;border-bottom-color:color-mix(in srgb, currentColor 10%, transparent);${isRec ? 'font-weight:700;' : 'opacity:0.6;'}${recBg}">
            <div style="min-width:0;">
                ${roleLabel}
                <div style="display:flex;align-items:center;gap:6px;">
                    <span style="font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(vt.vendor_name || '')}</span>
                    <span${dataItems} style="font-size:10px;color:${coverageColor};cursor:${itemNames.length ? 'help' : 'default'};text-decoration:${itemNames.length ? 'underline dotted' : 'none'};white-space:nowrap;">${quoted}/${totalItems}</span>
                </div>
            </div>
            <span style="font-size:14px;color:${isRec ? 'var(--brand-primary)' : 'inherit'};font-weight:${isRec ? '800' : '500'};white-space:nowrap;margin-left:16px;${isRec ? '' : 'opacity:0.6;'}">${formatCurrency(vt.total)}</span>
        </div>`;
    }).join('');

    // Confidence reassurance line
    let confReassurance = 'Decision-ready — improves with more cycles';
    if (confPct >= 80) confReassurance = 'Strong data foundation — high reliability';
    else if (confPct < 40) confReassurance = 'Limited data — consider requesting more quotes';

    container.innerHTML = `
        <div class="glass-card" style="padding: 28px; border: 2px solid var(--brand-primary); position: relative; overflow: hidden;">
            <div style="display: flex; gap: 28px; flex-wrap: wrap;">
                <!-- Left: Decision -->
                <div style="flex: 1; min-width: 280px;">
                    <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px;">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--brand-primary)" stroke-width="2.5"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
                        <span style="font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: var(--brand-primary);">Best Vendor for This RFQ</span>
                    </div>
                    <div style="font-size: 24px; font-weight: 800; color: var(--text-primary); margin-bottom: 6px;">${escapeHtml(finalVendorName)}</div>
                    ${finalTotal ? `<div style="display:inline-flex;align-items:center;gap:6px;padding:4px 10px;border-radius:6px;background:rgba(16,185,129,0.1);border:1px solid rgba(16,185,129,0.25);margin-bottom:8px;">
                        <span style="font-size:12px;font-weight:700;color:#10b981;">${finalTotal.items_quoted || 0}/${totalItems} items quoted</span>
                        ${(finalTotal.items_quoted || 0) >= totalItems ? '<span style="font-size:11px;color:#10b981;">&#10003; Full coverage</span>' : `<span style="font-size:11px;color:#f59e0b;">Partial coverage</span>`}
                    </div>` : ''}
                    <div style="font-size: 13px; color: var(--text-secondary); margin-bottom: 4px;">The optimal choice for balancing cost, quality, and risk</div>
                    <div style="font-size: 11px; color: var(--text-secondary); margin-bottom: 16px; opacity: 0.7;">Recommended based on price, quality, and delivery performance</div>
                    <div style="margin-bottom: 4px;">
                        ${finalTotal ? `<div style="font-size: 28px; font-weight: 800; color: var(--brand-primary);">${formatCurrency(finalTotal.total)}</div>` : ''}
                    </div>
                    ${savingsAmount ? `<div style="font-size: 17px; font-weight: 700; color: var(--color-success); margin-bottom: 20px;">${formatCurrency(savingsAmount)} saved vs premium vendor</div>` : '<div style="margin-bottom: 20px;"></div>'}
                    <div style="display: flex; flex-direction: column; gap: 8px; margin-bottom: 22px; padding-top: 4px; border-top: 1px solid var(--border-primary);">
                        ${reasons.slice(0, 3).map(r => `
                            <div style="display: flex; align-items: flex-start; gap: 8px;">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--color-success)" stroke-width="2.5" style="flex-shrink:0; margin-top:2px;"><polyline points="20 6 9 17 4 12"/></svg>
                                <span style="font-size: 13px; color: var(--text-secondary); line-height: 1.4;">${escapeHtml(r)}</span>
                            </div>
                        `).join('')}
                    </div>
                    <button class="btn btn-primary" onclick="selectVendor('${finalVendorId}', '${escapeHtml(finalVendorName)}')" style="font-weight: 700; padding: 12px 32px; font-size: 14px; letter-spacing: 0.3px;">
                        Approve &amp; Generate Purchase Order
                    </button>
                </div>
                <!-- Right: Decision Snapshot + Confidence -->
                <div style="width: 480px; flex-shrink: 0;">
                    <div class="glass-card-sm" style="padding: 16px; margin-bottom: 12px;">
                        <div style="font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: var(--text-secondary); margin-bottom: 8px;">Decision Snapshot</div>
                        ${snapshotRows}
                    </div>
                    <div class="glass-card-sm" style="padding: 14px 16px;">
                        <div style="font-size: 12px; font-weight: 700; color: ${confColor}; margin-bottom: 4px; display: flex; align-items: center; gap: 6px;">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="${confColor}" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
                            ${confLabel}
                        </div>
                        <div style="font-size: 11px; color: var(--text-secondary); margin-bottom: 8px; font-style: italic;">${confReassurance}</div>
                        ${confReasons.map(r => `<div style="font-size: 11px; color: var(--text-secondary); line-height: 1.5;">&#8226; ${escapeHtml(r)}</div>`).join('')}
                    </div>
                </div>
            </div>
        </div>
    `;
}

// ==================== 2. ALTERNATIVES ====================

function renderAlternatives(comp) {
    const grid = document.getElementById('alternativesGrid');
    const rec = comp._rec || {};
    const det = comp._det || {};
    const heur = comp._heur || {};
    const vendorTotals = det.vendor_totals || [];
    const totalItems = det.total_items || (det.item_prices ? det.item_prices.length : 0);

    // Determine final recommended (same logic as above)
    let finalVendorId = rec.best_value_vendor_id || rec.ai_recommended_vendor_id || rec.cheapest_vendor_id;
    if (rec.ai_recommended_vendor_id && comp._ai) finalVendorId = rec.ai_recommended_vendor_id;
    if (rec.best_value_vendor_id === rec.ai_recommended_vendor_id && rec.best_value_vendor_id) finalVendorId = rec.best_value_vendor_id;

    // Build alternative cards for non-recommended vendors
    const alternatives = [];

    // Cheapest (if not the recommended)
    if (rec.cheapest_vendor_id && rec.cheapest_vendor_id !== finalVendorId) {
        const vt = vendorTotals.find(v => v.vendor_id === rec.cheapest_vendor_id);
        const score = (heur.vendor_scores || []).find(s => s.vendor_id === rec.cheapest_vendor_id);
        const qualScore = score ? (score.quality_score > 1 ? score.quality_score : score.quality_score * 100) : 50;
        alternatives.push({
            vendor_id: rec.cheapest_vendor_id,
            vendor_name: rec.cheapest_vendor_name,
            tag: 'Cheapest',
            tagColor: 'var(--color-success)',
            tagline: 'Short-term savings, long-term risk',
            total: vt ? vt.total : null,
            lines: [
                qualScore < 50 ? 'Low quality — high replacement risk' : 'Acceptable quality for budget operations',
                '<strong style="color:var(--color-error);">Not suitable for premium operations</strong>'
            ]
        });
    }

    // Premium / most expensive (if not recommended and not cheapest)
    const sortedByPrice = [...vendorTotals].sort((a, b) => b.total - a.total);
    const premiumVendor = sortedByPrice[0];
    if (premiumVendor && premiumVendor.vendor_id !== finalVendorId && premiumVendor.vendor_id !== rec.cheapest_vendor_id) {
        const score = (heur.vendor_scores || []).find(s => s.vendor_id === premiumVendor.vendor_id);
        const qualScore = score ? (score.quality_score > 1 ? score.quality_score : score.quality_score * 100) : 50;
        const cheapestTotal = vendorTotals.length ? Math.min(...vendorTotals.map(v => v.total)) : 0;
        const premiumPct = cheapestTotal > 0 ? Math.round(((premiumVendor.total - cheapestTotal) / cheapestTotal) * 100) : 0;
        // Calculate cost difference vs recommended
        const recTotal = vendorTotals.find(v => v.vendor_id === finalVendorId);
        const premiumExtra = recTotal ? premiumVendor.total - recTotal.total : 0;
        alternatives.push({
            vendor_id: premiumVendor.vendor_id,
            vendor_name: premiumVendor.vendor_name,
            tag: 'Premium',
            tagColor: 'var(--color-warning)',
            tagline: 'Best quality, but high cost premium',
            total: premiumVendor.total,
            lines: [
                premiumExtra > 0 ? `<strong style="color:var(--color-warning);">${formatCurrency(premiumExtra)} more than recommended</strong>` : `${premiumPct}% above cheapest option`,
                qualScore >= 80 ? 'Top quality — justified for high-end requirements' : 'Premium pricing without clear quality advantage'
            ]
        });
    }

    // Any remaining vendors
    vendorTotals.forEach(vt => {
        if (vt.vendor_id === finalVendorId) return;
        if (alternatives.find(a => a.vendor_id === vt.vendor_id)) return;
        const score = (heur.vendor_scores || []).find(s => s.vendor_id === vt.vendor_id);
        const wt = score ? (score.weighted_total > 1 ? Math.round(score.weighted_total) : Math.round(score.weighted_total * 100)) : 0;
        alternatives.push({
            vendor_id: vt.vendor_id,
            vendor_name: vt.vendor_name,
            tag: 'Alternative',
            tagColor: 'var(--text-secondary)',
            total: vt.total,
            lines: [
                `Total: ${formatCurrency(vt.total)}`,
                `Weighted score: ${wt}`,
                'Available as backup'
            ]
        });
    });

    if (!alternatives.length) {
        document.getElementById('alternativesSection').style.display = 'none';
        return;
    }

    grid.innerHTML = alternatives.map(alt => `
        <div class="glass-card" style="padding: 16px;">
            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px;">
                <span style="font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: ${alt.tagColor};">${escapeHtml(alt.tag)}</span>
                ${alt.total ? `<span style="font-size: 15px; font-weight: 700; color: var(--text-primary);">${formatCurrency(alt.total)}</span>` : ''}
            </div>
            <div style="font-size: 15px; font-weight: 700; color: var(--text-primary); margin-bottom: 2px;">${escapeHtml(alt.vendor_name)}</div>
            ${(() => {
                const vt = vendorTotals.find(v => v.vendor_id === alt.vendor_id);
                const q = vt ? vt.items_quoted : 0;
                const c = q >= totalItems ? '#10b981' : (q > totalItems / 2 ? '#f59e0b' : '#ef4444');
                return `<div style="font-size:11px;color:${c};font-weight:600;margin-bottom:4px;">${q}/${totalItems} items${q >= totalItems ? '' : ' — partial coverage'}</div>`;
            })()}
            ${alt.tagline ? `<div style="font-size: 12px; color: var(--text-secondary); font-style: italic; margin-bottom: 10px;">${escapeHtml(alt.tagline)}</div>` : ''}
            <div style="display: flex; flex-direction: column; gap: 3px; margin-bottom: 12px;">
                ${alt.lines.map(l => `<span style="font-size: 12px; color: var(--text-secondary); line-height: 1.4;">${l.startsWith('<') ? l : escapeHtml(l)}</span>`).join('')}
            </div>
            <button class="btn btn-secondary btn-sm" onclick="selectVendor('${alt.vendor_id}', '${escapeHtml(alt.vendor_name)}')" style="font-size: 12px;">
                Select Instead
            </button>
        </div>
    `).join('');
}

// ==================== 3. AI ANALYSIS (Compressed) ====================

function renderAiAnalysis(comp) {
    const analysis = comp._ai;
    const section = document.getElementById('aiAnalysisSection');

    if (!analysis) {
        section.style.display = 'none';
        return;
    }

    section.style.display = '';

    const summaryEl = document.getElementById('aiCompactSummary');
    const detailsEl = document.getElementById('aiDetailedInsights');

    if (!analysis.vendor_insights || !analysis.vendor_insights.length) {
        if (analysis.summary) {
            summaryEl.innerHTML = `<div style="font-size: 13px; color: var(--text-secondary); line-height: 1.6;">${escapeHtml(analysis.summary)}</div>`;
        }
        return;
    }

    // Sort by rank (post-processed)
    const sorted = [...analysis.vendor_insights].sort((a, b) => (a.rank || 99) - (b.rank || 99));
    const topVendor = sorted[0];

    // Risk styling
    const riskStyle = (level) => {
        const map = {
            'low': { color: 'var(--color-success)', bg: 'var(--bg-tertiary)', icon: '🟢', label: 'Low Risk' },
            'medium': { color: 'var(--color-warning)', bg: 'var(--bg-tertiary)', icon: '🟡', label: 'Medium Risk' },
            'high': { color: 'var(--color-error)', bg: 'var(--bg-tertiary)', icon: '🔴', label: 'High Risk' },
            'critical': { color: 'var(--color-error)', bg: 'var(--bg-tertiary)', icon: '⛔', label: 'Critical Risk' }
        };
        return map[level] || map['medium'];
    };

    // TOP VENDOR CARD (prominent)
    const topRisk = riskStyle(topVendor.risk_level);
    const topRec = topVendor.recommendation || '';
    summaryEl.innerHTML = `
        <div class="glass-card" style="padding: 16px; border: 2px solid var(--brand-primary); margin-bottom: 12px;">
            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;">
                <div style="display: flex; align-items: center; gap: 8px;">
                    <span style="font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: var(--brand-primary);">AI Top Pick — Rank #${topVendor.rank || 1}</span>
                </div>
                <span style="font-size: 11px; padding: 2px 8px; border-radius: 6px; background: ${topRisk.bg}; color: ${topRisk.color}; font-weight: 600;">${topRisk.icon} ${topRisk.label}</span>
            </div>
            <div style="font-size: 16px; font-weight: 800; color: var(--text-primary); margin-bottom: 4px;">${escapeHtml(topVendor.vendor_name || '')}</div>
            <div style="font-size: 13px; color: var(--text-secondary); line-height: 1.5;">${escapeHtml(topRec)}</div>
        </div>
    `;

    // RANKED VENDOR CARDS (all vendors sorted by rank)
    detailsEl.innerHTML = `<div style="display: grid; gap: 10px;">` +
        sorted.map(insight => {
            const risk = riskStyle(insight.risk_level);
            const isReject = (insight.risk_level === 'critical' || insight.risk_level === 'high');
            const isTopRank = insight.rank <= 2 && !isReject;
            const borderColor = isReject ? 'var(--color-error)' : (isTopRank ? 'var(--color-success)' : 'var(--border-primary)');
            const rec = insight.recommendation || '';
            const quality = insight.quality_assessment || '';
            const pricing = insight.price_justification || '';

            return `
            <div class="glass-card-sm" style="padding: 14px; ${isTopRank ? 'border: 2px solid ' + borderColor + ';' : 'border: 1px solid ' + borderColor + ';'} ${isReject ? 'opacity: 0.7;' : ''}">
                <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px;">
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <span style="font-size: 11px; font-weight: 700; color: var(--text-secondary); background: var(--bg-tertiary); padding: 1px 6px; border-radius: 4px;">#${insight.rank || '?'}</span>
                        <span style="font-weight: 700; color: var(--text-primary); font-size: 13px;">${escapeHtml(insight.vendor_name || '')}</span>
                    </div>
                    <span style="font-size: 10px; padding: 2px 6px; border-radius: 4px; background: ${risk.bg}; color: ${risk.color}; font-weight: 600;">${risk.icon} ${risk.label}</span>
                </div>
                ${rec ? `<div style="font-size: 12px; color: var(--text-secondary); margin-bottom: 2px;">${escapeHtml(rec)}</div>` : ''}
                ${quality ? `<div style="font-size: 12px; color: var(--text-secondary); margin-bottom: 2px;">${escapeHtml(quality)}</div>` : ''}
                ${pricing ? `<div style="font-size: 12px; color: var(--text-secondary);">${escapeHtml(pricing)}</div>` : ''}
            </div>`;
        }).join('') + '</div>';
}


function toggleAiDetails() {
    aiDetailsExpanded = !aiDetailsExpanded;
    document.getElementById('aiDetailedInsights').style.display = aiDetailsExpanded ? '' : 'none';
    document.getElementById('aiToggleIcon').style.transform = aiDetailsExpanded ? 'rotate(180deg)' : 'rotate(0deg)';
}

// ==================== 4. PRICE MATRIX ====================

function renderPriceMatrix(comp) {
    const det = comp._det || {};
    const itemPrices = det.item_prices || [];
    const vendorTotals = det.vendor_totals || [];

    const thead = document.getElementById('priceMatrixHead');
    const tbody = document.getElementById('priceMatrixBody');

    if (!itemPrices.length) {
        thead.innerHTML = '<tr><th>Item</th></tr>';
        tbody.innerHTML = '<tr><td class="crm-empty-state"><div class="crm-empty-content"><p>No price data</p></div></td></tr>';
        return;
    }

    const vendorNames = [];
    const vendorIds = [];
    if (itemPrices[0]?.vendor_prices) {
        itemPrices[0].vendor_prices.forEach(vp => {
            vendorNames.push(vp.vendor_name);
            vendorIds.push(vp.vendor_id);
        });
    }

    let headerHtml = '<tr><th>Item</th><th>Qty</th>';
    vendorNames.forEach(name => { headerHtml += `<th style="text-align: right;">${escapeHtml(name)}</th>`; });
    headerHtml += '</tr>';
    thead.innerHTML = headerHtml;

    let rowsHtml = '';
    itemPrices.forEach(item => {
        const prices = item.vendor_prices || [];
        const validPrices = prices.filter(p => p.unit_price !== null && p.unit_price !== undefined);
        const lowestPrice = validPrices.length > 0 ? Math.min(...validPrices.map(p => p.unit_price)) : null;

        rowsHtml += '<tr>';
        rowsHtml += `<td><div style="color: var(--text-primary); font-weight: 500;">${escapeHtml(item.item_name || '')}</div></td>`;
        rowsHtml += `<td><span class="crm-cell-secondary">${item.quantity || '-'} ${escapeHtml(item.unit || '')}</span></td>`;
        vendorIds.forEach(vid => {
            const vp = prices.find(p => p.vendor_id === vid);
            const price = vp ? vp.unit_price : null;
            const isLowest = price !== null && price === lowestPrice && validPrices.length > 1;
            const cellStyle = isLowest ? 'color: var(--color-success); font-weight: 700;' : 'color: var(--text-primary);';
            rowsHtml += `<td style="text-align: right;"><span style="${cellStyle}">${price !== null ? formatCurrency(price) : '-'}</span></td>`;
        });
        rowsHtml += '</tr>';
    });

    // Totals row
    const lowestTotal = vendorTotals.length > 0 ? Math.min(...vendorTotals.map(v => v.total)) : null;
    rowsHtml += '<tr style="border-top: 2px solid var(--border-primary); font-weight: 700;">';
    rowsHtml += '<td style="color: var(--text-primary);">Total</td><td></td>';
    vendorIds.forEach(vid => {
        const vt = vendorTotals.find(v => v.vendor_id === vid);
        const total = vt ? vt.total : null;
        const isLowest = total !== null && total === lowestTotal && vendorTotals.length > 1;
        const cellStyle = isLowest ? 'color: var(--color-success); font-weight: 700;' : 'color: var(--text-primary);';
        rowsHtml += `<td style="text-align: right;"><span style="${cellStyle}">${total !== null ? formatCurrency(total) : '-'}</span></td>`;
    });
    rowsHtml += '</tr>';
    tbody.innerHTML = rowsHtml;
}

// ==================== Scores ====================

function renderScores(comp) {
    const heur = comp._heur || {};
    const scores = heur.vendor_scores || [];
    const tbody = document.getElementById('scoresTableBody');

    if (!scores.length) {
        tbody.innerHTML = '<tr><td colspan="5" class="crm-empty-state"><div class="crm-empty-content"><p>No scores</p></div></td></tr>';
        return;
    }

    const maxWeighted = Math.max(...scores.map(s => s.weighted_total || s.total_score || 0));

    tbody.innerHTML = scores.map(s => {
        const isTop = (s.weighted_total || s.total_score || 0) === maxWeighted && scores.length > 1;
        const rowStyle = isTop ? 'background: var(--bg-tertiary);' : '';
        return `
            <tr style="${rowStyle}">
                <td>
                    <div style="color: var(--text-primary); font-weight: 500;">
                        ${escapeHtml(s.vendor_name || '')}
                        ${isTop ? '<span style="color: var(--color-success); font-size: 11px; margin-left: 6px;">Best Value</span>' : ''}
                    </div>
                </td>
                <td>${renderScoreBar(s.price_score)}</td>
                <td>${renderScoreBar(s.quality_score)}</td>
                <td>${renderScoreBar(s.delivery_score)}</td>
                <td>${renderScoreBar(s.weighted_total || s.total_score || 0)}</td>
            </tr>
        `;
    }).join('');
}

function renderScoreBar(score) {
    if (score === null || score === undefined) return '<span style="opacity:0.4;">-</span>';
    const pct = score > 1 ? Math.round(score) : Math.round(score * 100);
    // Use hardcoded colors — CSS variables may not exist in branded themes
    let color = '#10b981'; // green
    if (pct < 40) color = '#ef4444'; // red
    else if (pct < 70) color = '#f59e0b'; // amber

    if (pct === 0) {
        return `
            <div style="display: flex; align-items: center; gap: 8px;">
                <div style="width: 80px; min-width: 80px; height: 7px; background: color-mix(in srgb, currentColor 15%, transparent); border-radius: 4px;"></div>
                <span style="font-size: 12px; font-weight: 600; color: ${color};">0</span>
            </div>
        `;
    }

    return `
        <div style="display: flex; align-items: center; gap: 8px;">
            <div style="width: 80px; min-width: 80px; height: 7px; background: color-mix(in srgb, currentColor 15%, transparent); border-radius: 4px; overflow: hidden;">
                <div style="width: ${Math.min(pct, 100)}%; height: 100%; background: ${color}; border-radius: 4px;"></div>
            </div>
            <span style="font-size: 12px; font-weight: 600;">${pct}</span>
        </div>
    `;
}

// ==================== Section Toggle ====================

function toggleSection(sectionId, iconId) {
    const section = document.getElementById(sectionId);
    const icon = document.getElementById(iconId);
    const isHidden = section.style.display === 'none';
    section.style.display = isHidden ? '' : 'none';
    if (icon) icon.style.transform = isHidden ? 'rotate(180deg)' : 'rotate(0deg)';
}

// ==================== 5. LEARNING PROGRESS ====================

async function loadAndRenderLearningProgress(comp) {
    try {
        const response = await api.request('/procurement/vendor-performance/summaries', { _skipSpinner: true });
        vendorPerformanceSummaries = response.data || response || [];
    } catch {
        vendorPerformanceSummaries = [];
    }
    renderLearningProgress(comp);
}

function renderLearningProgress(comp) {
    const section = document.getElementById('learningProgressSection');
    const heur = comp._heur || {};
    const scores = heur.vendor_scores || [];
    const conf = comp._conf || {};

    if (!scores.length) { section.style.display = 'none'; return; }
    section.style.display = '';

    const priceWeight = heur.price_weight || 0.5;
    const qualityWeight = heur.quality_weight || 0.3;
    const deliveryWeight = heur.delivery_weight || 0.2;

    const vendorLearning = scores.map(s => {
        const perf = vendorPerformanceSummaries.find(p => p.vendor_id === s.vendor_id);
        const hasData = perf && perf.total_orders > 0;
        const defaultQuality = 50, defaultDelivery = 100;
        const priceScore = s.price_score > 1 ? s.price_score : s.price_score * 100;
        const actualQuality = s.quality_score > 1 ? s.quality_score : s.quality_score * 100;
        const actualDelivery = s.delivery_score > 1 ? s.delivery_score : s.delivery_score * 100;
        const weightedBefore = Math.round(priceScore * priceWeight + defaultQuality * qualityWeight + defaultDelivery * deliveryWeight);
        const weightedAfter = Math.round(priceScore * priceWeight + actualQuality * qualityWeight + actualDelivery * deliveryWeight);

        return {
            vendor_name: s.vendor_name, vendor_id: s.vendor_id, has_data: hasData,
            total_orders: perf ? perf.total_orders : 0,
            times_selected: perf ? perf.times_selected : 0,
            price_score: Math.round(priceScore),
            quality_before: defaultQuality, quality_after: Math.round(actualQuality),
            delivery_before: defaultDelivery, delivery_after: Math.round(actualDelivery),
            weighted_before: weightedBefore, weighted_after: weightedAfter,
            change: weightedAfter - weightedBefore
        };
    });

    const totalDataPoints = vendorPerformanceSummaries.reduce((sum, p) => sum + (p.total_orders || 0), 0);
    const totalSelections = vendorPerformanceSummaries.reduce((sum, p) => sum + (p.times_selected || 0), 0);
    const vendorsWithData = vendorLearning.filter(v => v.has_data).length;
    const confidencePct = conf.score ? Math.round(conf.score * 100) : (comp.confidence_score ? Math.round(comp.confidence_score * 100) : 0);

    // Badge — human language
    const badge = document.getElementById('learningCycleBadge');
    if (totalDataPoints === 0) badge.textContent = 'No data yet';
    else badge.textContent = `${totalDataPoints} records`;

    // Confidence chip
    const confChip = document.getElementById('learningConfidenceChip');
    let confColor = 'var(--color-success)';
    if (confidencePct < 50) confColor = 'var(--color-error)';
    else if (confidencePct < 75) confColor = 'var(--color-warning)';

    // Human-readable confidence for learning section
    const vendorsImproved = vendorLearning.filter(v => v.change > 0).length;
    const vendorsDeclined = vendorLearning.filter(v => v.change < 0).length;
    let learningStatus = '';
    if (vendorsImproved > 0 && vendorsDeclined > 0) learningStatus = `${vendorsImproved} improved, ${vendorsDeclined} flagged`;
    else if (vendorsImproved > 0) learningStatus = `${vendorsImproved} vendor${vendorsImproved > 1 ? 's' : ''} improved`;
    else if (vendorsDeclined > 0) learningStatus = `${vendorsDeclined} vendor${vendorsDeclined > 1 ? 's' : ''} flagged`;
    else learningStatus = 'Using defaults';

    confChip.innerHTML = `<span style="color: ${confColor};">${learningStatus}</span>`;

    // Summary strip — human language, not raw numbers
    const strip = document.getElementById('learningSummaryStrip');
    strip.innerHTML = `
        ${renderLearningStatCard(totalDataPoints, 'Records', 'var(--color-info)')}
        ${renderLearningStatCard(`${vendorsWithData}/${scores.length}`, 'Vendors Tracked', 'var(--brand-primary)')}
        ${renderLearningStatCard(`${confidencePct}%`, 'Confidence', confColor)}
        ${renderLearningStatCard(renderBestChange(vendorLearning), 'Biggest Shift', renderBestChangeColor(vendorLearning))}
    `;

    // Before vs After table
    const tbody = document.getElementById('learningScoresBody');
    tbody.innerHTML = vendorLearning.map(v => {
        const changeColor = v.change > 0 ? 'var(--color-success)' : v.change < 0 ? 'var(--color-error)' : 'var(--text-secondary)';
        const changeIcon = v.change > 0 ? '&#9650;' : v.change < 0 ? '&#9660;' : '&#8212;';
        const tag = v.has_data
            ? '<span style="font-size:10px;padding:1px 6px;border-radius:4px;background:var(--bg-tertiary);color:var(--color-success);margin-left:6px;">learned</span>'
            : '<span style="font-size:10px;padding:1px 6px;border-radius:4px;background:var(--bg-tertiary);color:var(--color-warning);margin-left:6px;">default</span>';

        return `<tr>
            <td><div style="color:var(--text-primary);font-weight:500;">${escapeHtml(v.vendor_name)}${tag}</div></td>
            <td><span style="color:var(--text-secondary);">${v.quality_before}</span></td>
            <td>${renderLearningScoreCell(v.quality_after, v.quality_before)}</td>
            <td><span style="color:var(--text-secondary);">${v.delivery_before}</span></td>
            <td>${renderLearningScoreCell(v.delivery_after, v.delivery_before)}</td>
            <td><span style="color:var(--text-secondary);">${v.weighted_before}</span></td>
            <td style="font-weight:700;color:var(--text-primary);">${v.weighted_after}</td>
            <td><span style="color:${changeColor};font-weight:700;font-size:14px;">${changeIcon} ${v.change > 0 ? '+' : ''}${v.change}</span></td>
        </tr>`;
    }).join('');

    // Data points — human language
    const dataGrid = document.getElementById('learningDataPoints');
    const hasDelivery = vendorPerformanceSummaries.some(p => p.avg_delivery_variance !== null && p.avg_delivery_variance !== 0);
    const hasQuality = vendorPerformanceSummaries.some(p => p.avg_quality_score > 0);
    dataGrid.innerHTML = `
        ${renderDataPointCard('Delivery', hasDelivery, hasDelivery ? 'Tracking on-time performance' : 'No delivery data yet')}
        ${renderDataPointCard('Quality', hasQuality, hasQuality ? 'Rating from past orders' : 'No ratings yet')}
        ${renderDataPointCard('Selections', totalSelections > 0, totalSelections > 0 ? `${totalSelections} decisions recorded` : 'No selections recorded')}
        ${renderDataPointCard('Price History', (conf.vendor_history_records || 0) > 0, (conf.vendor_history_records || 0) > 0 ? `${conf.vendor_history_records} records` : 'No history yet')}
    `;
}

function renderLearningStatCard(value, label, color) {
    return `<div style="text-align:center;min-width:80px;">
        <div style="font-size:18px;font-weight:700;color:${color};">${value}</div>
        <div style="font-size:10px;color:var(--text-secondary);margin-top:2px;">${label}</div>
    </div>`;
}

function renderLearningScoreCell(actual, before) {
    const diff = actual - before;
    if (diff === 0) return `<span style="color:var(--text-primary);">${actual}</span>`;
    const color = diff > 0 ? 'var(--color-success)' : 'var(--color-error)';
    const arrow = diff > 0 ? '&#9650;' : '&#9660;';
    return `<span style="color:var(--text-primary);font-weight:600;">${actual}</span> <span style="color:${color};font-size:11px;">${arrow}${diff > 0 ? '+' : ''}${diff}</span>`;
}

function renderBestChange(vendorLearning) {
    if (!vendorLearning.length) return '-';
    const best = vendorLearning.reduce((max, v) => Math.abs(v.change) > Math.abs(max.change) ? v : max, vendorLearning[0]);
    if (best.change === 0) return 'None';
    return `${best.change > 0 ? '+' : ''}${best.change} pts`;
}

function renderBestChangeColor(vendorLearning) {
    if (!vendorLearning.length) return 'var(--text-secondary)';
    const best = vendorLearning.reduce((max, v) => Math.abs(v.change) > Math.abs(max.change) ? v : max, vendorLearning[0]);
    return best.change > 0 ? 'var(--color-success)' : best.change < 0 ? 'var(--color-error)' : 'var(--text-secondary)';
}

function renderDataPointCard(title, isActive, description) {
    const check = isActive
        ? '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--color-success)" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>'
        : '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" stroke-width="2"><circle cx="12" cy="12" r="10"/></svg>';
    return `<div class="glass-card-sm" style="padding:10px;${isActive ? 'border-color:var(--color-success);' : ''}">
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:2px;">${check}
            <span style="font-size:12px;font-weight:600;color:${isActive ? 'var(--text-primary)' : 'var(--text-muted)'};">${title}</span>
        </div>
        <div style="font-size:11px;color:var(--text-secondary);padding-left:18px;">${description}</div>
    </div>`;
}

function toggleLearningDetails() {
    learningDetailsExpanded = !learningDetailsExpanded;
    document.getElementById('learningDetails').style.display = learningDetailsExpanded ? '' : 'none';
    document.getElementById('learningToggleIcon').style.transform = learningDetailsExpanded ? 'rotate(180deg)' : 'rotate(0deg)';
}

// ==================== Actions ====================

async function generateComparison() {
    const confirmed = await showConfirm(
        'Generate a new quote comparison for this RFQ? This will analyze all submitted vendor quotes.',
        'Generate Comparison', 'primary'
    );
    if (!confirmed) return;

    try {
        const response = await api.request('/procurement/comparisons/generate', {
            method: 'POST', body: JSON.stringify({ rfq_id: rfqId })
        });
        Toast.success('Comparison generated');
        currentComparison = response.data || response;
        renderComparison();
    } catch (error) {
        console.error('Failed to generate comparison:', error);
        Toast.error(error.message || 'Failed to generate comparison');
    }
}

async function selectVendor(vendorId, vendorName) {
    // Check coverage before confirming
    const missingItems = getMissingItemNames(vendorId);
    const det = currentComparison?._det || {};
    const totalItems = det.total_items || (det.item_prices ? det.item_prices.length : 0);
    const quotedItems = totalItems - missingItems.length;

    let confirmMsg = `Select ${vendorName}? This will allow you to create a purchase order.`;
    if (missingItems.length > 0) {
        confirmMsg = `Select ${vendorName}?\n\n` +
            `⚠️ This vendor quoted ${quotedItems}/${totalItems} items. ` +
            `${missingItems.length} item(s) will NOT be in the purchase order:\n` +
            missingItems.map(n => `  • ${n}`).join('\n') +
            `\n\nProceed anyway?`;
    }

    const confirmed = await showConfirm(confirmMsg, 'Confirm Selection', 'primary');
    if (!confirmed) return;

    try {
        const response = await api.request(`/procurement/comparisons/${currentComparison.id}/select-vendor`, {
            method: 'PUT', body: JSON.stringify({ vendor_id: vendorId })
        });

        // Show coverage warnings from backend
        const warnings = response.coverage_warnings || [];
        if (warnings.length > 0) {
            Toast.warning(`Note: ${warnings[0].message}`);
        } else {
            Toast.success('Vendor selected');
        }

        const createPo = await showConfirm(
            'Create a Purchase Order for this vendor?',
            'Create PO', 'primary'
        );
        if (createPo) {
            window.location.href = `purchase-orders.html?fromComparison=${currentComparison.id}`;
        } else {
            loadComparison();
        }
    } catch (error) {
        console.error('Failed to select vendor:', error);
        Toast.error(error.message || 'Failed to select vendor');
    }
}

function getMissingItemNames(vendorId) {
    const det = currentComparison?._det || {};
    const itemPrices = det.item_prices || [];
    return itemPrices
        .filter(item => !(item.vendor_prices || []).some(vp => vp.vendor_id === vendorId))
        .map(item => item.item_name);
}

function goBack() {
    window.location.href = rfqId ? `rfqs.html#detail/${rfqId}` : 'rfqs.html';
}

// ==================== AI Analysis Action ====================

async function runAiAnalysis(isRegenerate = false) {
    if (!rfqId) { Toast.error('No RFQ ID'); return; }

    if (!isRegenerate && currentComparison && currentComparison._ai) {
        const section = document.getElementById('aiAnalysisSection');
        if (section) {
            section.style.display = '';
            section.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
        return;
    }

    const btn = document.getElementById('aiAnalysisBtn');
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = `<span class="btn-spinner" style="display:inline-block;"></span> Analyzing...`;
    }

    try {
        await api.request('/procurement/procurement-ai/analyze-quotes', {
            method: 'POST', body: JSON.stringify({ rfq_id: rfqId })
        });
        Toast.success('AI analysis complete');
        await loadComparison();
    } catch (error) {
        console.error('AI analysis failed:', error);
        Toast.error(error.status === 503 ? 'AI service unavailable' : (error.message || 'AI analysis failed'));
    } finally {
        if (btn) {
            btn.disabled = false;
            const hasCached = currentComparison && currentComparison._ai;
            btn.innerHTML = `
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    ${hasCached ? '<polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>' : '<path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2z"/><path d="M12 6v6l4 2"/>'}
                </svg>
                ${hasCached ? 'Regenerate AI' : 'AI Analysis'}
            `;
        }
    }
}

// ==================== Utilities ====================

function formatCurrency(amount) {
    if (amount === null || amount === undefined) return '-';
    return parseFloat(amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ==================== COMPARISON HISTORY ====================

async function loadComparisonHistory() {
    if (!rfqId) return;
    try {
        const data = await api.request(`/procurement/comparisons/history?rfqId=${rfqId}`);
        const history = data.data || data || [];
        if (history.length <= 1) {
            Toast.info('Only one version exists');
            return;
        }
        const msg = history.map(h =>
            `v${h.version} — ${formatDate(h.created_at)} — ${h.status}${h.selected_vendor_name ? ' → ' + h.selected_vendor_name : ''}`
        ).join('\n');
        const selected = await showConfirm(
            `Comparison versions:\n\n${msg}\n\nCurrently viewing v${currentComparison.version}.`,
            'Version History', 'primary'
        );
    } catch (e) {
        Toast.error('Failed to load history');
    }
}

function formatDate(dateStr) {
    if (!dateStr) return '-';
    try { return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); }
    catch { return dateStr; }
}

// ==================== SPLIT AWARD ====================

function renderSplitAwardToggle(comp) {
    const container = document.getElementById('splitAwardSection');
    const rec = comp._rec || {};
    const basket = rec.optimal_basket;

    // Only show if there are multiple vendors with different cheapest-per-item
    if (!basket || basket.vendor_count <= 1) {
        container.style.display = 'none';
        return;
    }

    container.style.display = '';
    splitAllocations = (basket.allocations || []).map(a => ({
        inquiry_item_id: a.inquiry_item_id,
        vendor_id: a.vendor_id
    }));

    const savingsColor = basket.savings_percent >= 5 ? 'var(--color-success)' : basket.savings_percent >= 2 ? 'var(--color-warning)' : 'var(--text-secondary)';
    const modeRec = basket.recommended_mode === 'split'
        ? `<span style="color:var(--color-success);font-weight:600;">Split recommended</span> — saves ${basket.savings_percent}%`
        : `<span style="color:var(--text-secondary);">Split available</span> — saves ${basket.savings_percent}%`;

    container.innerHTML = `
        <div class="glass-card" style="padding: 20px;">
            <!-- Toggle -->
            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px;">
                <div>
                    <div style="font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: var(--text-secondary); margin-bottom: 4px;">Award Mode</div>
                    <div style="font-size: 12px; color: var(--text-secondary);">${modeRec}</div>
                </div>
                <div style="display: flex; border: 1px solid var(--border-primary); border-radius: 8px; overflow: hidden;">
                    <button id="btnModeSingle" onclick="switchAwardMode('single')" style="padding: 6px 16px; font-size: 12px; font-weight: 600; border: none; cursor: pointer; transition: all 0.2s; background: var(--brand-primary); color: var(--text-inverse);">
                        Single Vendor
                    </button>
                    <button id="btnModeSplit" onclick="switchAwardMode('split')" style="padding: 6px 16px; font-size: 12px; font-weight: 600; border: none; cursor: pointer; transition: all 0.2s; background: var(--bg-secondary); color: var(--text-secondary);">
                        Split Award
                    </button>
                </div>
            </div>
            <!-- Split Award Content (hidden by default) -->
            <div id="splitAwardContent" style="display: none;">
                <!-- Savings banner -->
                <div class="glass-card-sm" style="padding: 14px 16px; margin-bottom: 16px; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px;">
                    <div>
                        <div style="font-size: 14px; font-weight: 700; color: var(--text-primary);">
                            Split across ${basket.vendor_count} vendors
                        </div>
                        <div style="font-size: 12px; color: var(--text-secondary);">
                            Complexity: <span style="font-weight: 600; text-transform: capitalize;">${basket.complexity_level}</span>
                        </div>
                    </div>
                    <div style="text-align: right;">
                        <div style="font-size: 18px; font-weight: 800; color: ${savingsColor};">${formatCurrency(basket.savings_amount)} saved</div>
                        <div style="font-size: 12px; color: var(--text-secondary);">${basket.savings_percent}% vs best single vendor (${formatCurrency(basket.single_vendor_best_total)})</div>
                    </div>
                </div>
                <!-- Per-item allocation table -->
                <div class="crm-table-wrapper data-table-container" style="margin-bottom: 16px;">
                    <table class="crm-table data-table" id="splitAllocationTable">
                        <thead>
                            <tr>
                                <th>Item</th>
                                <th>Qty</th>
                                <th>Assigned Vendor</th>
                                <th style="text-align:right;">Unit Price</th>
                                <th style="text-align:right;">Total</th>
                            </tr>
                        </thead>
                        <tbody id="splitAllocationBody"></tbody>
                    </table>
                </div>
                <!-- Actions -->
                <div style="display: flex; align-items: center; gap: 12px; flex-wrap: wrap;">
                    <button class="btn btn-primary" onclick="confirmSplitAward()" style="font-weight: 700; padding: 10px 24px; font-size: 13px;">
                        Approve Split &amp; Generate ${basket.vendor_count} Purchase Orders
                    </button>
                    <span id="splitPreviewStatus" style="font-size: 12px; color: var(--text-secondary);"></span>
                </div>
            </div>
        </div>
    `;

    // Render allocation table rows
    renderSplitAllocationRows(comp);
}

function renderSplitAllocationRows(comp) {
    const det = comp._det || {};
    const itemPrices = det.item_prices || [];
    const rec = comp._rec || {};
    const basket = rec.optimal_basket;
    if (!basket) return;

    const tbody = document.getElementById('splitAllocationBody');
    if (!tbody) return;

    // Build vendor options from all quoting vendors
    const allVendors = new Map();
    itemPrices.forEach(item => {
        (item.vendor_prices || []).forEach(vp => {
            allVendors.set(vp.vendor_id, vp.vendor_name);
        });
    });

    let totalOptimal = 0;
    const rowsData = []; // Store for post-render dropdown init

    tbody.innerHTML = itemPrices.map((item, idx) => {
        const alloc = (basket.allocations || []).find(a => a.inquiry_item_id === item.inquiry_item_id);
        const assignedVendorId = splitAllocations.find(a => a.inquiry_item_id === item.inquiry_item_id)?.vendor_id || alloc?.vendor_id;
        const prices = item.vendor_prices || [];
        const assignedPrice = prices.find(p => p.vendor_id === assignedVendorId);
        const cheapestPrice = prices.length ? Math.min(...prices.map(p => p.unit_price)) : 0;
        const unitPrice = assignedPrice ? assignedPrice.unit_price : 0;
        const totalPrice = unitPrice * item.quantity;
        const isCheapest = unitPrice === cheapestPrice;
        totalOptimal += totalPrice;

        const containerId = `split-vendor-${idx}`;
        rowsData.push({
            containerId,
            itemId: item.inquiry_item_id,
            assignedVendorId,
            prices,
            cheapestPrice
        });

        return `<tr>
            <td><div style="color:var(--text-primary);font-weight:500;">${escapeHtml(item.item_name)}</div></td>
            <td><span class="crm-cell-secondary">${item.quantity} ${escapeHtml(item.unit || '')}</span></td>
            <td><div id="${containerId}" style="min-width:200px;"></div></td>
            <td style="text-align:right;"><span style="color:${isCheapest ? 'var(--color-success)' : 'var(--text-primary)'};font-weight:${isCheapest ? '700' : '400'};">${formatCurrency(unitPrice)}</span></td>
            <td style="text-align:right;font-weight:600;color:var(--text-primary);">${formatCurrency(totalPrice)}</td>
        </tr>`;
    }).join('');

    // Add total row
    tbody.innerHTML += `<tr style="border-top:2px solid var(--border-primary);font-weight:700;">
        <td colspan="3" style="color:var(--text-primary);">Split Award Total</td>
        <td></td>
        <td style="text-align:right;color:var(--brand-primary);font-size:15px;">${formatCurrency(totalOptimal)}</td>
    </tr>`;

    // Update split award button with current vendor count
    const currentVendorCount = new Set(splitAllocations.map(a => a.vendor_id)).size;
    const splitBtn = document.querySelector('#splitAwardContent .btn-primary');
    if (splitBtn) {
        splitBtn.innerHTML = `Approve Split &amp; Generate ${currentVendorCount} Purchase Order${currentVendorCount !== 1 ? 's' : ''}`;
    }

    // Initialize SearchableDropdown for each row
    if (typeof SearchableDropdown !== 'undefined') {
        rowsData.forEach(rd => {
            const container = document.getElementById(rd.containerId);
            if (!container) return;
            const options = rd.prices.map(vp => ({
                value: vp.vendor_id,
                label: `${vp.vendor_name} — ${formatCurrency(vp.unit_price)}${vp.unit_price === rd.cheapestPrice ? ' (cheapest)' : ''}`
            }));
            new SearchableDropdown(container, {
                options,
                value: rd.assignedVendorId,
                placeholder: 'Select vendor',
                compact: true,
                onChange: (value) => {
                    updateSplitAllocation(rd.itemId, value);
                }
            });
        });
    }
}

function updateSplitAllocation(itemId, vendorId) {
    const existing = splitAllocations.find(a => a.inquiry_item_id === itemId);
    if (existing) {
        existing.vendor_id = vendorId;
    } else {
        splitAllocations.push({ inquiry_item_id: itemId, vendor_id: vendorId });
    }
    // Re-render to update prices
    if (currentComparison) renderSplitAllocationRows(currentComparison);
}

function switchAwardMode(mode) {
    awardMode = mode;
    const btnSingle = document.getElementById('btnModeSingle');
    const btnSplit = document.getElementById('btnModeSplit');
    const splitContent = document.getElementById('splitAwardContent');
    const altSection = document.getElementById('alternativesSection');
    const heroSection = document.getElementById('finalRecommendation');

    if (mode === 'split') {
        btnSplit.style.background = 'var(--brand-primary)';
        btnSplit.style.color = 'var(--text-inverse)';
        btnSingle.style.background = 'var(--bg-secondary)';
        btnSingle.style.color = 'var(--text-secondary)';
        if (splitContent) splitContent.style.display = '';
        if (altSection) altSection.style.display = 'none';
        if (heroSection) heroSection.style.display = 'none';
    } else {
        btnSingle.style.background = 'var(--brand-primary)';
        btnSingle.style.color = 'var(--text-inverse)';
        btnSplit.style.background = 'var(--bg-secondary)';
        btnSplit.style.color = 'var(--text-secondary)';
        if (splitContent) splitContent.style.display = 'none';
        if (altSection) altSection.style.display = '';
        if (heroSection) heroSection.style.display = '';
    }
}

async function confirmSplitAward() {
    const statusEl = document.getElementById('splitPreviewStatus');

    // First preview
    if (statusEl) statusEl.textContent = 'Calculating...';
    try {
        const preview = await api.request(`/procurement/comparisons/${currentComparison.id}/preview-split-award`, {
            method: 'POST',
            body: JSON.stringify({ allocations: splitAllocations })
        });

        const vendorList = (preview.vendor_groups || []).map(g =>
            `${escapeHtml(g.vendor_name)}: ${g.item_count} items (${formatCurrency(g.subtotal)})`
        ).join('\n');

        // Check for unallocated items
        const warnings = preview.coverage_warnings || [];
        let warningText = '';
        if (warnings.length > 0) {
            const w = warnings[0];
            const itemList = (w.uncovered_items || []).map(i => `  • ${i.item_name}`).join('\n');
            warningText = `\n\n⚠️ WARNING: ${w.message}\n${itemList}`;
        }

        const msg = `This will create ${preview.po_count} Purchase Orders:\n\n${vendorList}\n\nTotal: ${formatCurrency(preview.total_amount)}\nSavings: ${formatCurrency(preview.savings_vs_single)} (${preview.savings_percent}%) vs best single vendor${warningText}`;

        const confirmed = await showConfirm(msg, 'Approve Split Award', 'primary');
        if (!confirmed) {
            if (statusEl) statusEl.textContent = '';
            return;
        }

        // Commit split award selection
        if (statusEl) statusEl.textContent = 'Finalizing...';
        await api.request(`/procurement/comparisons/${currentComparison.id}/select-split-award`, {
            method: 'PUT',
            body: JSON.stringify({ allocations: splitAllocations })
        });

        // Create POs
        if (statusEl) statusEl.textContent = 'Creating purchase orders...';
        const result = await api.request('/procurement/purchase-orders/from-split-comparison', {
            method: 'POST',
            body: JSON.stringify({ comparison_id: currentComparison.id })
        });

        Toast.success(`Created ${result.total_pos_created} purchase orders`);
        window.location.href = 'purchase-orders.html';

    } catch (error) {
        console.error('Split award failed:', error);
        Toast.error(error.message || 'Failed to create split award');
        if (statusEl) statusEl.textContent = '';
    }
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
