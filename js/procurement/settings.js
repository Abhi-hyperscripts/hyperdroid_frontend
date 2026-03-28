/**
 * Procurement Settings — Scoring Weights + AI Context Memory
 */

function openModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) { modal.classList.add('gm-animating'); requestAnimationFrame(() => modal.classList.add('active')); }
}
function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) { modal.classList.remove('active'); setTimeout(() => modal.classList.remove('gm-animating'), 200); }
}

let allMemories = [];
let allVendors = [];
let currentFilter = 'all';
let prefVendorDropdown = null;
let rejVendorDropdown = null;

document.addEventListener('DOMContentLoaded', () => {
    Navigation.init('procurement', '../../');
    loadWeights();
    loadMemories();
    loadVendors();
    loadCategoryDropdowns();
});

let _prefCatDropdown = null;
let _pricingCatDropdown = null;

async function loadCategoryDropdowns() {
    try {
        const data = await api.request('/procurement/item-categories');
        const cats = data.data || data || [];
        const options = cats.map(c => `<option value="${c.category_name}">${c.category_name}</option>`).join('');

        const prefSelect = document.getElementById('prefCategory');
        if (prefSelect) {
            prefSelect.innerHTML = '<option value="">Select category...</option>' + options;
            if (typeof convertSelectToSearchable === 'function') {
                _prefCatDropdown = convertSelectToSearchable('prefCategory', { placeholder: 'Select category...', searchPlaceholder: 'Search categories...' });
            }
        }

        const rejSelect = document.getElementById('rejCategory');
        if (rejSelect) {
            rejSelect.innerHTML = '<option value="">All categories (optional)</option>' + options;
            if (typeof convertSelectToSearchable === 'function') {
                convertSelectToSearchable('rejCategory', { placeholder: 'All categories (optional)', searchPlaceholder: 'Search categories...' });
            }
        }

        const pricingSelect = document.getElementById('pricingCategory');
        if (pricingSelect) {
            pricingSelect.innerHTML = '<option value="">Select category...</option>' + options;
            if (typeof convertSelectToSearchable === 'function') {
                _pricingCatDropdown = convertSelectToSearchable('pricingCategory', { placeholder: 'Select category...', searchPlaceholder: 'Search categories...' });
            }
        }
    } catch (e) {
        console.error('Failed to load categories for dropdowns:', e);
    }
}

// ==================== TABS ====================

function switchTab(tab) {
    document.querySelectorAll('.settings-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
    document.getElementById('tab-' + tab).classList.add('active');
    document.querySelector(`.settings-tab[onclick*="${tab}"]`).classList.add('active');
}

// ==================== SCORING WEIGHTS ====================

async function loadWeights() {
    try {
        const data = await api.request('/procurement/comparison-weights');
        const w = data.data || data;
        document.getElementById('weightPrice').value = Math.round((w.price_weight || 0.5) * 100);
        document.getElementById('weightQuality').value = Math.round((w.quality_weight || 0.3) * 100);
        document.getElementById('weightDelivery').value = Math.round((w.delivery_weight || 0.2) * 100);
        updateSliderVisuals();
        if (w.updated_at) {
            document.getElementById('weightsLastUpdated').textContent =
                `Last updated ${formatDate(w.updated_at)}`;
        }
    } catch (e) {
        console.error('Failed to load weights:', e);
    }
}

function onWeightChange(changed) {
    const price = parseInt(document.getElementById('weightPrice').value);
    const quality = parseInt(document.getElementById('weightQuality').value);
    const delivery = parseInt(document.getElementById('weightDelivery').value);
    const total = price + quality + delivery;

    if (total !== 100) {
        // Auto-adjust the OTHER two proportionally
        const others = { price, quality, delivery };
        delete others[changed];
        const otherKeys = Object.keys(others);
        const otherSum = others[otherKeys[0]] + others[otherKeys[1]];
        const remaining = 100 - parseInt(document.getElementById('weight' + capitalize(changed)).value);

        if (otherSum === 0) {
            // Split evenly
            document.getElementById('weight' + capitalize(otherKeys[0])).value = Math.floor(remaining / 2);
            document.getElementById('weight' + capitalize(otherKeys[1])).value = remaining - Math.floor(remaining / 2);
        } else {
            const ratio0 = others[otherKeys[0]] / otherSum;
            const val0 = Math.round(remaining * ratio0);
            document.getElementById('weight' + capitalize(otherKeys[0])).value = val0;
            document.getElementById('weight' + capitalize(otherKeys[1])).value = remaining - val0;
        }
    }
    updateSliderVisuals();
}

function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

function updateSliderVisuals() {
    ['Price', 'Quality', 'Delivery'].forEach(name => {
        const val = parseInt(document.getElementById('weight' + name).value);
        document.getElementById('pct' + name).textContent = val + '%';
        document.getElementById('weight' + name).style.setProperty('--val', val + '%');
    });
    const total = parseInt(document.getElementById('weightPrice').value) +
                  parseInt(document.getElementById('weightQuality').value) +
                  parseInt(document.getElementById('weightDelivery').value);
    const totalEl = document.getElementById('weightTotal');
    totalEl.textContent = total + '%';
    totalEl.className = 'weight-total-val ' + (total === 100 ? 'ok' : 'bad');
}

async function saveWeights() {
    const price = parseInt(document.getElementById('weightPrice').value);
    const quality = parseInt(document.getElementById('weightQuality').value);
    const delivery = parseInt(document.getElementById('weightDelivery').value);

    if (price + quality + delivery !== 100) {
        Toast.error('Weights must total 100%');
        return;
    }

    try {
        await api.request('/procurement/comparison-weights', {
            method: 'PUT',
            body: JSON.stringify({
                price_weight: price / 100,
                quality_weight: quality / 100,
                delivery_weight: delivery / 100
            })
        });
        Toast.success('Scoring weights saved');
        loadWeights(); // Refresh last updated info
    } catch (e) {
        console.error('Failed to save weights:', e);
        Toast.error(e.message || 'Failed to save weights');
    }
}

// ==================== AI MEMORY ====================

async function loadVendors() {
    try {
        const data = await api.request('/procurement/vendors', { _skipSpinner: true });
        allVendors = data.data || data || [];
    } catch (e) { console.error('Failed to load vendors:', e); }
}

async function loadMemories() {
    try {
        const data = await api.request('/procurement/ai-context');
        allMemories = data.data || data || [];
        renderMemories();
    } catch (e) {
        console.error('Failed to load memories:', e);
        document.getElementById('memoryList').innerHTML = '<div class="crm-empty-state"><div class="crm-empty-content"><p>Failed to load memories</p></div></div>';
    }
}

function filterMemories(type) {
    currentFilter = type;
    document.querySelectorAll('.filter-pill').forEach(p => p.classList.remove('active'));
    event.target.classList.add('active');
    renderMemories();
}

function getTypeShort(contextType) {
    const map = { 'vendor_preference': 'preference', 'vendor_rejection': 'rejection', 'pricing_expectation': 'pricing', 'decision_pattern': 'pattern' };
    return map[contextType] || contextType;
}

function getTypeLabel(contextType) {
    const map = { 'vendor_preference': 'Preference', 'vendor_rejection': 'Rejection', 'pricing_expectation': 'Pricing', 'decision_pattern': 'Pattern' };
    return map[contextType] || contextType;
}

function renderMemories() {
    const filtered = currentFilter === 'all'
        ? allMemories
        : allMemories.filter(m => getTypeShort(m.context_type) === currentFilter);

    const container = document.getElementById('memoryList');

    if (filtered.length === 0) {
        container.innerHTML = '<div class="crm-empty-state" style="padding: 40px;"><div class="crm-empty-content"><p>No AI memories found</p></div></div>';
        document.getElementById('memoryCount').textContent = '';
        return;
    }

    container.innerHTML = filtered.map(m => {
        const summary = parseMemoryValue(m);
        return `
        <div class="mem-card">
            <div class="mem-card-body">
                <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px;">
                    <span class="mem-badge ${getTypeShort(m.context_type)}">${getTypeLabel(m.context_type)}</span>
                    ${m.category ? `<span style="font-size: 11px; font-weight: 600; opacity: 0.7;">${escapeHtml(m.category)}</span>` : ''}
                </div>
                <div style="font-size: 13px; line-height: 1.5;">${summary}</div>
                <div class="mem-card-meta">
                    Source: ${escapeHtml(m.source || 'manual')} &middot; Used ${m.usage_count || 0} times &middot; ${formatDate(m.created_at)}
                </div>
            </div>
            <div class="mem-card-actions">
                <button class="btn btn-sm" onclick="deleteMemory('${m.id}')" style="color: var(--color-danger); background: none; border: none; padding: 4px 8px;" title="Delete">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                </button>
            </div>
        </div>`;
    }).join('');

    document.getElementById('memoryCount').textContent = `${filtered.length} ${currentFilter === 'all' ? 'total' : currentFilter} memories`;
}

function parseMemoryValue(mem) {
    try {
        const val = typeof mem.memory_value === 'string' ? JSON.parse(mem.memory_value) : mem.memory_value;
        switch (mem.context_type) {
            case 'vendor_preference':
                const vendors = (val.vendor_names || val.vendor_ids || []).join(', ');
                return `Prefer <strong>${escapeHtml(vendors)}</strong>${val.reason ? ' — ' + escapeHtml(val.reason) : ''}`;
            case 'vendor_rejection':
                return `Reject <strong>${escapeHtml(val.vendor_name || val.vendor_id || '?')}</strong>${val.reason ? ' — ' + escapeHtml(val.reason) : ''}`;
            case 'pricing_expectation':
                return `Avg: ${val.currency || 'INR'} ${val.avg_price || val.avg || 0}, Max: ${val.currency || 'INR'} ${val.max_price || val.max || 0}`;
            case 'decision_pattern':
                return escapeHtml(val.pattern || val.description || mem.memory_key || JSON.stringify(val));
            default:
                return escapeHtml(mem.memory_key || JSON.stringify(val).substring(0, 100));
        }
    } catch (e) {
        return escapeHtml(mem.memory_value || mem.memory_key || '-');
    }
}

// ==================== ADD MEMORY ====================

function openAddMemory(type) {
    switch (type) {
        case 'preference':
            document.getElementById('preferenceForm').reset();
            initPrefVendorDropdown();
            openModal('preferenceModal');
            break;
        case 'rejection':
            document.getElementById('rejectionForm').reset();
            initRejVendorDropdown();
            openModal('rejectionModal');
            break;
        case 'pricing':
            document.getElementById('pricingForm').reset();
            document.getElementById('pricingCurrency').value = 'INR';
            openModal('pricingModal');
            break;
        case 'pattern':
            document.getElementById('patternForm').reset();
            openModal('patternModal');
            break;
    }
}

function initPrefVendorDropdown() {
    const container = document.getElementById('prefVendorContainer');
    container.innerHTML = '';
    if (typeof SearchableDropdown !== 'undefined') {
        prefVendorDropdown = new SearchableDropdown(container, {
            options: allVendors.map(v => ({ value: v.id, label: v.vendor_name })),
            placeholder: 'Select vendors...',
            searchPlaceholder: 'Search vendors...',
            multiple: true
        });
    }
}

function initRejVendorDropdown() {
    const container = document.getElementById('rejVendorContainer');
    container.innerHTML = '';
    if (typeof SearchableDropdown !== 'undefined') {
        rejVendorDropdown = new SearchableDropdown(container, {
            options: allVendors.map(v => ({ value: v.id, label: v.vendor_name })),
            placeholder: 'Select vendor...',
            searchPlaceholder: 'Search vendors...'
        });
    }
}

async function handleAddPreference(event) {
    event.preventDefault();
    const category = _prefCatDropdown?.getValue?.() || document.getElementById('prefCategory').value.trim();
    const vendorIds = prefVendorDropdown?.getSelectedValues?.() || prefVendorDropdown?.getValue?.() || [];
    const reason = document.getElementById('prefReason').value.trim();

    if (!category) { Toast.error('Category is required'); return; }
    const ids = Array.isArray(vendorIds) ? vendorIds : [vendorIds];
    if (ids.length === 0 || !ids[0]) { Toast.error('Select at least one vendor'); return; }

    try {
        await api.request('/procurement/ai-context/preference', {
            method: 'POST',
            body: JSON.stringify({ category, vendor_ids: ids, reason })
        });
        Toast.success('Vendor preference saved');
        closeModal('preferenceModal');
        loadMemories();
    } catch (e) {
        Toast.error(e.message || 'Failed to save preference');
    }
}

async function handleAddRejection(event) {
    event.preventDefault();
    const vendorId = rejVendorDropdown?.getValue?.();
    const category = document.getElementById('rejCategory').value.trim();
    const reason = document.getElementById('rejReason').value.trim();

    if (!vendorId) { Toast.error('Select a vendor'); return; }
    if (!reason) { Toast.error('Reason is required'); return; }

    try {
        await api.request('/procurement/ai-context/rejection', {
            method: 'POST',
            body: JSON.stringify({ vendor_id: vendorId, category: category || null, reason })
        });
        Toast.success('Vendor rejection saved');
        closeModal('rejectionModal');
        loadMemories();
    } catch (e) {
        Toast.error(e.message || 'Failed to save rejection');
    }
}

async function handleAddPricing(event) {
    event.preventDefault();
    const category = _pricingCatDropdown?.getValue?.() || document.getElementById('pricingCategory').value.trim();
    const avg_price = parseFloat(document.getElementById('pricingAvg').value) || 0;
    const max_price = parseFloat(document.getElementById('pricingMax').value) || 0;
    const currency = document.getElementById('pricingCurrency').value.trim() || 'INR';

    if (!category) { Toast.error('Category is required'); return; }

    try {
        await api.request('/procurement/ai-context/pricing', {
            method: 'POST',
            body: JSON.stringify({ category, avg_price, max_price, currency })
        });
        Toast.success('Pricing expectation saved');
        closeModal('pricingModal');
        loadMemories();
    } catch (e) {
        Toast.error(e.message || 'Failed to save pricing');
    }
}

async function handleAddPattern(event) {
    event.preventDefault();
    const pattern = document.getElementById('patternText').value.trim();
    if (!pattern) { Toast.error('Pattern description is required'); return; }

    try {
        await api.request('/procurement/ai-context/pattern', {
            method: 'POST',
            body: JSON.stringify({ pattern })
        });
        Toast.success('Decision pattern saved');
        closeModal('patternModal');
        loadMemories();
    } catch (e) {
        Toast.error(e.message || 'Failed to save pattern');
    }
}

async function deleteMemory(id) {
    const confirmed = await showConfirm('Delete this AI memory? The AI will no longer use this context.', 'Delete Memory', 'danger');
    if (!confirmed) return;

    try {
        await api.request(`/procurement/ai-context/${id}`, { method: 'DELETE' });
        Toast.success('Memory deleted');
        loadMemories();
    } catch (e) {
        Toast.error(e.message || 'Failed to delete memory');
    }
}

// ==================== HELPERS ====================

function formatDate(dateStr) {
    if (!dateStr) return '-';
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = String(text);
    return div.innerHTML;
}
